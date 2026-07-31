import type { BufferedStreamReader } from "../io/reader";
import { ProxyError } from "../shared/error";
import { parseIPv4, parseIPv6, stripBrackets } from "../shared/ip";

export const SOCKS5_VERSION = 0x05;
const USER_PASS_VERSION = 0x01;
const CMD_CONNECT = 0x01;

export enum AuthMethod {
  NoAuthenticationRequired = 0x00,
  UsernamePassword = 0x02,
  NoAcceptableMethods = 0xff,
}

enum AddressType {
  IPv4 = 0x01,
  Domain = 0x03,
  IPv6 = 0x04,
}

const REPLY_MESSAGES: Record<number, string> = {
  0x01: "general SOCKS server failure",
  0x02: "connection not allowed by ruleset",
  0x03: "network unreachable",
  0x04: "host unreachable",
  0x05: "connection refused",
  0x06: "TTL expired",
  0x07: "command not supported",
  0x08: "address type not supported",
};

/**
 * Client greeting: version, number of offered auth methods, methods.
 */
export function encodeGreeting(methods: AuthMethod[]): Uint8Array {
  return new Uint8Array([SOCKS5_VERSION, methods.length, ...methods]);
}

/**
 * Server method selection: version, selected auth method.
 */
export async function readMethodSelection(
  reader: BufferedStreamReader
): Promise<number> {
  const [version, method] = await reader.readExact(2);
  assertVersion(version, SOCKS5_VERSION);
  return method;
}

/**
 * RFC 1929 username/password authentication request.
 */
export function encodeUserPassAuth(
  username: string,
  password: string
): Uint8Array {
  const user = new TextEncoder().encode(username);
  const pass = new TextEncoder().encode(password);
  if (user.length > 255) {
    throw new Error("SOCKS5 username must not exceed 255 bytes");
  }
  if (pass.length > 255) {
    throw new Error("SOCKS5 password must not exceed 255 bytes");
  }
  return new Uint8Array([
    USER_PASS_VERSION,
    user.length,
    ...user,
    pass.length,
    ...pass,
  ]);
}

/**
 * RFC 1929 authentication reply. Returns the status byte; zero means
 * success.
 */
export async function readUserPassStatus(
  reader: BufferedStreamReader
): Promise<number> {
  const [, status] = await reader.readExact(2);
  return status;
}

/**
 * CONNECT request for the given target. IPv4 and IPv6 literals are encoded
 * as such; anything else is sent as a domain name for the proxy to resolve.
 */
export function encodeConnectRequest(host: string, port: number): Uint8Array {
  const [type, address] = encodeAddress(host);
  return new Uint8Array([
    SOCKS5_VERSION,
    CMD_CONNECT,
    0x00,
    type,
    ...address,
    port >> 8,
    port & 0xff,
  ]);
}

/**
 * Server reply to a CONNECT request. Consumes the variable-length bound
 * address and returns the reply code; zero means success.
 */
export async function readConnectReply(
  reader: BufferedStreamReader
): Promise<{ code: number }> {
  const [version, code, , addressType] = await reader.readExact(4);
  assertVersion(version, SOCKS5_VERSION);
  switch (addressType) {
    case AddressType.IPv4: {
      await reader.readExact(4);
      break;
    }
    case AddressType.IPv6: {
      await reader.readExact(16);
      break;
    }
    case AddressType.Domain: {
      const [length] = await reader.readExact(1);
      await reader.readExact(length);
      break;
    }
    default: {
      throw new ProxyError(
        `SOCKS5 reply has unknown address type 0x${addressType.toString(16)}`
      );
    }
  }
  await reader.readExact(2); // bound port
  return { code };
}

export function replyCodeMessage(code: number): string {
  return (
    REPLY_MESSAGES[code] ?? `unknown SOCKS5 reply code 0x${code.toString(16)}`
  );
}

function encodeAddress(host: string): [AddressType, Uint8Array] {
  const ipv4 = parseIPv4(host);
  if (ipv4) {
    return [AddressType.IPv4, ipv4];
  }
  const ipv6 = parseIPv6(stripBrackets(host));
  if (ipv6) {
    return [AddressType.IPv6, ipv6];
  }
  const domain = new TextEncoder().encode(host);
  if (domain.length > 255) {
    throw new Error("SOCKS5 target host must not exceed 255 bytes");
  }
  return [AddressType.Domain, new Uint8Array([domain.length, ...domain])];
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ProxyError(
      `unexpected SOCKS version 0x${actual.toString(16)}, expected 0x${expected.toString(16)}`
    );
  }
}
