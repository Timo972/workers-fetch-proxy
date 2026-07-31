/**
 * The host the tunnel should be opened to, as seen by the proxy server.
 */
export type TunnelTarget = {
  hostname: string;
  port: number;
};

/**
 * Streams of an established connection. Satisfied by `Socket` from
 * `cloudflare:sockets`.
 */
export type TunnelStreams = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};
