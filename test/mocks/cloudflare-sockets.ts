/**
 * Mock for the `cloudflare:sockets` module. Wired up via `resolve.alias` in
 * vitest.config.ts so importing production code works outside of workerd.
 */

type ConnectFn = (
  address: string | SocketAddress,
  options?: SocketOptions
) => Socket;

let implementation: ConnectFn | undefined;

export function connect(
  address: string | SocketAddress,
  options?: SocketOptions
): Socket {
  if (!implementation) {
    throw new Error("cloudflare:sockets mock: no connect implementation set");
  }
  return implementation(address, options);
}

export function setConnectImplementation(fn: ConnectFn | undefined): void {
  implementation = fn;
}
