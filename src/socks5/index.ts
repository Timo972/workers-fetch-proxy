import type { ProxyFetcher } from "../proxy/fetcher";
import { createProxyFetcher } from "../proxy/fetcher";
import { tunnelOpener } from "../proxy/tunnel";
import type { Credentials } from "../shared/credentials";
import { handshake } from "./handshake";

/**
 * Routes `fetch` and `connect` through a SOCKS5 proxy (RFC 1928), with
 * optional username/password authentication (RFC 1929).
 */
export function createSOCKS5Proxy(credentials: Credentials): ProxyFetcher {
  return createProxyFetcher(tunnelOpener(credentials, handshake));
}
