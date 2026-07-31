import { describe, expect, it } from "vitest";
import { prependBytes } from "../../src/io/streams";
import { bytes, readAll, streamFrom } from "../utils/bytes";

describe("prependBytes", () => {
  it("emits the prefix before the stream's own chunks", async () => {
    const stream = prependBytes(bytes(1, 2), streamFrom(bytes(3), bytes(4)));

    expect(await readAll(stream)).toEqual(bytes(1, 2, 3, 4));
  });

  it("returns the stream unchanged for an empty prefix", () => {
    const inner = streamFrom(bytes(1));

    expect(prependBytes(bytes(), inner)).toBe(inner);
  });

  it("cancels through to the underlying stream", async () => {
    let cancelled = false;
    const inner = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    await prependBytes(bytes(1), inner).cancel();

    expect(cancelled).toBe(true);
  });
});
