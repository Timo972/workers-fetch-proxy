import { readResponseHead } from "../http1/response";
import { BufferedStreamReader } from "../io/reader";
import { basicAuth } from "../shared/basic-auth";
import type { Credentials } from "../shared/credentials";
import { hasAuth } from "../shared/credentials";
import { ProxyError } from "../shared/error";
import type { TunnelStreams, TunnelTarget } from "../shared/target";

/**
 * Performs an HTTP CONNECT handshake (RFC 9110 §9.3.6) on a freshly opened
 * socket to the proxy, so the socket becomes a tunnel to `target`
 * afterwards.
 *
 * Returns bytes the server sent past the response head; they belong to the
 * tunnel and must be replayed before the socket's readable is consumed.
 */
export async function handshake(
  socket: TunnelStreams,
  credentials: Credentials,
  target: TunnelTarget
): Promise<Uint8Array> {
  const reader = new BufferedStreamReader(socket.readable);
  const writer = socket.writable.getWriter();
  try {
    await writer.write(connectRequest(credentials, target));

    const head = await readResponseHead(reader);
    if (head.status < 200 || head.status >= 300) {
      throw new ProxyError(
        `HTTP proxy refused CONNECT to ${authority(target)}: ${head.status} ${head.statusText}`.trimEnd()
      );
    }

    return reader.takeBuffered();
  } finally {
    reader.release();
    writer.releaseLock();
  }
}

function connectRequest(
  credentials: Credentials,
  target: TunnelTarget
): Uint8Array {
  const lines = [
    `CONNECT ${authority(target)} HTTP/1.1`,
    `Host: ${authority(target)}`,
  ];
  if (hasAuth(credentials)) {
    lines.push(
      `Proxy-Authorization: ${basicAuth(credentials.username, credentials.password)}`
    );
  }
  lines.push("\r\n");
  return new TextEncoder().encode(lines.join("\r\n"));
}

function authority(target: TunnelTarget): string {
  const needsBrackets =
    target.hostname.includes(":") && !target.hostname.startsWith("[");
  const host = needsBrackets ? `[${target.hostname}]` : target.hostname;
  return `${host}:${target.port}`;
}
