import { describe, expect, it } from "vitest";
import { basicAuth } from "../../src/shared/basic-auth";

describe("basicAuth", () => {
  it("encodes username and password as base64", () => {
    expect(basicAuth("user", "pass")).toBe("Basic dXNlcjpwYXNz");
  });

  it("encodes non-latin1 characters as UTF-8", () => {
    // "ü:p" in UTF-8 is 0xc3 0xbc 0x3a 0x70
    expect(basicAuth("ü", "p")).toBe("Basic w7w6cA==");
  });
});
