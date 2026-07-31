import { describe, expect, it } from "vitest";
import { readResponseHead } from "../../src/http1/response";
import { BufferedStreamReader } from "../../src/io/reader";
import { streamFrom, text } from "../utils/bytes";

function readerFor(raw: string): BufferedStreamReader {
  return new BufferedStreamReader(streamFrom(text(raw)));
}

describe("readResponseHead", () => {
  it("parses status, status text and headers", async () => {
    const head = await readResponseHead(
      readerFor(
        "HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\nx-a: 1\r\n\r\n"
      )
    );

    expect(head.status).toBe(404);
    expect(head.statusText).toBe("Not Found");
    expect(head.headers.get("content-type")).toBe("text/plain");
    expect(head.headers.get("x-a")).toBe("1");
  });

  it("accepts HTTP/1.0 responses", async () => {
    const head = await readResponseHead(readerFor("HTTP/1.0 200 OK\r\n\r\n"));

    expect(head.status).toBe(200);
  });

  it("accepts an empty status text", async () => {
    const head = await readResponseHead(readerFor("HTTP/1.1 204\r\n\r\n"));

    expect(head.status).toBe(204);
    expect(head.statusText).toBe("");
  });

  it("combines repeated headers", async () => {
    const head = await readResponseHead(
      readerFor("HTTP/1.1 200 OK\r\nvary: a\r\nvary: b\r\n\r\n")
    );

    expect(head.headers.get("vary")).toBe("a, b");
  });

  it("trims whitespace around header values", async () => {
    const head = await readResponseHead(
      readerFor("HTTP/1.1 200 OK\r\nx-a:   spaced   \r\n\r\n")
    );

    expect(head.headers.get("x-a")).toBe("spaced");
  });

  it("leaves body bytes unconsumed", async () => {
    const reader = readerFor("HTTP/1.1 200 OK\r\n\r\nbody");

    await readResponseHead(reader);

    expect(await reader.readExact(4)).toEqual(text("body"));
  });

  it("rejects a malformed status line", async () => {
    await expect(
      readResponseHead(readerFor("SSH-2.0-OpenSSH\r\n\r\n"))
    ).rejects.toThrow(/status line/);
  });

  it("rejects a malformed header line", async () => {
    await expect(
      readResponseHead(readerFor("HTTP/1.1 200 OK\r\nbroken\r\n\r\n"))
    ).rejects.toThrow(/header/);
  });
});
