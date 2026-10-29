import type { TlsUpgrade } from "../tls/userspace-socket";

/** Options shared by every proxy factory. */
export interface ProxyOptions {
  /**
   * TLS for `https:` targets in user space instead of the runtime's
   * `startTls()`, e.g. `subtls()` from `workers-fetch-proxy/subtls`.
   * Required for `https:` targets through an HTTPS proxy.
   */
  tls?: TlsUpgrade;
}
