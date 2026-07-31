import { describe, expect, it } from "vitest";
import { createProxyFetcher } from "../../src/proxy/fetcher";
import type { OpenTunnel } from "../../src/proxy/tunnel";
import { ProxyError } from "../../src/shared/error";
import type { TunnelTarget } from "../../src/shared/target";
import { bytes, readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";
import { serveHttp } from "../utils/http";

interface TunnelCall {
  target: TunnelTarget;
  upgradeable: boolean;
}

function stubTunnel(options?: { leftover?: Uint8Array; fail?: Error }): {
  openTunnel: OpenTunnel;
  calls: TunnelCall[];
  pair: () => FakeSocketPair;
} {
  const calls: TunnelCall[] = [];
  let pair: FakeSocketPair | undefined;
  const openTunnel: OpenTunnel = (target, { upgradeable }) => {
    calls.push({ target, upgradeable });
    if (options?.fail) {
      return Promise.reject(options.fail);
    }
    pair = createFakeSocketPair({
      secureTransport: upgradeable ? "starttls" : "off",
      allowHalfOpen: false,
    });
    return Promise.resolve({
      socket: pair.socket,
      leftover: options?.leftover ?? bytes(),
    });
  };
  return {
    openTunnel,
    calls,
    pair: () => {
      if (!pair) throw new Error("tunnel was never opened");
      return pair;
    },
  };
}

describe("createProxyFetcher fetch", () => {
  it("rejects unsupported URL schemes", async () => {
    const { openTunnel } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    await expect(fetcher.fetch("ftp://example.com/")).rejects.toThrow(
      TypeError
    );
  });

  it("rejects a malformed request URL", async () => {
    const { openTunnel } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    await expect(fetcher.fetch("not a url")).rejects.toThrow();
  });

  it("tunnels plain http requests without TLS", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const responsePromise = fetcher.fetch("http://example.com/data?x=1");
    const lines = await serveHttp(pair());
    const response = await responsePromise;

    expect(calls).toEqual([
      { target: { hostname: "example.com", port: 80 }, upgradeable: false },
    ]);
    expect(lines[0]).toBe("GET /data?x=1 HTTP/1.1");
    expect(pair().tlsCalls).toHaveLength(0);
    expect(await response.text()).toBe("ok");
  });

  it("honors explicit ports", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const responsePromise = fetcher.fetch("http://example.com:8080/");
    await serveHttp(pair());
    await responsePromise;

    expect(calls[0].target.port).toBe(8080);
  });

  it("upgrades https requests to TLS with the target hostname", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const responsePromise = fetcher.fetch("https://example.com/secure");
    const lines = await serveHttp(pair());
    const response = await responsePromise;

    expect(calls).toEqual([
      { target: { hostname: "example.com", port: 443 }, upgradeable: true },
    ]);
    expect(pair().tlsCalls).toEqual([
      { options: { expectedServerHostname: "example.com" } },
    ]);
    expect(lines[0]).toBe("GET /secure HTTP/1.1");
    expect(response.status).toBe(200);
  });

  it("fails https requests when data arrived before the TLS upgrade", async () => {
    const { openTunnel } = stubTunnel({ leftover: text("early") });
    const fetcher = createProxyFetcher(openTunnel);

    await expect(fetcher.fetch("https://example.com/")).rejects.toThrow(
      ProxyError
    );
  });

  it("rejects when the tunnel handshake fails", async () => {
    const { openTunnel } = stubTunnel({ fail: new ProxyError("refused") });
    const fetcher = createProxyFetcher(openTunnel);

    await expect(fetcher.fetch("http://example.com/")).rejects.toThrow(
      /refused/
    );
  });

  it("uses the plain-http override when provided", async () => {
    const { openTunnel, calls } = stubTunnel();
    const seen: string[] = [];
    const fetcher = createProxyFetcher(openTunnel, {
      fetchPlainHttp: (request) => {
        seen.push(request.url);
        return Promise.resolve(new Response("direct"));
      },
    });

    const response = await fetcher.fetch("http://example.com/");

    expect(await response.text()).toBe("direct");
    expect(seen).toEqual(["http://example.com/"]);
    expect(calls).toHaveLength(0);
  });

  it("does not use the plain-http override for https", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel, {
      fetchPlainHttp: () => {
        throw new Error("must not be called");
      },
    });

    const responsePromise = fetcher.fetch("https://example.com/");
    await serveHttp(pair());
    await responsePromise;

    expect(calls).toHaveLength(1);
  });
});

describe("createProxyFetcher connect", () => {
  it("returns a Socket synchronously", () => {
    const { openTunnel } = stubTunnel();
    const socket = createProxyFetcher(openTunnel).connect("example.com:80");

    expect(typeof socket.readable).toBe("object");
    expect(typeof socket.close).toBe("function");
  });

  it("opens a plain tunnel and replays leftover bytes", async () => {
    const { openTunnel, calls, pair } = stubTunnel({
      leftover: text("hello "),
    });
    const socket = createProxyFetcher(openTunnel).connect(
      "db.example.com:5432"
    );

    const writer = pair().server.writable.getWriter();
    await writer.write(text("world"));
    await writer.close();

    expect(calls).toEqual([
      {
        target: { hostname: "db.example.com", port: 5432 },
        upgradeable: false,
      },
    ]);
    expect(await readAll(socket.readable)).toEqual(text("hello world"));
  });

  it("accepts SocketAddress objects", () => {
    const { openTunnel, calls } = stubTunnel();

    createProxyFetcher(openTunnel).connect({
      hostname: "example.com",
      port: 80,
    });

    expect(calls[0].target).toEqual({ hostname: "example.com", port: 80 });
  });

  it("starts TLS immediately for secureTransport 'on'", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const socket = createProxyFetcher(openTunnel).connect("[2001:db8::1]:443", {
      secureTransport: "on",
      allowHalfOpen: false,
    });

    await socket.opened;

    expect(calls[0].upgradeable).toBe(true);
    expect(socket.secureTransport).toBe("on");
    expect(pair().tlsCalls).toEqual([
      { options: { expectedServerHostname: "2001:db8::1" } },
    ]);
  });

  it("leaves the TLS upgrade to the caller for 'starttls'", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const socket = createProxyFetcher(openTunnel).connect("example.com:5432", {
      secureTransport: "starttls",
      allowHalfOpen: false,
    });

    await socket.opened;
    expect(calls[0].upgradeable).toBe(true);
    expect(pair().tlsCalls).toHaveLength(0);

    const tls = socket.startTls();
    await tls.opened;
    expect(pair().tlsCalls).toHaveLength(1);
  });

  it("surfaces a handshake failure on opened", async () => {
    const { openTunnel } = stubTunnel({ fail: new ProxyError("refused") });
    const socket = createProxyFetcher(openTunnel).connect("example.com:80");

    await expect(socket.opened).rejects.toThrow(/refused/);
  });
});
