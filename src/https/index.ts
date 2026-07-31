import { handshake } from "../http/handshake";
import { directProxyFetch } from "../http/direct";
import type { ProxyFetcher } from "../proxy/fetcher";
import { createProxyFetcher } from "../proxy/fetcher";
import { tunnelOpener } from "../proxy/tunnel";
import type { Credentials } from "../shared/credentials";

/**
 * Routes `fetch` and `connect` through an HTTPS proxy (TLS to the proxy
 * itself). `https:` URLs cannot be fetched through it — that would require
 * a TLS session inside the proxy's TLS session, which Workers sockets do
 * not support.
 */
export function createHTTPSProxy(credentials: Credentials): ProxyFetcher {
  return createProxyFetcher(
    tunnelOpener(credentials, handshake, { proxyTls: true }),
    { fetchPlainHttp: directProxyFetch(credentials, { proxyTls: true }) }
  );
}
