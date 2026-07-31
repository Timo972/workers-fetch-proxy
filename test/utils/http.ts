import { BufferedStreamReader } from "../../src/io/reader";
import { text } from "./bytes";
import type { FakeSocketPair } from "./fake-socket";

export async function readHeadLines(
  reader: BufferedStreamReader
): Promise<string[]> {
  const lines: string[] = [];
  for (;;) {
    const line = await reader.readLine();
    if (line === "") return lines;
    lines.push(line);
  }
}

/**
 * Reads one request head from the pair's server side and answers with the
 * given response. Resolves with the received request lines.
 */
export async function serveHttp(
  pair: FakeSocketPair,
  response = "HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"
): Promise<string[]> {
  const reader = new BufferedStreamReader(pair.server.readable);
  const writer = pair.server.writable.getWriter();
  const lines = await readHeadLines(reader);
  await writer.write(text(response));
  await writer.close();
  return lines;
}
