import { ProxyError } from "../shared/error";

/** An established TLS session that encrypts and decrypts in user space. */
export interface TlsSession {
  /** Next chunk of decrypted data, or `undefined` once the peer closed. */
  read(): Promise<Uint8Array | undefined>;
  write(data: Uint8Array): Promise<void>;
}

/**
 * Upgrades a plaintext tunnel socket to TLS in user space, without
 * `startTls()`. Receives the tunnel and the server name to verify.
 */
export type TlsUpgrade = (socket: Socket, serverName: string) => Socket;

/**
 * Presents a user-space TLS session over `raw` as a regular `Socket`. The
 * session is still being negotiated when this returns; streams and `opened`
 * wait on it, and a failed handshake closes `raw`.
 */
export function userspaceTlsSocket(
  raw: Socket,
  session: Promise<TlsSession>
): Socket {
  session.catch(() => {
    raw.close().catch(() => {});
  });

  let readable: ReadableStream<Uint8Array> | undefined;
  let writable: WritableStream<Uint8Array> | undefined;

  return {
    get readable() {
      return (readable ??= new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await (await session).read();
          if (chunk === undefined) {
            controller.close();
          } else {
            controller.enqueue(chunk);
          }
        },
        cancel() {
          return raw.close();
        },
      }));
    },
    get writable() {
      return (writable ??= new WritableStream<Uint8Array>({
        async write(chunk) {
          await (await session).write(chunk);
        },
      }));
    },
    get opened() {
      return session.then(() => raw.opened);
    },
    get closed() {
      return raw.closed;
    },
    get upgraded() {
      return false;
    },
    get secureTransport() {
      return "on" as const;
    },
    close() {
      return raw.close();
    },
    startTls() {
      throw new ProxyError("startTls() is not valid on a TLS socket");
    },
  };
}
