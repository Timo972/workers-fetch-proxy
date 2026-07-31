import { afterEach, describe, expect, it } from "vitest";
import { createHTTPProxy } from "../../src/http";
import { BufferedStreamReader } from "../../src/io/reader";
import { setConnectImplementation } from "../mocks/cloudflare-sockets";
import { text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";
import { readHeadLines, serveHttp } from "../utils/http";

const credentials = {
  host: "proxy.example",
  port: 8080,
  username: "user",
  password: "pass",
};

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

/** Confirms a CONNECT request, then serves one HTTP exchange. */
async function serveConnectThenHttp(pair: FakeSocketPair): Promise<{
  connectLines: string[];
  requestLines: string[];
}> {
  const reader = new BufferedStreamReader(pair.server.readable);
  const writer = pair.server.writable.getWriter();

  const connectLines = await readHeadLines(reader);
  await writer.write(text("HTTP/1.1 200 Connection Established\r\n\r\n"));

  const requestLines = await readHeadLines(reader);
  await writer.write(text("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"));

  return { connectLines, requestLines };
}

afterEach(() => {
  setConnectImplementation(undefined);
});

describe("createHTTPProxy", () => {
  it("fetches http URLs as absolute-form requests without a tunnel", async () => {
    const connects = recordConnects();
    const proxy = createHTTPProxy(credentials);

    const responsePromise = proxy.fetch("http://example.com/data");
    const lines = await serveHttp(connects[0].pair);
    const response = await responsePromise;

    expect(connects[0].address).toEqual({
      hostname: "proxy.example",
      port: 8080,
    });
    expect(connects[0].options?.secureTransport).toBe("off");
    expect(lines[0]).toBe("GET http://example.com/data HTTP/1.1");
    expect(lines).toContain("Proxy-Authorization: Basic dXNlcjpwYXNz");
    expect(await response.text()).toBe("ok");
  });

  it("fetches https URLs via CONNECT and a TLS upgrade", async () => {
    const connects = recordConnects();
    const proxy = createHTTPProxy(credentials);

    const responsePromise = proxy.fetch("https://example.com/secure");
    const { connectLines, requestLines } = await serveConnectThenHttp(
      connects[0].pair
    );
    const response = await responsePromise;

    expect(connects[0].options?.secureTransport).toBe("starttls");
    expect(connectLines[0]).toBe("CONNECT example.com:443 HTTP/1.1");
    expect(connectLines).toContain("Proxy-Authorization: Basic dXNlcjpwYXNz");
    expect(connects[0].pair.tlsCalls).toEqual([
      { options: { expectedServerHostname: "example.com" } },
    ]);
    expect(requestLines[0]).toBe("GET /secure HTTP/1.1");
    expect(response.status).toBe(200);
  });

  it("opens raw tunnels with connect()", async () => {
    const connects = recordConnects();
    const proxy = createHTTPProxy(credentials);

    proxy.connect({ hostname: "db.example.com", port: 5432 });
    const pair = connects[0].pair;
    const reader = new BufferedStreamReader(pair.server.readable);
    const writer = pair.server.writable.getWriter();
    const connectLines = await readHeadLines(reader);
    await writer.write(text("HTTP/1.1 200 OK\r\n\r\n"));

    expect(connectLines[0]).toBe("CONNECT db.example.com:5432 HTTP/1.1");
  });
});
