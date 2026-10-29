import { directProxyFetch } from "../http/direct";
import { handshake } from "../http/handshake";
import { createProxyFetcher } from "../proxy/fetcher";
import type { ProxyOptions } from "../proxy/options";
import { tunnelOpener } from "../proxy/tunnel";
import type { Credentials } from "../shared/credentials";

/**
 * Routes `fetch` and `connect` through an HTTPS proxy (TLS to the proxy
 * itself). `https:` URLs need the `tls` option: a TLS session inside the
 * proxy's TLS session only works in user space, since Workers sockets
 * cannot nest TLS.
 */
export function createHTTPSProxy(
  credentials: Credentials,
  options: ProxyOptions = {}
): Fetcher {
  return createProxyFetcher(
    tunnelOpener(credentials, handshake, { proxyTls: true }),
    {
      fetchPlainHttp: directProxyFetch(credentials, { proxyTls: true }),
      tls: options.tls,
    }
  );
}
