import type { TunnelTarget } from "./target";

const HOST_PORT = /^(\[[^\]]+\]|[^:]+):(\d+)$/;

/**
 * Normalizes the address forms accepted by `connect()` from
 * `cloudflare:sockets` — a "host:port" string or a SocketAddress — into a
 * tunnel target.
 */
export function parseSocketAddress(
  address: SocketAddress | string
): TunnelTarget {
  if (typeof address !== "string") {
    return { hostname: address.hostname, port: address.port };
  }
  const match = HOST_PORT.exec(address);
  if (!match) {
    throw new TypeError(
      `invalid socket address ${JSON.stringify(address)}, expected "host:port"`
    );
  }
  const port = Number(match[2]);
  if (port < 1 || port > 65_535) {
    throw new TypeError(`socket address port out of range: ${port}`);
  }
  return { hostname: match[1], port };
}
