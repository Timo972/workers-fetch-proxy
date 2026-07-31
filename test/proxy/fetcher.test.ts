import { describe, expect, it } from "vitest";
import type { OpenTunnel } from "../../src/proxy/fetcher";
import { createProxyFetcher } from "../../src/proxy/fetcher";
import { ProxyError } from "../../src/shared/error";
import type { TunnelTarget } from "../../src/shared/target";
import { bytes, readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";
import { serveHttp } from "../utils/http";

interface TunnelCall {
  target: TunnelTarget;
  secureTransport: "off" | "starttls";
}

function stubTunnel(options?: { leftover?: Uint8Array; tls?: boolean }): {
  openTunnel: OpenTunnel;
  calls: TunnelCall[];
  pair: () => FakeSocketPair;
} {
  const calls: TunnelCall[] = [];
  let pair: FakeSocketPair | undefined;
  const openTunnel: OpenTunnel = (target, tunnelOptions) => {
    calls.push({ target, secureTransport: tunnelOptions.secureTransport });
    pair = createFakeSocketPair({
      secureTransport: tunnelOptions.secureTransport,
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

  it("tunnels plain http requests without TLS", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const responsePromise = fetcher.fetch("http://example.com/data?x=1");
    // Wait for the tunnel to open before scripting the server side.
    await new Promise((resolve) => setTimeout(resolve));
    const lines = await serveHttp(pair());
    const response = await responsePromise;

    expect(calls).toEqual([
      {
        target: { hostname: "example.com", port: 80 },
        secureTransport: "off",
      },
    ]);
    expect(lines[0]).toBe("GET /data?x=1 HTTP/1.1");
    expect(pair().tlsCalls).toHaveLength(0);
    expect(await response.text()).toBe("ok");
  });

  it("honors explicit ports", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const responsePromise = fetcher.fetch("http://example.com:8080/");
    await new Promise((resolve) => setTimeout(resolve));
    await serveHttp(pair());
    await responsePromise;

    expect(calls[0].target.port).toBe(8080);
  });

  it("upgrades https requests to TLS with the target hostname", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const responsePromise = fetcher.fetch("https://example.com/secure");
    await new Promise((resolve) => setTimeout(resolve));
    const lines = await serveHttp(pair());
    const response = await responsePromise;

    expect(calls).toEqual([
      {
        target: { hostname: "example.com", port: 443 },
        secureTransport: "starttls",
      },
    ]);
    expect(pair().tlsCalls).toEqual([
      { options: { expectedServerHostname: "example.com" } },
    ]);
    expect(lines[0]).toBe("GET /secure HTTP/1.1");
    expect(response.status).toBe(200);
  });

  it("fails https requests when data arrived before the TLS upgrade", async () => {
    const { openTunnel, pair } = stubTunnel({ leftover: text("early") });
    const fetcher = createProxyFetcher(openTunnel);

    await expect(fetcher.fetch("https://example.com/")).rejects.toThrow(
      ProxyError
    );
    expect(pair().closed()).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve));
    await serveHttp(pair());
    await responsePromise;

    expect(calls).toHaveLength(1);
  });
});

describe("createProxyFetcher connect", () => {
  it("opens a plain tunnel and replays leftover bytes", async () => {
    const { openTunnel, calls, pair } = stubTunnel({
      leftover: text("hello "),
    });
    const fetcher = createProxyFetcher(openTunnel);

    const socket = await fetcher.connect("db.example.com:5432");
    const writer = pair().server.writable.getWriter();
    await writer.write(text("world"));
    await writer.close();

    expect(calls).toEqual([
      {
        target: { hostname: "db.example.com", port: 5432 },
        secureTransport: "off",
      },
    ]);
    expect(await readAll(socket.readable)).toEqual(text("hello world"));
  });

  it("accepts SocketAddress objects", async () => {
    const { openTunnel, calls } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    await fetcher.connect({ hostname: "example.com", port: 80 });

    expect(calls[0].target).toEqual({
      hostname: "example.com",
      port: 80,
    });
  });

  it("starts TLS immediately for secureTransport 'on'", async () => {
    const { openTunnel, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    await fetcher.connect("[2001:db8::1]:443", {
      secureTransport: "on",
      allowHalfOpen: false,
    });

    expect(pair().tlsCalls).toEqual([
      { options: { expectedServerHostname: "2001:db8::1" } },
    ]);
  });

  it("leaves the TLS upgrade to the caller for 'starttls'", async () => {
    const { openTunnel, calls, pair } = stubTunnel();
    const fetcher = createProxyFetcher(openTunnel);

    const socket = await fetcher.connect("example.com:5432", {
      secureTransport: "starttls",
      allowHalfOpen: false,
    });

    expect(calls[0].secureTransport).toBe("starttls");
    expect(pair().tlsCalls).toHaveLength(0);
    socket.startTls();
    expect(pair().tlsCalls).toHaveLength(1);
  });

  it("fails 'on' upgrades when data arrived before TLS", async () => {
    const { openTunnel, pair } = stubTunnel({ leftover: text("early") });
    const fetcher = createProxyFetcher(openTunnel);

    await expect(
      fetcher.connect("example.com:443", {
        secureTransport: "on",
        allowHalfOpen: false,
      })
    ).rejects.toThrow(ProxyError);
    expect(pair().closed()).toBe(true);
  });
});
