import { describe, expect, it } from "vitest";
import { parseIPv4, parseIPv6 } from "../../src/shared/ip";
import { bytes } from "../utils/bytes";

describe("parseIPv4", () => {
  it("parses a dotted quad into 4 bytes", () => {
    expect(parseIPv4("192.168.0.1")).toEqual(bytes(192, 168, 0, 1));
  });

  it("parses boundary octets", () => {
    expect(parseIPv4("0.0.0.0")).toEqual(bytes(0, 0, 0, 0));
    expect(parseIPv4("255.255.255.255")).toEqual(bytes(255, 255, 255, 255));
  });

  it("rejects octets above 255", () => {
    expect(parseIPv4("256.0.0.1")).toBeUndefined();
  });

  it("rejects wrong segment counts", () => {
    expect(parseIPv4("1.2.3")).toBeUndefined();
    expect(parseIPv4("1.2.3.4.5")).toBeUndefined();
  });

  it("rejects hostnames", () => {
    expect(parseIPv4("example.com")).toBeUndefined();
  });

  it("rejects empty and non-numeric segments", () => {
    expect(parseIPv4("1..2.3")).toBeUndefined();
    expect(parseIPv4("1.2.3.a")).toBeUndefined();
  });
});

describe("parseIPv6", () => {
  it("parses a full address into 16 bytes", () => {
    expect(parseIPv6("2001:db8:0:0:0:0:0:1")).toEqual(
      bytes(0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
    );
  });

  it("expands :: compression", () => {
    expect(parseIPv6("2001:db8::1")).toEqual(
      bytes(0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
    );
  });

  it("parses the loopback address ::1", () => {
    expect(parseIPv6("::1")).toEqual(
      bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
    );
  });

  it("parses the unspecified address ::", () => {
    expect(parseIPv6("::")).toEqual(new Uint8Array(16));
  });

  it("parses trailing embedded IPv4", () => {
    expect(parseIPv6("::ffff:192.168.0.1")).toEqual(
      bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 192, 168, 0, 1)
    );
  });

  it("rejects more than one ::", () => {
    expect(parseIPv6("1::2::3")).toBeUndefined();
  });

  it("rejects too many groups", () => {
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeUndefined();
  });

  it("rejects compression that cannot stand for any zeros", () => {
    expect(parseIPv6("1:2:3:4:5:6:7::8")).toBeUndefined();
  });

  it("rejects too few groups without compression", () => {
    expect(parseIPv6("1:2:3")).toBeUndefined();
  });

  it("rejects groups above ffff or non-hex", () => {
    expect(parseIPv6("2001:db8::10000")).toBeUndefined();
    expect(parseIPv6("2001:db8::zzzz")).toBeUndefined();
  });

  it("rejects hostnames", () => {
    expect(parseIPv6("example.com")).toBeUndefined();
  });
});
