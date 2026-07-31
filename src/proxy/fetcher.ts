import { sendRequest } from "../http1/client";
import { parseSocketAddress } from "../shared/address";
import { ProxyError } from "../shared/error";
import { stripBrackets } from "../shared/ip";
import type { TunnelTarget } from "../shared/target";
import { tunnelSocket } from "./tunnel-socket";

/** An established tunnel plus bytes the handshake over-read. */
export interface Tunnel {
  socket: Socket;
  leftover: Uint8Array;
}

export interface OpenTunnelOptions {
  /**
   * `starttls` when the tunnel payload will be upgraded to TLS, so the
   * socket to the proxy must be opened accordingly.
   */
  secureTransport: "off" | "starttls";
}

/**
 * Protocol-specific part of a proxy: opens a socket to the proxy server and
 * performs the handshake that turns it into a tunnel to `target`.
 */
export type OpenTunnel = (
  target: TunnelTarget,
  options: OpenTunnelOptions
) => Promise<Tunnel>;

export interface ProxyFetcher {
  /** Like the global `fetch`, but routed through the proxy. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /**
   * Like `connect` from `cloudflare:sockets`, but routed through the
   * proxy. Async because the tunnel handshake has to complete first.
   */
  connect(
    address: SocketAddress | string,
    options?: SocketOptions
  ): Promise<Socket>;
}

export interface ProxyFetcherOptions {
  /**
   * Overrides how plain `http:` URLs are fetched. HTTP(S) proxies expect
   * those as absolute-form requests instead of a tunnel.
   */
  fetchPlainHttp?: (request: Request) => Promise<Response>;
}

/**
 * Builds the user-facing fetch/connect pair on top of a protocol's
 * tunnel-opening routine.
 */
export function createProxyFetcher(
  openTunnel: OpenTunnel,
  options: ProxyFetcherOptions = {}
): ProxyFetcher {
  return {
    fetch: (input, init) => proxyFetch(openTunnel, options, input, init),
    connect: (address, socketOptions) =>
      proxyConnect(openTunnel, address, socketOptions),
  };
}

async function proxyFetch(
  openTunnel: OpenTunnel,
  options: ProxyFetcherOptions,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);

  if (url.protocol === "https:") {
    const socket = await openTlsTunnel(
      openTunnel,
      targetFromUrl(url),
      stripBrackets(url.hostname)
    );
    return sendRequest(socket, request);
  }
  if (url.protocol !== "http:") {
    throw new TypeError(`unsupported URL scheme: ${url.protocol}`);
  }
  if (options.fetchPlainHttp) {
    return options.fetchPlainHttp(request);
  }
  const { socket, leftover } = await openTunnel(targetFromUrl(url), {
    secureTransport: "off",
  });
  return sendRequest(tunnelSocket(socket, leftover), request);
}

async function proxyConnect(
  openTunnel: OpenTunnel,
  address: SocketAddress | string,
  socketOptions?: SocketOptions
): Promise<Socket> {
  const target = parseSocketAddress(address);
  const mode = socketOptions?.secureTransport ?? "off";
  if (mode === "on") {
    return openTlsTunnel(openTunnel, target, stripBrackets(target.hostname));
  }
  const { socket, leftover } = await openTunnel(target, {
    secureTransport: mode === "starttls" ? "starttls" : "off",
  });
  return tunnelSocket(socket, leftover);
}

async function openTlsTunnel(
  openTunnel: OpenTunnel,
  target: TunnelTarget,
  hostname: string
): Promise<Socket> {
  const { socket, leftover } = await openTunnel(target, {
    secureTransport: "starttls",
  });
  if (leftover.length > 0) {
    socket.close().catch(() => {});
    throw new ProxyError(
      "unexpected data from the tunnel before the TLS upgrade"
    );
  }
  return socket.startTls({ expectedServerHostname: hostname });
}

function targetFromUrl(url: URL): TunnelTarget {
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : defaultPort,
  };
}
