import { afterEach, describe, expect, it } from "vitest";
import { createHTTPSProxy } from "../../src/https";
import { BufferedStreamReader } from "../../src/io/reader";
import { ProxyError } from "../../src/shared/error";
import { setConnectImplementation } from "../mocks/cloudflare-sockets";
import { text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";
import { readHeadLines, serveHttp } from "../utils/http";

const credentials = { host: "proxy.example", port: 443 };

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

afterEach(() => {
  setConnectImplementation(undefined);
});

describe("createHTTPSProxy", () => {
  it("connects to the proxy over TLS and fetches http URLs absolute-form", async () => {
    const connects = recordConnects();
    const proxy = createHTTPSProxy(credentials);

    const responsePromise = proxy.fetch("http://example.com/");
    const lines = await serveHttp(connects[0].pair);
    const response = await responsePromise;

    expect(connects[0].options?.secureTransport).toBe("on");
    expect(lines[0]).toBe("GET http://example.com/ HTTP/1.1");
    expect(await response.text()).toBe("ok");
  });

  it("rejects https URLs because nested TLS is not supported", async () => {
    const connects = recordConnects();
    const proxy = createHTTPSProxy(credentials);

    await expect(proxy.fetch("https://example.com/")).rejects.toThrow(
      ProxyError
    );
    expect(connects).toHaveLength(0);
  });

  it("opens raw tunnels with connect()", async () => {
    const connects = recordConnects();
    const proxy = createHTTPSProxy(credentials);

    proxy.connect("db.example.com:5432");
    const pair = connects[0].pair;
    const reader = new BufferedStreamReader(pair.server.readable);
    const writer = pair.server.writable.getWriter();
    const connectLines = await readHeadLines(reader);
    await writer.write(text("HTTP/1.1 200 OK\r\n\r\n"));

    expect(connects[0].options?.secureTransport).toBe("on");
    expect(connectLines[0]).toBe("CONNECT db.example.com:5432 HTTP/1.1");
  });

  it("rejects TLS tunnels requested through connect()", async () => {
    const connects = recordConnects();
    const proxy = createHTTPSProxy(credentials);

    const socket = proxy.connect("db.example.com:5432", {
      secureTransport: "on",
      allowHalfOpen: false,
    });

    await expect(socket.opened).rejects.toThrow(/nested TLS|not supported/);
    expect(connects).toHaveLength(0);
  });
});
