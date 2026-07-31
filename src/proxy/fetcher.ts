import { sendRequest } from "../http1/client";
import { parseSocketAddress } from "../shared/address";
import { stripBrackets } from "../shared/ip";
import type { TunnelTarget } from "../shared/target";
import type { OpenTunnel } from "./tunnel";
import { tunnelSocket } from "./tunnel-socket";

export interface ProxyFetcherOptions {
  /**
   * Overrides how plain `http:` URLs are fetched. HTTP(S) proxies expect
   * those as absolute-form requests instead of a tunnel.
   */
  fetchPlainHttp?: (request: Request) => Promise<Response>;
}

/**
 * Builds a `Fetcher` on top of a protocol's tunnel-opening routine, so the
 * returned object is a drop-in replacement wherever a `Fetcher` is expected.
 * `connect` returns a `Socket` synchronously (the handshake completes in the
 * background); `fetch` is layered on top of it.
 */
export function createProxyFetcher(
  openTunnel: OpenTunnel,
  options: ProxyFetcherOptions = {}
): Fetcher {
  function connect(
    address: SocketAddress | string,
    socketOptions?: SocketOptions
  ): Socket {
    const target = parseSocketAddress(address);
    const mode = socketOptions?.secureTransport ?? "off";
    const upgradeable = mode !== "off";
    const socket = tunnelSocket(
      openTunnel(target, { upgradeable }),
      upgradeable ? "starttls" : "off"
    );
    return mode === "on"
      ? socket.startTls({
          expectedServerHostname: stripBrackets(target.hostname),
        })
      : socket;
  }

  function fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let request: Request;
    let url: URL;
    try {
      request = new Request(input, init);
      url = new URL(request.url);
    } catch (error) {
      return Promise.reject(error);
    }

    if (url.protocol === "https:") {
      return sendRequest(tunnelFor(url, "on"), request);
    }
    if (url.protocol !== "http:") {
      return Promise.reject(
        new TypeError(`unsupported URL scheme: ${url.protocol}`)
      );
    }
    if (options.fetchPlainHttp) {
      return options.fetchPlainHttp(request);
    }
    return sendRequest(tunnelFor(url, "off"), request);
  }

  function tunnelFor(url: URL, secureTransport: "off" | "on"): Socket {
    return connect(targetFromUrl(url), {
      secureTransport,
      allowHalfOpen: false,
    });
  }

  return { fetch, connect };
}

function targetFromUrl(url: URL): TunnelTarget {
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : defaultPort,
  };
}
