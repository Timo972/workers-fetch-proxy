/**
 * Returns a stream that emits `prefix` first, then everything from
 * `stream`. Used to replay handshake leftovers in front of tunnel data.
 */
export function prependBytes(
  prefix: Uint8Array,
  stream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  if (prefix.length === 0) {
    return stream;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let prefixSent = false;
  return new ReadableStream({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        controller.enqueue(prefix);
        return;
      }
      reader ??= stream.getReader();
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return (reader ?? stream.getReader()).cancel(reason);
    },
  });
}
