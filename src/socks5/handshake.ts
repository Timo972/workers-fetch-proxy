import { BufferedStreamReader } from "../io/reader";
import type { Credentials } from "../shared/credentials";
import { hasAuth } from "../shared/credentials";
import { ProxyError } from "../shared/error";
import type { TunnelStreams, TunnelTarget } from "../shared/target";
import {
  AuthMethod,
  encodeConnectRequest,
  encodeGreeting,
  encodeUserPassAuth,
  readConnectReply,
  readMethodSelection,
  readUserPassStatus,
  replyCodeMessage,
} from "./packets";

/**
 * Performs the SOCKS5 handshake (RFC 1928) on a freshly opened socket to the
 * proxy, so the socket becomes a tunnel to `target` afterwards.
 *
 * Returns bytes the server sent past the handshake; they belong to the
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
    await writer.write(encodeGreeting(offeredMethods(credentials)));
    const method = await readMethodSelection(reader);
    await authenticate(method, credentials, reader, writer);

    await writer.write(encodeConnectRequest(target.hostname, target.port));
    const { code } = await readConnectReply(reader);
    if (code !== 0) {
      throw new ProxyError(
        `SOCKS5 connect to ${target.hostname}:${target.port} failed: ${replyCodeMessage(code)}`
      );
    }

    return reader.takeBuffered();
  } finally {
    reader.release();
    writer.releaseLock();
  }
}

function offeredMethods(credentials: Credentials): AuthMethod[] {
  return hasAuth(credentials)
    ? [AuthMethod.NoAuthenticationRequired, AuthMethod.UsernamePassword]
    : [AuthMethod.NoAuthenticationRequired];
}

async function authenticate(
  method: number,
  credentials: Credentials,
  reader: BufferedStreamReader,
  writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
  if (method === AuthMethod.NoAuthenticationRequired) {
    return;
  }
  if (method === AuthMethod.UsernamePassword && hasAuth(credentials)) {
    await writer.write(
      encodeUserPassAuth(credentials.username, credentials.password)
    );
    const status = await readUserPassStatus(reader);
    if (status !== 0) {
      throw new ProxyError("SOCKS5 authentication failed");
    }
    return;
  }
  throw new ProxyError(
    `SOCKS5 server selected unsupported auth method 0x${method.toString(16)}`
  );
}
