import { describe, expect, it } from "vitest";
import { handshake } from "../../src/http/handshake";
import { BufferedStreamReader } from "../../src/io/reader";
import { ProxyError } from "../../src/shared/error";
import { text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";

const target = { hostname: "example.com", port: 443 };
const proxy = { host: "proxy.example", port: 8080 };

function serverSide(pair: FakeSocketPair): {
  readHead: () => Promise<string[]>;
  write: (raw: string) => Promise<void>;
} {
  const reader = new BufferedStreamReader(pair.server.readable);
  const writer = pair.server.writable.getWriter();
  return {
    readHead: async () => {
      const lines: string[] = [];
      for (;;) {
        const line = await reader.readLine();
        if (line === "") return lines;
        lines.push(line);
      }
    },
    write: (raw) => writer.write(text(raw)),
  };
}

describe("http CONNECT handshake", () => {
  it("sends CONNECT and resolves on a 200 response", async () => {
    const pair = createFakeSocketPair();
    const { readHead, write } = serverSide(pair);

    const server = (async () => {
      const lines = await readHead();
      expect(lines[0]).toBe("CONNECT example.com:443 HTTP/1.1");
      expect(lines).toContain("Host: example.com:443");
      expect(lines.join(",")).not.toContain("Proxy-Authorization");
      await write("HTTP/1.1 200 Connection Established\r\n\r\n");
    })();

    await expect(handshake(pair.socket, proxy, target)).resolves.toEqual(
      new Uint8Array(0)
    );
    await server;
  });

  it("sends Proxy-Authorization when credentials are present", async () => {
    const pair = createFakeSocketPair();
    const { readHead, write } = serverSide(pair);

    const server = (async () => {
      const lines = await readHead();
      expect(lines).toContain("Proxy-Authorization: Basic dXNlcjpwYXNz");
      await write("HTTP/1.1 200 OK\r\n\r\n");
    })();

    await handshake(
      pair.socket,
      { ...proxy, username: "user", password: "pass" },
      target
    );
    await server;
  });

  it("brackets IPv6 target hosts", async () => {
    const pair = createFakeSocketPair();
    const { readHead, write } = serverSide(pair);

    const server = (async () => {
      const lines = await readHead();
      expect(lines[0]).toBe("CONNECT [2001:db8::1]:443 HTTP/1.1");
      await write("HTTP/1.1 200 OK\r\n\r\n");
    })();

    await handshake(pair.socket, proxy, {
      hostname: "2001:db8::1",
      port: 443,
    });
    await server;
  });

  it("rejects with the response status on failure", async () => {
    const pair = createFakeSocketPair();
    const { readHead, write } = serverSide(pair);

    const server = (async () => {
      await readHead();
      await write(
        "HTTP/1.1 407 Proxy Authentication Required\r\ncontent-length: 0\r\n\r\n"
      );
    })();

    const failure = handshake(pair.socket, proxy, target);
    await expect(failure).rejects.toThrow(ProxyError);
    await expect(failure).rejects.toThrow(/407/);
    await server;
  });

  it("returns bytes the server sent right after the response head", async () => {
    const pair = createFakeSocketPair();
    const { readHead, write } = serverSide(pair);

    const server = (async () => {
      await readHead();
      await write("HTTP/1.1 200 OK\r\n\r\nearly data");
    })();

    expect(await handshake(pair.socket, proxy, target)).toEqual(
      text("early data")
    );
    await server;
  });

  it("leaves the socket streams unlocked afterwards", async () => {
    const pair = createFakeSocketPair();
    const { readHead, write } = serverSide(pair);

    const server = (async () => {
      await readHead();
      await write("HTTP/1.1 200 OK\r\n\r\n");
    })();

    await handshake(pair.socket, proxy, target);
    await server;

    expect(pair.socket.readable.locked).toBe(false);
    expect(pair.socket.writable.locked).toBe(false);
  });
});
