import { describe, expect, it } from "vitest";
import {
  chunkedBody,
  closeDelimitedBody,
  fixedLengthBody,
} from "../../src/http1/body";
import { BufferedStreamReader } from "../../src/io/reader";
import { bytes, decode, readAll, streamFrom, text } from "../utils/bytes";

describe("fixedLengthBody", () => {
  it("streams exactly the given number of bytes", async () => {
    const reader = new BufferedStreamReader(streamFrom(text("hello world")));

    const body = await readAll(fixedLengthBody(reader, 5));

    expect(decode(body)).toBe("hello");
  });

  it("assembles the body across chunks", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text("he"), text("ll"), text("o!"))
    );

    expect(decode(await readAll(fixedLengthBody(reader, 5)))).toBe("hello");
  });

  it("completes immediately for a zero-length body", async () => {
    const reader = new BufferedStreamReader(streamFrom());

    expect(await readAll(fixedLengthBody(reader, 0))).toEqual(bytes());
  });

  it("errors when the stream ends before the body is complete", async () => {
    const reader = new BufferedStreamReader(streamFrom(text("he")));

    await expect(readAll(fixedLengthBody(reader, 5))).rejects.toThrow(
      /unexpected EOF/
    );
  });
});

describe("chunkedBody", () => {
  it("decodes chunk sizes and concatenates chunk data", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text("5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"))
    );

    expect(decode(await readAll(chunkedBody(reader)))).toBe("hello world");
  });

  it("parses hexadecimal chunk sizes", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text(`b\r\nhello world\r\n0\r\n\r\n`))
    );

    expect(decode(await readAll(chunkedBody(reader)))).toBe("hello world");
  });

  it("ignores chunk extensions", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text("5;ext=1\r\nhello\r\n0\r\n\r\n"))
    );

    expect(decode(await readAll(chunkedBody(reader)))).toBe("hello");
  });

  it("consumes trailer headers after the last chunk", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text("5\r\nhello\r\n0\r\nExpires: never\r\n\r\nX"))
    );

    await readAll(chunkedBody(reader));

    expect(decode(reader.takeBuffered())).toBe("X");
  });

  it("errors on an invalid chunk size line", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text("zz\r\nhello\r\n"))
    );

    await expect(readAll(chunkedBody(reader))).rejects.toThrow(/chunk size/);
  });
});

describe("closeDelimitedBody", () => {
  it("streams everything until EOF", async () => {
    const reader = new BufferedStreamReader(
      streamFrom(text("hel"), text("lo"))
    );

    expect(decode(await readAll(closeDelimitedBody(reader)))).toBe("hello");
  });

  it("completes for an immediately closed stream", async () => {
    const reader = new BufferedStreamReader(streamFrom());

    expect(await readAll(closeDelimitedBody(reader))).toEqual(bytes());
  });
});
