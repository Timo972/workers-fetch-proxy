/**
 * Builds an RFC 7617 Basic authentication header value. Credentials are
 * encoded as UTF-8 before the base64 step so non-latin1 characters survive.
 */
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return `Basic ${btoa(binary)}`;
}
