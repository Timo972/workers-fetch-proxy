import { connect } from "cloudflare:sockets";
import type { Credentials } from "../shared/credentials";
import { ProxyError } from "../shared/error";
import type { TunnelStreams, TunnelTarget } from "../shared/target";

/** An established tunnel plus bytes the handshake over-read. */
export interface Tunnel {
  socket: Socket;
  leftover: Uint8Array;
}

export interface OpenTunnelOptions {
  /**
   * Whether the caller intends to upgrade the tunnel to TLS afterwards. The
   * proxy socket must then be opened with `starttls` so it can be upgraded.
   */
  upgradeable: boolean;
}

/**
 * Protocol-specific part of a proxy: opens a socket to the proxy server and
 * performs the handshake that turns it into a tunnel to `target`.
 */
export type OpenTunnel = (
  target: TunnelTarget,
  options: OpenTunnelOptions
) => Promise<Tunnel>;

/** A protocol's handshake that turns a proxy socket into a tunnel. */
export type Handshake = (
  socket: TunnelStreams,
  credentials: Credentials,
  target: TunnelTarget
) => Promise<Uint8Array>;

export interface TunnelOpenerOptions {
  /**
   * Talk TLS to the proxy server itself. Rules out TLS tunnel payloads:
   * Workers sockets cannot nest TLS sessions.
   */
  proxyTls?: boolean;
}

/**
 * Builds an `OpenTunnel` that dials the proxy from `credentials`, runs the
 * protocol `handshake` and closes the socket when the handshake fails.
 */
export function tunnelOpener(
  credentials: Credentials,
  handshake: Handshake,
  options: TunnelOpenerOptions = {}
): OpenTunnel {
  return async (target, { upgradeable }) => {
    if (options.proxyTls && upgradeable) {
      throw new ProxyError(
        "cannot open a TLS tunnel through an HTTPS proxy: Workers sockets do not support nested TLS"
      );
    }
    const socket = connect(
      { hostname: credentials.host, port: credentials.port },
      {
        secureTransport: proxySecureTransport(options.proxyTls, upgradeable),
        allowHalfOpen: false,
      }
    );
    try {
      return { socket, leftover: await handshake(socket, credentials, target) };
    } catch (error) {
      socket.close().catch(() => {});
      throw error;
    }
  };
}

/** How the socket to the proxy server itself must be opened. */
function proxySecureTransport(
  proxyTls: boolean | undefined,
  upgradeable: boolean
): "on" | "starttls" | "off" {
  if (proxyTls) {
    return "on";
  }
  return upgradeable ? "starttls" : "off";
}
