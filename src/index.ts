export { createHTTPProxy } from "./http";
export { createHTTPSProxy } from "./https";
export { createSOCKS5Proxy } from "./socks5";
export { ProxyError } from "./shared/error";
export type { Credentials } from "./shared/credentials";
export type { ProxyOptions } from "./proxy/options";
export type { TlsSession, TlsUpgrade } from "./tls/userspace-socket";
export { userspaceTlsSocket } from "./tls/userspace-socket";
