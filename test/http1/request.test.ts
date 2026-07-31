import { describe, expect, it } from "vitest";
import { serializeRequestHead } from "../../src/http1/request";
import { decode } from "../utils/bytes";

function head(
  request: Request,
  options?: Parameters<typeof serializeRequestHead>[1]
): string {
  return decode(serializeRequestHead(request, options));
}

describe("serializeRequestHead", () => {
  it("serializes an origin-form request line with path and query", () => {
    const result = head(new Request("http://example.com/a/b?q=1"));

    expect(result.split("\r\n")[0]).toBe("GET /a/b?q=1 HTTP/1.1");
  });

  it("serializes an absolute-form request line when asked to", () => {
    const result = head(new Request("http://example.com/a"), {
      form: "absolute",
    });

    expect(result.split("\r\n")[0]).toBe("GET http://example.com/a HTTP/1.1");
  });

  it("uses the request method", () => {
    const result = head(
      new Request("http://example.com/", { method: "DELETE" })
    );

    expect(result.split("\r\n")[0]).toBe("DELETE / HTTP/1.1");
  });

  it("sends a Host header including non-default ports", () => {
    expect(head(new Request("http://example.com/"))).toContain(
      "\r\nHost: example.com\r\n"
    );
    expect(head(new Request("http://example.com:8080/"))).toContain(
      "\r\nHost: example.com:8080\r\n"
    );
  });

  it("asks the server to close the connection", () => {
    expect(head(new Request("http://example.com/"))).toContain(
      "\r\nConnection: close\r\n"
    );
  });

  it("terminates the head with an empty line", () => {
    expect(head(new Request("http://example.com/"))).toMatch(/\r\n\r\n$/);
  });

  it("copies request headers", () => {
    const result = head(
      new Request("http://example.com/", {
        headers: { accept: "application/json", "x-custom": "1" },
      })
    );

    expect(result).toContain("\r\naccept: application/json\r\n");
    expect(result).toContain("\r\nx-custom: 1\r\n");
  });

  it("drops caller-set framing and hop-by-hop headers", () => {
    const result = head(
      new Request("http://example.com/", {
        headers: {
          host: "spoofed.example",
          connection: "keep-alive",
          "content-length": "999",
          "transfer-encoding": "chunked",
        },
      })
    );

    expect(result).not.toContain("spoofed.example");
    expect(result).not.toContain("keep-alive");
    expect(result).not.toContain("999");
    expect(result).not.toContain("chunked");
  });

  it("emits Content-Length when a length is given", () => {
    const result = head(
      new Request("http://example.com/", { method: "POST" }),
      { contentLength: 12 }
    );

    expect(result).toContain("\r\nContent-Length: 12\r\n");
  });

  it("includes extra headers such as Proxy-Authorization", () => {
    const result = head(new Request("http://example.com/"), {
      headers: { "Proxy-Authorization": "Basic dTpw" },
    });

    expect(result).toContain("\r\nProxy-Authorization: Basic dTpw\r\n");
  });
});
