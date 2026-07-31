import { prependBytes } from "../io/streams";
import { ProxyError } from "../shared/error";
import type { Tunnel } from "./tunnel";

const EMPTY = new Uint8Array(0);

/**
 * Presents a tunnel that is still being established as a synchronous
 * `Socket`, mirroring how `connect()` from `cloudflare:sockets` hands back a
 * not-yet-connected socket. The streams, `opened`, `close()` and `startTls`
 * all wait on `tunnel` internally, so a caller gets a usable `Socket`
 * immediately and the handshake completes in the background. Bytes the
 * handshake over-read (`leftover`) are replayed in front of the readable.
 */
export function tunnelSocket(
  tunnel: Promise<Tunnel>,
  secureTransport: "off" | "starttls" | "on"
): Socket {
  // An abandoned socket must not turn a handshake failure into an unhandled
  // rejection; each accessor below still attaches its own handler.
  tunnel.catch(() => {});

  let readable: ReadableStream<Uint8Array> | undefined;
  let writable: WritableStream<Uint8Array> | undefined;
  let upgraded = false;

  const socket: Socket = {
    get readable() {
      return (readable ??= lazyReadable(tunnel));
    },
    get writable() {
      return (writable ??= lazyWritable(tunnel));
    },
    get opened() {
      return tunnel.then(({ socket }) => socket.opened);
    },
    get closed() {
      return tunnel.then(
        ({ socket }) => socket.closed,
        () => undefined
      );
    },
    get upgraded() {
      return upgraded;
    },
    get secureTransport() {
      return secureTransport;
    },
    close() {
      return tunnel.then(
        ({ socket }) => socket.close(),
        () => undefined
      );
    },
    startTls(options?: TlsOptions) {
      if (secureTransport !== "starttls") {
        throw new ProxyError(
          "startTls() is only valid on a tunnel opened with secureTransport 'starttls'"
        );
      }
      upgraded = true;
      return tunnelSocket(
        tunnel.then((t) => upgrade(t, options)),
        "on"
      );
    },
  };
  return socket;
}

function upgrade(tunnel: Tunnel, options?: TlsOptions): Tunnel {
  if (tunnel.leftover.length > 0) {
    tunnel.socket.close().catch(() => {});
    throw new ProxyError(
      "cannot start TLS: the tunnel already received application data"
    );
  }
  return { socket: tunnel.socket.startTls(options), leftover: EMPTY };
}

function lazyReadable(tunnel: Promise<Tunnel>): ReadableStream<Uint8Array> {
  let source: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream({
    async pull(controller) {
      if (!source) {
        const { socket, leftover } = await tunnel;
        source = prependBytes(leftover, socket.readable).getReader();
      }
      const { value, done } = await source.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return source
        ? source.cancel(reason)
        : tunnel.then(
            ({ socket }) => socket.readable.cancel(reason),
            () => undefined
          );
    },
  });
}

function lazyWritable(tunnel: Promise<Tunnel>): WritableStream<Uint8Array> {
  let sink: WritableStreamDefaultWriter<Uint8Array> | undefined;
  return new WritableStream({
    async write(chunk) {
      sink ??= (await tunnel).socket.writable.getWriter();
      await sink.write(chunk);
    },
    async close() {
      await (sink
        ? sink.close()
        : tunnel.then(({ socket }) => socket.writable.close()));
    },
  });
}
