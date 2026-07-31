/**
 * Raised when a proxy connection cannot be established — the proxy is
 * unreachable, rejects authentication, or refuses to open the tunnel.
 */
export class ProxyError extends Error {
  override name = "ProxyError";
}
