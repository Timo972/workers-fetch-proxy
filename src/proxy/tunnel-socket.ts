import { prependBytes } from "../io/streams";
import { ProxyError } from "../shared/error";

/**
 * Presents an established tunnel as a `Socket`. When the handshake
 * over-read into tunnel data (`leftover`), those bytes are replayed in
 * front of the socket's readable.
 */
export function tunnelSocket(inner: Socket, leftover: Uint8Array): Socket {
  if (leftover.length === 0) {
    return inner;
  }
  const readable = prependBytes(leftover, inner.readable);
  return {
    get readable() {
      return readable;
    },
    get writable() {
      return inner.writable;
    },
    get closed() {
      return inner.closed;
    },
    get opened() {
      return inner.opened;
    },
    get upgraded() {
      return inner.upgraded;
    },
    get secureTransport() {
      return inner.secureTransport;
    },
    close: () => inner.close(),
    startTls: () => {
      throw new ProxyError(
        "cannot start TLS: the tunnel already received application data"
      );
    },
  };
}
