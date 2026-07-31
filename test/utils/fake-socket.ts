/**
 * In-memory Socket implementation backed by two TransformStreams, so tests
 * can script the proxy-server side of a connection.
 */

export interface FakeTlsCall {
  options?: TlsOptions;
}

export interface FakeSocketPair {
  /** The client side, handed to production code. */
  socket: Socket;
  /** The server side, driven by the test. */
  server: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
  /** Options recorded from `startTls()` calls. */
  tlsCalls: FakeTlsCall[];
  /** Whether `close()` was called on the client socket. */
  closed: () => boolean;
}

const strategy = { highWaterMark: 1024 };

export function createFakeSocketPair(options?: SocketOptions): FakeSocketPair {
  const clientToServer = new TransformStream<Uint8Array, Uint8Array>(
    undefined,
    strategy,
    strategy
  );
  const serverToClient = new TransformStream<Uint8Array, Uint8Array>(
    undefined,
    strategy,
    strategy
  );

  const tlsCalls: FakeTlsCall[] = [];
  let closeCalled = false;
  let secureTransport = (options?.secureTransport ?? "off") as
    "on" | "off" | "starttls";

  // The real Socket exposes stable promises, so cache them like it does.
  const closedPromise = Promise.resolve();
  const openedPromise = Promise.resolve<SocketInfo>({});

  const socket: Socket = {
    get readable() {
      return serverToClient.readable;
    },
    get writable() {
      return clientToServer.writable;
    },
    get closed() {
      return closedPromise;
    },
    get opened() {
      return openedPromise;
    },
    get upgraded() {
      return tlsCalls.length > 0;
    },
    get secureTransport() {
      return secureTransport;
    },
    async close() {
      closeCalled = true;
      await clientToServer.writable.close().catch(() => {});
      await serverToClient.readable.cancel().catch(() => {});
    },
    startTls(tlsOptions?: TlsOptions) {
      if (secureTransport !== "starttls") {
        throw new Error(
          "startTls() is only allowed on sockets opened with secureTransport 'starttls'"
        );
      }
      tlsCalls.push({ options: tlsOptions });
      secureTransport = "on";
      return socket;
    },
  };

  return {
    socket,
    server: {
      readable: clientToServer.readable,
      writable: serverToClient.writable,
    },
    tlsCalls,
    closed: () => closeCalled,
  };
}
