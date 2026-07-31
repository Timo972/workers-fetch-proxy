import { describe, expect, it } from "vitest";
import { BufferedStreamReader } from "../../src/io/reader";
import { bytes, streamFrom, text } from "../utils/bytes";

describe("BufferedStreamReader", () => {
  describe("readExact", () => {
    it("reads exactly n bytes from a single chunk", async () => {
      const reader = new BufferedStreamReader(streamFrom(bytes(1, 2, 3, 4)));

      expect(await reader.readExact(2)).toEqual(bytes(1, 2));
    });

    it("keeps unconsumed bytes for subsequent reads", async () => {
      const reader = new BufferedStreamReader(streamFrom(bytes(1, 2, 3, 4)));

      await reader.readExact(1);

      expect(await reader.readExact(3)).toEqual(bytes(2, 3, 4));
    });

    it("assembles n bytes across multiple chunks", async () => {
      const reader = new BufferedStreamReader(
        streamFrom(bytes(1), bytes(2, 3), bytes(4, 5))
      );

      expect(await reader.readExact(4)).toEqual(bytes(1, 2, 3, 4));
    });

    it("throws on EOF before n bytes arrive", async () => {
      const reader = new BufferedStreamReader(streamFrom(bytes(1, 2)));

      await expect(reader.readExact(3)).rejects.toThrow(/unexpected EOF/);
    });

    it("throws on EOF when the stream is empty", async () => {
      const reader = new BufferedStreamReader(streamFrom());

      await expect(reader.readExact(1)).rejects.toThrow(/unexpected EOF/);
    });
  });

  describe("readLine", () => {
    it("reads a CRLF-terminated line without the terminator", async () => {
      const reader = new BufferedStreamReader(
        streamFrom(text("HTTP/1.1 200 OK\r\nHost: a\r\n"))
      );

      expect(await reader.readLine()).toBe("HTTP/1.1 200 OK");
      expect(await reader.readLine()).toBe("Host: a");
    });

    it("assembles a line across chunk boundaries", async () => {
      const reader = new BufferedStreamReader(
        streamFrom(text("hel"), text("lo\r"), text("\nrest"))
      );

      expect(await reader.readLine()).toBe("hello");
    });

    it("returns an empty string for a bare CRLF", async () => {
      const reader = new BufferedStreamReader(streamFrom(text("\r\n")));

      expect(await reader.readLine()).toBe("");
    });

    it("throws on EOF before the line terminator", async () => {
      const reader = new BufferedStreamReader(
        streamFrom(text("no terminator"))
      );

      await expect(reader.readLine()).rejects.toThrow(/unexpected EOF/);
    });
  });

  describe("readSome", () => {
    it("returns buffered bytes up to max without reading the stream", async () => {
      const reader = new BufferedStreamReader(streamFrom(bytes(1, 2, 3, 4)));
      await reader.readExact(1);

      expect(await reader.readSome(2)).toEqual(bytes(2, 3));
      expect(await reader.readSome(5)).toEqual(bytes(4));
    });

    it("awaits the next chunk when nothing is buffered", async () => {
      const reader = new BufferedStreamReader(
        streamFrom(bytes(1, 2), bytes(3))
      );

      expect(await reader.readSome(10)).toEqual(bytes(1, 2));
      expect(await reader.readSome(10)).toEqual(bytes(3));
    });

    it("returns undefined at EOF", async () => {
      const reader = new BufferedStreamReader(streamFrom(bytes(1)));

      await reader.readSome(10);

      expect(await reader.readSome(10)).toBeUndefined();
    });
  });

  describe("takeBuffered", () => {
    it("returns bytes that were read past the last consume", async () => {
      const reader = new BufferedStreamReader(streamFrom(bytes(1, 2, 3, 4, 5)));

      await reader.readExact(2);

      expect(reader.takeBuffered()).toEqual(bytes(3, 4, 5));
    });

    it("returns an empty array when nothing is buffered", () => {
      const reader = new BufferedStreamReader(streamFrom());

      expect(reader.takeBuffered()).toEqual(bytes());
    });
  });

  describe("release", () => {
    it("allows reading the rest of the stream after release", async () => {
      const stream = streamFrom(bytes(1, 2), bytes(3, 4));
      const reader = new BufferedStreamReader(stream);

      await reader.readExact(2);
      reader.release();

      const rest = await stream.getReader().read();
      expect(rest.value).toEqual(bytes(3, 4));
    });
  });
});
