import { LazyReadFunctionReadQueue, TrustedCert, startTls } from "subtls";
import type { TlsSession, TlsUpgrade } from "../tls/userspace-socket";
import { userspaceTlsSocket } from "../tls/userspace-socket";

export type { TlsUpgrade } from "../tls/userspace-socket";

export interface SubtlsOptions {
  /**
   * PEM-encoded root certificates to trust, one or more concatenated. Each
   * server chain must lead to one of them; nothing else is trusted.
   */
  rootCertificates: string;
}

/**
 * TLS in JavaScript via [subtls](https://github.com/jawj/subtls) instead of
 * the runtime's `startTls()`. Its handshake differs from the Workers
 * runtime's, which helps with servers that reject that handshake, and it can
 * run inside an HTTPS proxy's TLS session.
 *
 * subtls supports TLS 1.3 only (TLS_AES_128_GCM_SHA256, P-256), verifies
 * server names by hostname, and describes itself as not production-ready.
 */
export function subtls(options: SubtlsOptions): TlsUpgrade {
  const roots = TrustedCert.databaseFromPEM(options.rootCertificates);
  return (socket, serverName) =>
    userspaceTlsSocket(socket, negotiate(socket, serverName, roots));
}

async function negotiate(
  socket: Socket,
  serverName: string,
  roots: ReturnType<typeof TrustedCert.databaseFromPEM>
): Promise<TlsSession> {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const queue = new LazyReadFunctionReadQueue(async () => {
    const { value, done } = await reader.read();
    return done ? undefined : value;
  });
  const tls = await startTls(
    serverName,
    await roots,
    queue.read.bind(queue),
    (data) => {
      // Ordered by the writer; a failed write surfaces on the next read.
      writer.write(data).catch(() => {});
    }
  );
  return { read: () => tls.read(), write: (data) => tls.write(data) };
}
