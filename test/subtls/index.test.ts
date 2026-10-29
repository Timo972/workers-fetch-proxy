import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAll, text } from "../utils/bytes";
import { createFakeSocketPair } from "../utils/fake-socket";

const startTls = vi.fn();
const databaseFromPEM = vi.fn(async (pem: string) => ({ pem }));

vi.mock("subtls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("subtls")>()),
  startTls: (...args: unknown[]) => startTls(...args),
  TrustedCert: { databaseFromPEM: (pem: string) => databaseFromPEM(pem) },
}));

const { subtls } = await import("../../src/subtls");

describe("subtls", () => {
  beforeEach(() => {
    startTls.mockReset();
    databaseFromPEM.mockClear();
  });

  it("negotiates over the raw tunnel with the configured roots and server name", async () => {
    const pair = createFakeSocketPair();
    const received: Uint8Array[] = [];
    startTls.mockImplementation(
      async (
        host: string,
        roots: unknown,
        read: (bytes: number) => Promise<Uint8Array | undefined>,
        write: (data: Uint8Array) => void
      ) => {
        write(text("hello"));
        const reply = await read(5);
        return {
          read: vi
            .fn()
            .mockResolvedValueOnce(reply)
            .mockResolvedValueOnce(undefined),
          write: async (data: Uint8Array) => {
            received.push(data);
          },
          userCert: {},
          host,
          roots,
        };
      }
    );

    const upgrade = subtls({ rootCertificates: "PEM" });
    const socket = upgrade(pair.socket, "example.com");

    // Play the server: read the handshake bytes, answer with five bytes.
    const serverReader = pair.server.readable.getReader();
    const serverWriter = pair.server.writable.getWriter();
    expect(new TextDecoder().decode((await serverReader.read()).value)).toBe(
      "hello"
    );
    await serverWriter.write(text("world"));

    const writer = socket.writable.getWriter();
    await writer.write(text("GET /"));
    writer.releaseLock();

    expect(new TextDecoder().decode(await readAll(socket.readable))).toBe(
      "world"
    );
    expect(received).toEqual([text("GET /")]);
    expect(startTls.mock.calls[0]?.[0]).toBe("example.com");
    expect(startTls.mock.calls[0]?.[1]).toEqual({ pem: "PEM" });
    expect(databaseFromPEM).toHaveBeenCalledTimes(1);
  });

  it("parses the root certificates once per adapter", () => {
    const upgrade = subtls({ rootCertificates: "PEM" });
    startTls.mockReturnValue(new Promise(() => {}));
    upgrade(createFakeSocketPair().socket, "a.example");
    upgrade(createFakeSocketPair().socket, "b.example");

    expect(databaseFromPEM).toHaveBeenCalledTimes(1);
  });
});
