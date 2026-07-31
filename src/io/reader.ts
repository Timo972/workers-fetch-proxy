const CR = 0x0d;
const LF = 0x0a;

/**
 * Wraps a byte stream and buffers bytes that were read from the stream but
 * not yet consumed, so protocol parsers can read exact amounts.
 */
export class BufferedStreamReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer: Uint8Array;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
    this.buffer = new Uint8Array(0);
  }

  /**
   * Reads exactly `n` bytes. Replicates io.ReadFull behavior.
   */
  async readExact(n: number): Promise<Uint8Array> {
    while (this.buffer.length < n) {
      await this.fill();
    }
    return this.consume(n);
  }

  /**
   * Reads a CRLF-terminated line and returns it without the terminator.
   */
  async readLine(): Promise<string> {
    let searchFrom = 0;
    for (;;) {
      const index = this.findLineBreak(searchFrom);
      if (index !== -1) {
        const line = this.consume(index + 2).subarray(0, index);
        return new TextDecoder().decode(line);
      }
      // The last buffered byte may be a CR of a split CRLF; rescan it.
      searchFrom = Math.max(this.buffer.length - 1, 0);
      await this.fill();
    }
  }

  /**
   * Reads up to `max` bytes: buffered bytes are served first, otherwise
   * this waits for the next chunk. Returns `undefined` at EOF.
   */
  async readSome(max: number): Promise<Uint8Array | undefined> {
    if (this.buffer.length === 0) {
      const { value, done } = await this.reader.read();
      if (done || !value) {
        return undefined;
      }
      this.buffer = value;
    }
    return this.consume(Math.min(max, this.buffer.length));
  }

  /**
   * Returns bytes that were read from the stream but not consumed yet and
   * resets the buffer. Use this to hand leftover bytes over after a
   * protocol handshake completed.
   */
  takeBuffered(): Uint8Array {
    return this.consume(this.buffer.length);
  }

  /**
   * Call this when you are completely done reading to release the stream
   * lock.
   */
  release(): void {
    this.reader.releaseLock();
  }

  private async fill(): Promise<void> {
    const { value, done } = await this.reader.read();
    if (done || !value) {
      throw new Error(
        this.buffer.length > 0
          ? "unexpected EOF: stream ended with partial data"
          : "unexpected EOF"
      );
    }
    const grown = new Uint8Array(this.buffer.length + value.length);
    grown.set(this.buffer, 0);
    grown.set(value, this.buffer.length);
    this.buffer = grown;
  }

  private consume(n: number): Uint8Array {
    const result = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return result;
  }

  private findLineBreak(searchFrom: number): number {
    for (let i = searchFrom; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === CR && this.buffer[i + 1] === LF) {
        return i;
      }
    }
    return -1;
  }
}
