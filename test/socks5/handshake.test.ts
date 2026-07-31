import { describe, expect, it } from "vitest";
import { BufferedStreamReader } from "../../src/io/reader";
import { ProxyError } from "../../src/shared/error";
import { handshake } from "../../src/socks5/handshake";
import { bytes, concat, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";

const target = { hostname: "example.com", port: 443 };

const connectRequest = bytes(
  0x05,
  0x01,
  0x00,
  0x03,
  11,
  ...text("example.com"),
  0x01,
  0xbb
);

const successReply = bytes(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0);

function serverSide(pair: FakeSocketPair): {
  reader: BufferedStreamReader;
  write: (data: Uint8Array) => Promise<void>;
} {
  const reader = new BufferedStreamReader(pair.server.readable);
  const writer = pair.server.writable.getWriter();
  return { reader, write: (data) => writer.write(data) };
}

describe("socks5 handshake", () => {
  it("negotiates no-auth and connects", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      expect(await reader.readExact(3)).toEqual(bytes(0x05, 0x01, 0x00));
      await write(bytes(0x05, 0x00));
      expect(await reader.readExact(connectRequest.length)).toEqual(
        connectRequest
      );
      await write(successReply);
    })();

    await expect(
      handshake(pair.socket, { host: "proxy", port: 1080 }, target)
    ).resolves.toEqual(bytes());
    await server;
  });

  it("offers username/password when credentials are present", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      expect(await reader.readExact(4)).toEqual(bytes(0x05, 0x02, 0x00, 0x02));
      await write(bytes(0x05, 0x02));
      expect(await reader.readExact(9)).toEqual(
        bytes(0x01, 2, ...text("us"), 4, ...text("pass"))
      );
      await write(bytes(0x01, 0x00));
      await reader.readExact(connectRequest.length);
      await write(successReply);
    })();

    await handshake(
      pair.socket,
      { host: "proxy", port: 1080, username: "us", password: "pass" },
      target
    );
    await server;
  });

  it("skips authentication when the server selects no-auth", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(4);
      await write(bytes(0x05, 0x00));
      expect(await reader.readExact(connectRequest.length)).toEqual(
        connectRequest
      );
      await write(successReply);
    })();

    await handshake(
      pair.socket,
      { host: "proxy", port: 1080, username: "us", password: "pass" },
      target
    );
    await server;
  });

  it("rejects when authentication fails", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(4);
      await write(bytes(0x05, 0x02));
      await reader.readExact(9);
      await write(bytes(0x01, 0x01));
    })();

    await expect(
      handshake(
        pair.socket,
        { host: "proxy", port: 1080, username: "us", password: "pass" },
        target
      )
    ).rejects.toThrow(/authentication failed/);
    await server;
  });

  it("rejects when the server accepts none of the offered methods", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(3);
      await write(bytes(0x05, 0xff));
    })();

    await expect(
      handshake(pair.socket, { host: "proxy", port: 1080 }, target)
    ).rejects.toThrow(ProxyError);
    await server;
  });

  it("rejects when the server selects a method that was not offered", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(3);
      await write(bytes(0x05, 0x02));
    })();

    await expect(
      handshake(pair.socket, { host: "proxy", port: 1080 }, target)
    ).rejects.toThrow(/method/);
    await server;
  });

  it("rejects with the reply message when the connect is refused", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(3);
      await write(bytes(0x05, 0x00));
      await reader.readExact(connectRequest.length);
      await write(bytes(0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0));
    })();

    await expect(
      handshake(pair.socket, { host: "proxy", port: 1080 }, target)
    ).rejects.toThrow(/connection refused/);
    await server;
  });

  it("returns bytes the server sent right after the reply", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(3);
      await write(bytes(0x05, 0x00));
      await reader.readExact(connectRequest.length);
      await write(concat(successReply, text("early data")));
    })();

    const leftover = await handshake(
      pair.socket,
      { host: "proxy", port: 1080 },
      target
    );

    expect(leftover).toEqual(text("early data"));
    await server;
  });

  it("leaves the socket streams unlocked afterwards", async () => {
    const pair = createFakeSocketPair();
    const { reader, write } = serverSide(pair);

    const server = (async () => {
      await reader.readExact(3);
      await write(bytes(0x05, 0x00));
      await reader.readExact(connectRequest.length);
      await write(successReply);
    })();

    await handshake(pair.socket, { host: "proxy", port: 1080 }, target);
    await server;

    expect(pair.socket.readable.locked).toBe(false);
    expect(pair.socket.writable.locked).toBe(false);
  });
});
