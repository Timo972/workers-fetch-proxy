import { afterEach, describe, expect, it } from "vitest";
import { BufferedStreamReader } from "../../src/io/reader";
import { ProxyError } from "../../src/shared/error";
import { createSOCKS5Proxy } from "../../src/socks5";
import { setConnectImplementation } from "../mocks/cloudflare-sockets";
import { bytes, decode, readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";
import { readHeadLines } from "../utils/http";

const credentials = { host: "proxy.example", port: 1080 };

interface RecordedConnect {
  address: SocketAddress | string;
  options?: SocketOptions;
  pair: FakeSocketPair;
}

function recordConnects(): RecordedConnect[] {
  const connects: RecordedConnect[] = [];
  setConnectImplementation((address, options) => {
    const pair = createFakeSocketPair(options);
    connects.push({ address, options, pair });
    return pair.socket;
  });
  return connects;
}

interface Socks5Session {
  reader: BufferedStreamReader;
  write: (data: Uint8Array) => Promise<void>;
  end: () => Promise<void>;
  target: { hostname: string; port: number };
}

/** Accepts any client, selects no-auth and confirms the CONNECT. */
async function acceptSocks5(pair: FakeSocketPair): Promise<Socks5Session> {
  const reader = new BufferedStreamReader(pair.server.readable);
  const writer = pair.server.writable.getWriter();
  const write = (data: Uint8Array) => writer.write(data);

  const [, methodCount] = await reader.readExact(2);
  await reader.readExact(methodCount);
  await write(bytes(0x05, 0x00));

  await reader.readExact(4); // request header; tests only use domain targets
  const [length] = await reader.readExact(1);
  const hostname = decode(await reader.readExact(length));
  const [hi, lo] = await reader.readExact(2);
  await write(bytes(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0));

  return {
    reader,
    write,
    end: () => writer.close(),
    target: { hostname, port: hi * 256 + lo },
  };
}

async function serveHttpOverSocks5(
  pair: FakeSocketPair
): Promise<{ requestLines: string[]; target: Socks5Session["target"] }> {
  const session = await acceptSocks5(pair);
  const requestLines = await readHeadLines(session.reader);
  await session.write(text("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"));
  return { requestLines, target: session.target };
}

afterEach(() => {
  setConnectImplementation(undefined);
});

describe("createSOCKS5Proxy", () => {
  it("fetches http URLs through the proxy", async () => {
    const connects = recordConnects();
    const proxy = createSOCKS5Proxy(credentials);

    const responsePromise = proxy.fetch("http://example.com/path");
    await new Promise((resolve) => setTimeout(resolve));
    const { requestLines, target } = await serveHttpOverSocks5(
      connects[0].pair
    );
    const response = await responsePromise;

    expect(connects[0].address).toEqual({
      hostname: "proxy.example",
      port: 1080,
    });
    expect(connects[0].options?.secureTransport).toBe("off");
    expect(target).toEqual({ hostname: "example.com", port: 80 });
    expect(requestLines[0]).toBe("GET /path HTTP/1.1");
    expect(await response.text()).toBe("ok");
  });

  it("fetches https URLs by upgrading the tunnel to TLS", async () => {
    const connects = recordConnects();
    const proxy = createSOCKS5Proxy(credentials);

    const responsePromise = proxy.fetch("https://example.com/");
    await new Promise((resolve) => setTimeout(resolve));
    const { target } = await serveHttpOverSocks5(connects[0].pair);
    const response = await responsePromise;

    expect(connects[0].options?.secureTransport).toBe("starttls");
    expect(target.port).toBe(443);
    expect(connects[0].pair.tlsCalls).toEqual([
      { options: { expectedServerHostname: "example.com" } },
    ]);
    expect(response.status).toBe(200);
  });

  it("opens raw tunnels with connect()", async () => {
    const connects = recordConnects();
    const proxy = createSOCKS5Proxy(credentials);

    const socketPromise = proxy.connect("db.example.com:5432");
    await new Promise((resolve) => setTimeout(resolve));
    const session = await acceptSocks5(connects[0].pair);
    const socket = await socketPromise;

    expect(session.target).toEqual({
      hostname: "db.example.com",
      port: 5432,
    });

    const writer = socket.writable.getWriter();
    await writer.write(text("ping"));
    expect(await session.reader.readExact(4)).toEqual(text("ping"));

    await session.write(text("pong"));
    await session.end();
    expect(await readAll(socket.readable)).toEqual(text("pong"));
  });

  it("closes the proxy socket when the handshake fails", async () => {
    const connects = recordConnects();
    const proxy = createSOCKS5Proxy(credentials);

    const responsePromise = proxy.fetch("http://example.com/");
    await new Promise((resolve) => setTimeout(resolve));
    const pair = connects[0].pair;
    const reader = new BufferedStreamReader(pair.server.readable);
    await reader.readExact(2);
    const writer = pair.server.writable.getWriter();
    await writer.write(bytes(0x05, 0xff)); // no acceptable methods

    await expect(responsePromise).rejects.toThrow(ProxyError);
    expect(pair.closed()).toBe(true);
  });
});
