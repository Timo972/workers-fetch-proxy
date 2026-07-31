import { describe, expect, it } from "vitest";
import { parseSocketAddress } from "../../src/shared/address";

describe("parseSocketAddress", () => {
  it("parses host:port strings", () => {
    expect(parseSocketAddress("example.com:5432")).toEqual({
      hostname: "example.com",
      port: 5432,
    });
  });

  it("parses bracketed IPv6 strings", () => {
    expect(parseSocketAddress("[2001:db8::1]:443")).toEqual({
      hostname: "[2001:db8::1]",
      port: 443,
    });
  });

  it("passes SocketAddress objects through", () => {
    expect(parseSocketAddress({ hostname: "example.com", port: 80 })).toEqual({
      hostname: "example.com",
      port: 80,
    });
  });

  it("rejects strings without a port", () => {
    expect(() => parseSocketAddress("example.com")).toThrow(TypeError);
  });

  it("rejects out-of-range ports", () => {
    expect(() => parseSocketAddress("example.com:0")).toThrow(TypeError);
    expect(() => parseSocketAddress("example.com:65536")).toThrow(TypeError);
  });
});
