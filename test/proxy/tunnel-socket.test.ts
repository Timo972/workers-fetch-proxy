import { describe, expect, it } from "vitest";
import { tunnelSocket } from "../../src/proxy/tunnel-socket";
import { bytes, readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";

describe("tunnelSocket", () => {
  it("returns the inner socket unchanged when there is no leftover", () => {
    const pair = createFakeSocketPair();

    expect(tunnelSocket(pair.socket, bytes())).toBe(pair.socket);
  });

  it("replays leftover bytes before the socket's own data", async () => {
    const pair = createFakeSocketPair();
    const writer = pair.server.writable.getWriter();
    await writer.write(text(" world"));
    await writer.close();

    const socket = tunnelSocket(pair.socket, text("hello"));

    expect(await readAll(socket.readable)).toEqual(text("hello world"));
  });

  it("delegates writes to the inner socket", async () => {
    const pair = createFakeSocketPair();
    const socket = tunnelSocket(pair.socket, text("x"));

    const clientWriter = socket.writable.getWriter();
    await clientWriter.write(text("ping"));
    await clientWriter.close();

    expect(await readAll(pair.server.readable)).toEqual(text("ping"));
  });

  it("delegates close to the inner socket", async () => {
    const pair = createFakeSocketPair();
    const socket = tunnelSocket(pair.socket, text("x"));

    await socket.close();

    expect(pair.closed()).toBe(true);
  });

  it("delegates the informational getters to the inner socket", () => {
    const pair = createFakeSocketPair();
    const socket = tunnelSocket(pair.socket, text("x"));

    expect(socket.closed).toBe(pair.socket.closed);
    expect(socket.opened).toBe(pair.socket.opened);
    expect(socket.upgraded).toBe(pair.socket.upgraded);
    expect(socket.secureTransport).toBe(pair.socket.secureTransport);
  });

  it("refuses startTls once tunnel data has arrived", () => {
    const pair = createFakeSocketPair({
      secureTransport: "starttls",
      allowHalfOpen: false,
    });
    const socket = tunnelSocket(pair.socket, text("early"));

    expect(() => socket.startTls()).toThrow(/data/);
  });
});
