import { describe, expect, it } from "vitest";
import { BufferedStreamReader } from "../../src/io/reader";
import {
  AuthMethod,
  encodeConnectRequest,
  encodeGreeting,
  encodeUserPassAuth,
  readConnectReply,
  readMethodSelection,
  readUserPassStatus,
  replyCodeMessage,
} from "../../src/socks5/packets";
import { bytes, streamFrom, text } from "../utils/bytes";

function readerFor(...data: number[]): BufferedStreamReader {
  return new BufferedStreamReader(streamFrom(bytes(...data)));
}

describe("encodeGreeting", () => {
  it("encodes version, method count and methods", () => {
    expect(
      encodeGreeting([
        AuthMethod.NoAuthenticationRequired,
        AuthMethod.UsernamePassword,
      ])
    ).toEqual(bytes(0x05, 0x02, 0x00, 0x02));
  });
});

describe("readMethodSelection", () => {
  it("returns the selected method", async () => {
    expect(await readMethodSelection(readerFor(0x05, 0x02))).toBe(
      AuthMethod.UsernamePassword
    );
  });

  it("throws on a version mismatch", async () => {
    await expect(readMethodSelection(readerFor(0x04, 0x00))).rejects.toThrow(
      /version/
    );
  });
});

describe("encodeUserPassAuth", () => {
  it("encodes username and password with length prefixes", () => {
    expect(encodeUserPassAuth("user", "pw")).toEqual(
      bytes(0x01, 4, 0x75, 0x73, 0x65, 0x72, 2, 0x70, 0x77)
    );
  });

  it("measures lengths in UTF-8 bytes", () => {
    // ü encodes to two bytes (0xc3 0xbc)
    expect(encodeUserPassAuth("ü", "p")).toEqual(
      bytes(0x01, 2, 0xc3, 0xbc, 1, 0x70)
    );
  });

  it("rejects a username longer than 255 bytes", () => {
    expect(() => encodeUserPassAuth("a".repeat(256), "p")).toThrow(/username/);
  });

  it("rejects a password longer than 255 bytes", () => {
    expect(() => encodeUserPassAuth("u", "a".repeat(256))).toThrow(/password/);
  });
});

describe("readUserPassStatus", () => {
  it("returns the status byte", async () => {
    expect(await readUserPassStatus(readerFor(0x01, 0x00))).toBe(0);
    expect(await readUserPassStatus(readerFor(0x01, 0x01))).toBe(1);
  });
});

describe("encodeConnectRequest", () => {
  it("encodes a domain target with ATYP 0x03", () => {
    expect(encodeConnectRequest("example.com", 443)).toEqual(
      bytes(0x05, 0x01, 0x00, 0x03, 11, ...text("example.com"), 0x01, 0xbb)
    );
  });

  it("encodes an IPv4 literal with ATYP 0x01", () => {
    expect(encodeConnectRequest("192.168.0.1", 80)).toEqual(
      bytes(0x05, 0x01, 0x00, 0x01, 192, 168, 0, 1, 0x00, 0x50)
    );
  });

  it("encodes an IPv6 literal with ATYP 0x04", () => {
    expect(encodeConnectRequest("2001:db8::1", 443)).toEqual(
      bytes(
        0x05,
        0x01,
        0x00,
        0x04,
        0x20,
        0x01,
        0x0d,
        0xb8,
        ...Array.from<number>({ length: 11 }).fill(0),
        0x01,
        0x01,
        0xbb
      )
    );
  });

  it("strips brackets from IPv6 literals as produced by URL.hostname", () => {
    expect(encodeConnectRequest("[2001:db8::1]", 443)).toEqual(
      encodeConnectRequest("2001:db8::1", 443)
    );
  });

  it("rejects a domain longer than 255 bytes", () => {
    expect(() => encodeConnectRequest("a".repeat(256), 80)).toThrow(/host/);
  });
});

describe("readConnectReply", () => {
  it("parses a success reply with an IPv4 bound address", async () => {
    const reader = readerFor(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0);

    expect(await readConnectReply(reader)).toEqual({ code: 0 });
  });

  it("consumes the whole reply and leaves following bytes intact", async () => {
    const reader = readerFor(
      0x05,
      0x00,
      0x00,
      0x01,
      0,
      0,
      0,
      0,
      0,
      0,
      0xaa,
      0xbb
    );

    await readConnectReply(reader);

    expect(reader.takeBuffered()).toEqual(bytes(0xaa, 0xbb));
  });

  it("consumes a domain bound address", async () => {
    const reader = readerFor(
      0x05,
      0x00,
      0x00,
      0x03,
      4,
      0x74,
      0x65,
      0x73,
      0x74,
      0x1f,
      0x90,
      0xcc
    );

    await readConnectReply(reader);

    expect(reader.takeBuffered()).toEqual(bytes(0xcc));
  });

  it("consumes an IPv6 bound address", async () => {
    const reader = readerFor(
      0x05,
      0x00,
      0x00,
      0x04,
      ...(Array.from({ length: 16 }).fill(0) as number[]),
      0x00,
      0x50,
      0xdd
    );

    await readConnectReply(reader);

    expect(reader.takeBuffered()).toEqual(bytes(0xdd));
  });

  it("returns error reply codes", async () => {
    const reader = readerFor(0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0);

    expect(await readConnectReply(reader)).toEqual({ code: 5 });
  });

  it("throws on a version mismatch", async () => {
    await expect(
      readConnectReply(readerFor(0x04, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0))
    ).rejects.toThrow(/version/);
  });

  it("throws on an unknown address type", async () => {
    await expect(
      readConnectReply(readerFor(0x05, 0x00, 0x00, 0x02, 0, 0))
    ).rejects.toThrow(/address type/);
  });
});

describe("replyCodeMessage", () => {
  it("maps known reply codes to their RFC 1928 messages", () => {
    expect(replyCodeMessage(1)).toBe("general SOCKS server failure");
    expect(replyCodeMessage(2)).toBe("connection not allowed by ruleset");
    expect(replyCodeMessage(5)).toBe("connection refused");
  });

  it("falls back to the numeric code for unknown values", () => {
    expect(replyCodeMessage(0x42)).toMatch(/0x42/);
  });
});
