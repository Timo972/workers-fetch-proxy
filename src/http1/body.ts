import type { BufferedStreamReader } from "../io/reader";

/**
 * Body of a known size, framed by a Content-Length header.
 */
export function fixedLengthBody(
  reader: BufferedStreamReader,
  length: number
): ReadableStream<Uint8Array> {
  let remaining = length;
  return new ReadableStream({
    async pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const chunk = await reader.readSome(remaining);
      if (!chunk) {
        throw new Error("unexpected EOF while reading the response body");
      }
      remaining -= chunk.length;
      controller.enqueue(chunk);
      if (remaining === 0) {
        controller.close();
      }
    },
  });
}

/**
 * Body framed by Transfer-Encoding: chunked. Consumes the terminating
 * chunk and any trailer headers.
 */
export function chunkedBody(
  reader: BufferedStreamReader
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      const size = parseChunkSize(await reader.readLine());
      if (size === 0) {
        await consumeTrailers(reader);
        controller.close();
        return;
      }
      controller.enqueue(await reader.readExact(size));
      await reader.readExact(2); // CRLF after chunk data
    },
  });
}

/**
 * Body delimited by the peer closing the connection (no framing headers).
 */
export function closeDelimitedBody(
  reader: BufferedStreamReader
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      const chunk = await reader.readSome(Number.MAX_SAFE_INTEGER);
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
}

function parseChunkSize(line: string): number {
  const size = line.split(";")[0].trim();
  if (!/^[0-9a-f]+$/i.test(size)) {
    throw new Error(`invalid HTTP chunk size line: ${JSON.stringify(line)}`);
  }
  return Number.parseInt(size, 16);
}

async function consumeTrailers(reader: BufferedStreamReader): Promise<void> {
  while ((await reader.readLine()) !== "") {
    // discard trailer fields
  }
}
