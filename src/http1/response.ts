import type { BufferedStreamReader } from "../io/reader";

export interface ResponseHead {
  status: number;
  statusText: string;
  headers: Headers;
}

const STATUS_LINE = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/;

/**
 * Reads and parses an HTTP/1.x response head (status line and headers),
 * leaving the reader positioned at the first body byte.
 */
export async function readResponseHead(
  reader: BufferedStreamReader
): Promise<ResponseHead> {
  const statusLine = await reader.readLine();
  const match = STATUS_LINE.exec(statusLine);
  if (!match) {
    throw new Error(`invalid HTTP status line: ${JSON.stringify(statusLine)}`);
  }

  const headers = new Headers();
  for (;;) {
    const line = await reader.readLine();
    if (line === "") {
      break;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`invalid HTTP header line: ${JSON.stringify(line)}`);
    }
    headers.append(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim()
    );
  }

  return {
    status: Number(match[1]),
    statusText: match[2] ?? "",
    headers,
  };
}
