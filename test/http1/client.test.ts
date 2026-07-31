import { describe, expect, it } from "vitest";
import { sendRequest } from "../../src/http1/client";
import { BufferedStreamReader } from "../../src/io/reader";
import { decode, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";
import type { FakeSocketPair } from "../utils/fake-socket";

async function readRequestHead(
  reader: BufferedStreamReader
): Promise<string[]> {
  const lines: string[] = [];
  for (;;) {
    const line = await reader.readLine();
    if (line === "") return lines;
    lines.push(line);
  }
}

function respond(pair: FakeSocketPair, raw: string): Promise<void> {
  const writer = pair.server.writable.getWriter();
  return writer.write(text(raw)).then(() => writer.close());
}

describe("sendRequest", () => {
  it("performs a GET round trip", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      const lines = await readRequestHead(reader);
      expect(lines[0]).toBe("GET /path HTTP/1.1");
      expect(lines).toContain("Host: example.com");
      await respond(
        pair,
        "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 5\r\n\r\nhello"
      );
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/path")
    );
    await server;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("hello");
  });

  it("sends the buffered request body with a Content-Length", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      const lines = await readRequestHead(reader);
      expect(lines).toContain("Content-Length: 5");
      expect(decode(await reader.readExact(5))).toBe("hello");
      await respond(pair, "HTTP/1.1 201 Created\r\ncontent-length: 0\r\n\r\n");
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/", {
        method: "POST",
        body: "hello",
      })
    );
    await server;

    expect(response.status).toBe(201);
  });

  it("decodes a chunked response body", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(
        pair,
        "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"
      );
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    expect(await response.text()).toBe("hello world");
  });

  it("reads a close-delimited response body until EOF", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 200 OK\r\n\r\nuntil the end");
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    expect(await response.text()).toBe("until the end");
  });

  it("returns a null body for 204 responses", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 204 No Content\r\n\r\n");
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("does not read a body for HEAD requests", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\n");
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/", { method: "HEAD" })
    );
    await server;

    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("5");
  });

  it("skips informational responses", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(
        pair,
        "HTTP/1.1 103 Early Hints\r\nlink: </s.css>; rel=preload\r\n\r\n" +
          "HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"
      );
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("closes the socket once the body is consumed", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nhello");
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    expect(pair.closed()).toBe(false);
    await response.text();
    expect(pair.closed()).toBe(true);
  });

  it("closes the socket immediately for bodyless responses", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 204 No Content\r\n\r\n");
    })();

    await sendRequest(pair.socket, new Request("http://example.com/"));
    await server;

    expect(pair.closed()).toBe(true);
  });

  it("closes the socket when the exchange fails", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "not http at all\r\n\r\n");
    })();

    await expect(
      sendRequest(pair.socket, new Request("http://example.com/"))
    ).rejects.toThrow(/status line/);
    await server;

    expect(pair.closed()).toBe(true);
  });

  it("cancelling the response body closes the socket", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nhello");
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    await response.body!.cancel();
    expect(pair.closed()).toBe(true);
  });

  it("closes the socket when the body errors mid-stream", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(
        pair,
        "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\nzz\r\n"
      );
    })();

    const response = await sendRequest(
      pair.socket,
      new Request("http://example.com/")
    );
    await server;

    await expect(response.text()).rejects.toThrow(/chunk size/);
    expect(pair.closed()).toBe(true);
  });

  it("rejects an invalid Content-Length", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 200 OK\r\ncontent-length: nope\r\n\r\n");
    })();

    await expect(
      sendRequest(pair.socket, new Request("http://example.com/"))
    ).rejects.toThrow(/Content-Length/);
    await server;
  });

  it("rejects an endless stream of informational responses", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      await readRequestHead(reader);
      await respond(pair, "HTTP/1.1 100 Continue\r\n\r\n".repeat(11));
    })();

    await expect(
      sendRequest(pair.socket, new Request("http://example.com/"))
    ).rejects.toThrow(/informational/);
    await server;
  });

  it("passes extra headers through to the request head", async () => {
    const pair = createFakeSocketPair();
    const reader = new BufferedStreamReader(pair.server.readable);

    const server = (async () => {
      const lines = await readRequestHead(reader);
      expect(lines).toContain("Proxy-Authorization: Basic dTpw");
      await respond(pair, "HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n");
    })();

    await sendRequest(pair.socket, new Request("http://example.com/"), {
      headers: { "Proxy-Authorization": "Basic dTpw" },
    });
    await server;
  });
});
