import { describe, expect, it } from "vitest";
import type { Tunnel } from "../../src/proxy/tunnel";
import { tunnelSocket } from "../../src/proxy/tunnel-socket";
import { ProxyError } from "../../src/shared/error";
import { bytes, readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";

function tunnelOf(
  leftover: Uint8Array = bytes(),
  options?: SocketOptions
): { pair: FakeSocketPair; tunnel: Promise<Tunnel> } {
  const pair = createFakeSocketPair(options);
  return {
    pair,
    tunnel: Promise.resolve<Tunnel>({ socket: pair.socket, leftover }),
  };
}

const starttls: SocketOptions = {
  secureTransport: "starttls",
  allowHalfOpen: false,
};

describe("tunnelSocket", () => {
  it("streams the tunnel socket's data through readable", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    const writer = pair.server.writable.getWriter();
    await writer.write(text("hello"));
    await writer.close();

    expect(await readAll(socket.readable)).toEqual(text("hello"));
  });

  it("replays leftover bytes before the tunnel data", async () => {
    const { pair, tunnel } = tunnelOf(text("hel"));
    const socket = tunnelSocket(tunnel, "off");

    const writer = pair.server.writable.getWriter();
    await writer.write(text("lo"));
    await writer.close();

    expect(await readAll(socket.readable)).toEqual(text("hello"));
  });

  it("sends writes to the tunnel socket", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    const writer = socket.writable.getWriter();
    await writer.write(text("ping"));
    await writer.close();

    expect(await readAll(pair.server.readable)).toEqual(text("ping"));
  });

  it("resolves opened once the tunnel is established", async () => {
    const { tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    await expect(socket.opened).resolves.toBeDefined();
  });

  it("surfaces a handshake failure on opened", async () => {
    const socket = tunnelSocket(
      Promise.reject(new ProxyError("handshake boom")),
      "off"
    );

    await expect(socket.opened).rejects.toThrow(/handshake boom/);
  });

  it("surfaces a handshake failure when reading", async () => {
    const socket = tunnelSocket(
      Promise.reject(new ProxyError("handshake boom")),
      "off"
    );

    await expect(readAll(socket.readable)).rejects.toThrow(/handshake boom/);
  });

  it("closes the underlying tunnel socket", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    await socket.close();

    expect(pair.closed()).toBe(true);
  });

  it("resolves closed once the underlying socket closes", async () => {
    const { tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    await expect(socket.closed).resolves.toBeUndefined();
  });

  it("resolves closed even when the handshake failed", async () => {
    const socket = tunnelSocket(Promise.reject(new ProxyError("boom")), "off");

    await expect(socket.closed).resolves.toBeUndefined();
  });

  it("cancels the underlying readable when cancelled before reading", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    await socket.readable.cancel();

    // Cancelling the tunnel readable aborts the paired server writable.
    await expect(
      pair.server.writable.getWriter().write(text("x"))
    ).rejects.toThrow();
  });

  it("cancels the underlying readable when cancelled after reading", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    const reader = socket.readable.getReader();
    const serverWriter = pair.server.writable.getWriter();
    await serverWriter.write(text("hi"));
    await reader.read();
    await reader.cancel();

    await expect(serverWriter.write(text("x"))).rejects.toThrow();
  });

  it("swallows a readable cancel after a failed handshake", async () => {
    const socket = tunnelSocket(Promise.reject(new ProxyError("boom")), "off");

    await expect(socket.readable.cancel()).resolves.toBeUndefined();
  });

  it("closes the underlying writable when the write side is closed after writing", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    const writer = socket.writable.getWriter();
    await writer.write(text("hi"));
    await writer.close();

    expect(await readAll(pair.server.readable)).toEqual(text("hi"));
  });

  it("closes the underlying writable when closed without writing", async () => {
    const { pair, tunnel } = tunnelOf();
    const socket = tunnelSocket(tunnel, "off");

    await socket.writable.close();

    expect(await readAll(pair.server.readable)).toEqual(bytes());
  });

  it("reports the secure transport it was created with", () => {
    expect(tunnelSocket(tunnelOf().tunnel, "off").secureTransport).toBe("off");
    expect(tunnelSocket(tunnelOf().tunnel, "starttls").secureTransport).toBe(
      "starttls"
    );
  });

  it("refuses startTls unless opened with 'starttls'", () => {
    const socket = tunnelSocket(tunnelOf().tunnel, "off");

    expect(() => socket.startTls()).toThrow(ProxyError);
  });

  it("upgrades to TLS and streams through the upgraded socket", async () => {
    const { pair, tunnel } = tunnelOf(bytes(), starttls);
    const socket = tunnelSocket(tunnel, "starttls");

    const tls = socket.startTls({ expectedServerHostname: "example.com" });
    expect(tls.secureTransport).toBe("on");

    const writer = tls.writable.getWriter();
    await writer.write(text("x"));
    await writer.close();

    expect(await readAll(pair.server.readable)).toEqual(text("x"));
    expect(pair.tlsCalls).toEqual([
      { options: { expectedServerHostname: "example.com" } },
    ]);
  });

  it("marks the base socket upgraded after startTls", () => {
    const socket = tunnelSocket(tunnelOf(bytes(), starttls).tunnel, "starttls");

    expect(socket.upgraded).toBe(false);
    socket.startTls();
    expect(socket.upgraded).toBe(true);
  });

  it("fails the TLS upgrade if tunnel data arrived first", async () => {
    const { tunnel } = tunnelOf(text("early"), starttls);
    const socket = tunnelSocket(tunnel, "starttls");

    const tls = socket.startTls();

    await expect(tls.opened).rejects.toThrow(/application data/);
  });
});
