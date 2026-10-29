import { createProxyFetcher } from "../proxy/fetcher";
import type { ProxyOptions } from "../proxy/options";
import { tunnelOpener } from "../proxy/tunnel";
import type { Credentials } from "../shared/credentials";
import { directProxyFetch } from "./direct";
import { handshake } from "./handshake";

/**
 * Routes `fetch` and `connect` through a plaintext HTTP proxy. `http:` URLs
 * are sent as absolute-form requests; everything else uses CONNECT tunnels.
 */
export function createHTTPProxy(
  credentials: Credentials,
  options: ProxyOptions = {}
): Fetcher {
  return createProxyFetcher(tunnelOpener(credentials, handshake), {
    fetchPlainHttp: directProxyFetch(credentials, { proxyTls: false }),
    tls: options.tls,
  });
}
