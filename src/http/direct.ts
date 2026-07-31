import { connect } from "cloudflare:sockets";
import { sendRequest } from "../http1/client";
import { basicAuth } from "../shared/basic-auth";
import type { Credentials } from "../shared/credentials";
import { hasAuth } from "../shared/credentials";

/**
 * Fetches a plain `http:` URL the way HTTP(S) proxies expect it: a single
 * absolute-form request to the proxy itself, no tunnel.
 */
export function directProxyFetch(
  credentials: Credentials,
  options: { proxyTls: boolean }
): (request: Request) => Promise<Response> {
  return (request) => {
    const socket = connect(
      { hostname: credentials.host, port: credentials.port },
      {
        secureTransport: options.proxyTls ? "on" : "off",
        allowHalfOpen: false,
      }
    );
    return sendRequest(socket, request, {
      form: "absolute",
      headers: proxyAuthHeaders(credentials),
    });
  };
}

export function proxyAuthHeaders(
  credentials: Credentials
): Record<string, string> {
  return hasAuth(credentials)
    ? {
        "Proxy-Authorization": basicAuth(
          credentials.username,
          credentials.password
        ),
      }
    : {};
}
