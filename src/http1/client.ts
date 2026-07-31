import { BufferedStreamReader } from "../io/reader";
import { chunkedBody, closeDelimitedBody, fixedLengthBody } from "./body";
import type { RequestForm } from "./request";
import { serializeRequestHead } from "./request";
import type { ResponseHead } from "./response";
import { readResponseHead } from "./response";

export interface SendRequestOptions {
  form?: RequestForm;
  /** Extra headers to send, e.g. Proxy-Authorization. */
  headers?: Record<string, string>;
}

/** The subset of `Socket` the HTTP client needs. */
export type ClientSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
};

const MAX_INFORMATIONAL_RESPONSES = 10;

/**
 * Performs a single HTTP/1.1 exchange over an established socket and closes
 * the socket once the response body has been consumed.
 */
export async function sendRequest(
  socket: ClientSocket,
  request: Request,
  options: SendRequestOptions = {}
): Promise<Response> {
  try {
    return await exchange(socket, request, options);
  } catch (error) {
    socket.close().catch(() => {});
    throw error;
  }
}

async function exchange(
  socket: ClientSocket,
  request: Request,
  options: SendRequestOptions
): Promise<Response> {
  const body = request.body
    ? new Uint8Array(await request.arrayBuffer())
    : undefined;

  const writer = socket.writable.getWriter();
  await writer.write(
    serializeRequestHead(request, { ...options, contentLength: body?.length })
  );
  if (body && body.length > 0) {
    await writer.write(body);
  }
  writer.releaseLock();

  const reader = new BufferedStreamReader(socket.readable);
  const head = await readFinalResponseHead(reader);

  const close = (): void => {
    socket.close().catch(() => {});
  };
  const responseBody = selectBody(request, head, reader, close);
  if (!responseBody) {
    close();
  }

  return new Response(responseBody, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  });
}

async function readFinalResponseHead(
  reader: BufferedStreamReader
): Promise<ResponseHead> {
  for (let i = 0; i < MAX_INFORMATIONAL_RESPONSES; i++) {
    const head = await readResponseHead(reader);
    if (head.status >= 200) {
      return head;
    }
  }
  throw new Error("too many informational (1xx) responses");
}

function selectBody(
  request: Request,
  head: ResponseHead,
  reader: BufferedStreamReader,
  cleanup: () => void
): ReadableStream<Uint8Array> | undefined {
  if (request.method === "HEAD" || head.status === 204 || head.status === 304) {
    return undefined;
  }
  return withCleanup(framedBody(head, reader), cleanup);
}

function framedBody(
  head: ResponseHead,
  reader: BufferedStreamReader
): ReadableStream<Uint8Array> {
  const transferEncoding = head.headers.get("transfer-encoding");
  if (transferEncoding?.toLowerCase().includes("chunked")) {
    return chunkedBody(reader);
  }
  const contentLength = head.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`invalid Content-Length: ${contentLength}`);
    }
    return fixedLengthBody(reader, length);
  }
  return closeDelimitedBody(reader);
}

/**
 * Runs `cleanup` once the stream ends, errors, or is cancelled — used to
 * close the socket exactly when the response is done with it.
 */
function withCleanup(
  stream: ReadableStream<Uint8Array>,
  cleanup: () => void
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        cleanup();
        throw error;
      }
      if (result.done) {
        cleanup();
        controller.close();
      } else {
        controller.enqueue(result.value);
      }
    },
    cancel(reason) {
      cleanup();
      return reader.cancel(reason);
    },
  });
}
