/**
 * Removes the square brackets URLs and socket addresses put around IPv6
 * literals, e.g. `[::1]` becomes `::1`.
 */
export function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Parses a dotted-quad IPv4 literal. Returns the 4 address bytes, or
 * `undefined` if the input is not an IPv4 literal.
 */
export function parseIPv4(host: string): Uint8Array | undefined {
  const segments = host.split(".");
  if (segments.length !== 4) {
    return undefined;
  }
  const result = new Uint8Array(4);
  for (const [index, segment] of segments.entries()) {
    if (!/^\d{1,3}$/.test(segment)) {
      return undefined;
    }
    const value = Number(segment);
    if (value > 255) {
      return undefined;
    }
    result[index] = value;
  }
  return result;
}

/**
 * Parses an IPv6 literal, supporting `::` compression and trailing embedded
 * IPv4. Returns the 16 address bytes, or `undefined` if the input is not an
 * IPv6 literal.
 */
export function parseIPv6(host: string): Uint8Array | undefined {
  const halves = host.split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const head = parseHextets(halves[0]);
  const tail = halves.length === 2 ? parseHextets(halves[1]) : undefined;
  if (!head || (halves.length === 2 && !tail)) {
    return undefined;
  }

  let hextets: number[];
  if (tail) {
    // `::` stands in for at least one group of zeros.
    if (head.length + tail.length > 7) {
      return undefined;
    }
    const zeros = Array.from<number>({
      length: 8 - head.length - tail.length,
    }).fill(0);
    hextets = [...head, ...zeros, ...tail];
  } else {
    hextets = head;
  }

  if (hextets.length !== 8) {
    return undefined;
  }

  const result = new Uint8Array(16);
  for (const [index, hextet] of hextets.entries()) {
    result[index * 2] = hextet >> 8;
    result[index * 2 + 1] = hextet & 0xff;
  }
  return result;
}

function parseHextets(part: string): number[] | undefined {
  if (part === "") {
    return [];
  }
  const groups = part.split(":");
  const hextets: number[] = [];
  for (const [index, group] of groups.entries()) {
    if (index === groups.length - 1 && group.includes(".")) {
      const embedded = parseIPv4(group);
      if (!embedded) {
        return undefined;
      }
      hextets.push(
        (embedded[0] << 8) | embedded[1],
        (embedded[2] << 8) | embedded[3]
      );
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return undefined;
    }
    hextets.push(Number.parseInt(group, 16));
  }
  return hextets;
}
