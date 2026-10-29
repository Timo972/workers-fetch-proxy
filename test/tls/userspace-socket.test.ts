import { describe, expect, it } from "vitest";
import { ProxyError } from "../../src/shared/error";
import type { TlsSession } from "../../src/tls/userspace-socket";
import { userspaceTlsSocket } from "../../src/tls/userspace-socket";
import { readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";

function fakeSession(chunks: Uint8Array[]): {
  session: TlsSession;
  written: Uint8Array[];
} {
  const written: Uint8Array[] = [];
  return {
    written,
    session: {
      read: async () => chunks.shift(),
      write: async (data) => {
        written.push(data);
      },
    },
  };
}

describe("userspaceTlsSocket", () => {
  it("reads decrypted chunks until the session ends", async () => {
    const pair = createFakeSocketPair();
    const { session } = fakeSession([text("hel"), text("lo")]);
    const socket = userspaceTlsSocket(pair.socket, Promise.resolve(session));

    expect(new TextDecoder().decode(await readAll(socket.readable))).toBe(
      "hello"
    );
  });

  it("writes through the session", async () => {
    const pair = createFakeSocketPair();
    const { session, written } = fakeSession([]);
    const socket = userspaceTlsSocket(pair.socket, Promise.resolve(session));

    const writer = socket.writable.getWriter();
    await writer.write(text("ping"));

    expect(written).toEqual([text("ping")]);
  });

  it("reports itself as a TLS socket that cannot be upgraded again", () => {
    const pair = createFakeSocketPair();
    const socket = userspaceTlsSocket(
      pair.socket,
      Promise.resolve(fakeSession([]).session)
    );

    expect(socket.secureTransport).toBe("on");
    expect(() => socket.startTls()).toThrow(ProxyError);
  });

  it("closes the tunnel and fails reads when the handshake fails", async () => {
    const pair = createFakeSocketPair();
    const socket = userspaceTlsSocket(
      pair.socket,
      Promise.reject(new Error("bad certificate"))
    );

    await expect(socket.opened).rejects.toThrow("bad certificate");
    await expect(socket.readable.getReader().read()).rejects.toThrow(
      "bad certificate"
    );
    expect(pair.closed()).toBe(true);
  });
});
