export type RequestForm = "origin" | "absolute";

export interface SerializeOptions {
  /**
   * `origin` sends only path and query (direct/tunneled requests),
   * `absolute` sends the full URL (plaintext requests via an HTTP proxy).
   */
  form?: RequestForm;
  /** Emits a Content-Length header when set. */
  contentLength?: number;
  /** Extra headers to send, e.g. Proxy-Authorization. */
  headers?: Record<string, string>;
}

/**
 * Headers we frame ourselves or that only make sense on a persistent
 * connection; caller-provided values are dropped.
 */
const MANAGED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
  "te",
  "upgrade",
  "trailer",
]);

/**
 * Serializes the HTTP/1.1 request head (request line, headers, blank line)
 * for sending over a raw socket.
 */
export function serializeRequestHead(
  request: Request,
  options: SerializeOptions = {}
): Uint8Array {
  const url = new URL(request.url);
  const target =
    options.form === "absolute" ? url.href : url.pathname + url.search;

  const lines = [`${request.method} ${target} HTTP/1.1`, `Host: ${url.host}`];
  for (const [name, value] of request.headers) {
    if (!MANAGED_HEADERS.has(name.toLowerCase())) {
      lines.push(`${name}: ${value}`);
    }
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    lines.push(`${name}: ${value}`);
  }
  if (options.contentLength !== undefined) {
    lines.push(`Content-Length: ${options.contentLength}`);
  }
  lines.push("Connection: close", "\r\n");

  return new TextEncoder().encode(lines.join("\r\n"));
}
