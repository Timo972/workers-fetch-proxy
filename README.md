# workers-fetch-proxy

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/workers-fetch-proxy?color=yellow)](https://npmjs.com/package/workers-fetch-proxy)
[![npm downloads](https://img.shields.io/npm/dm/workers-fetch-proxy?color=yellow)](https://npm.chart.dev/workers-fetch-proxy)

<!-- /automd -->

Use HTTP, HTTPS & SOCKS5 proxies in Cloudflare Workers `fetch()`.

Workers cannot route `fetch()` through a proxy natively. This package speaks the proxy protocol over raw TCP sockets (`connect()` from `cloudflare:sockets`) and runs a minimal HTTP/1.1 client through the tunnel, so proxied requests feel like regular `fetch()` calls.

## Usage

Install the package:

<!-- automd:pm-install name="workers-fetch-proxy" -->

```sh
# ✨ Auto-detect
npx nypm install workers-fetch-proxy

# npm
npm install workers-fetch-proxy

# yarn
yarn add workers-fetch-proxy

# pnpm
pnpm add workers-fetch-proxy

# bun
bun install workers-fetch-proxy

# deno
deno install npm:workers-fetch-proxy
```

<!-- /automd -->

Create a proxy and use it like a fetcher:

```ts
import { createSOCKS5Proxy } from "workers-fetch-proxy";

export default {
  async fetch(request, env) {
    const proxy = createSOCKS5Proxy({
      host: "proxy.example.com",
      port: 1080,
      // optional RFC 1929 username/password authentication
      username: env.PROXY_USERNAME,
      password: env.PROXY_PASSWORD,
    });

    return proxy.fetch("https://example.com/");
  },
};
```

### Proxy protocols

```ts
import {
  createHTTPProxy,
  createHTTPSProxy,
  createSOCKS5Proxy,
} from "workers-fetch-proxy";

// SOCKS5 (RFC 1928), optional username/password auth (RFC 1929)
const socks5 = createSOCKS5Proxy({ host: "proxy.example.com", port: 1080 });

// Plaintext HTTP proxy: absolute-form requests for http:, CONNECT for https:
const http = createHTTPProxy({ host: "proxy.example.com", port: 8080 });

// HTTPS proxy (TLS to the proxy itself)
const https = createHTTPSProxy({ host: "proxy.example.com", port: 443 });
```

HTTP and HTTPS proxies authenticate with `Proxy-Authorization: Basic` when `username` and `password` are set.

### Per-protocol imports

Each protocol is also published as its own entry point, so you can import just the one you use:

```ts
import { createSOCKS5Proxy } from "workers-fetch-proxy/socks5";
import { createHTTPProxy } from "workers-fetch-proxy/http";
import { createHTTPSProxy } from "workers-fetch-proxy/https";
```

The package is `sideEffects: false`, so importing a factory from the root entry already tree-shakes the other protocols away in any modern bundler (including Wrangler). The subpath entries are mainly for a smaller type surface and for build setups where tree-shaking is disabled — the shared core is emitted once and reused across all entries, so importing more than one protocol never duplicates it.

### Raw TCP tunnels

Each factory returns a standard Workers [`Fetcher`](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/), so a proxy is a drop-in replacement anywhere a `Fetcher` is expected. That includes `connect()`, mirroring `connect()` from `cloudflare:sockets` — useful for talking to databases or other TCP services through the proxy:

```ts
const socket = socks5.connect("db.example.com:5432");
// optionally TLS: socks5.connect("db.example.com:5432", { secureTransport: "on", allowHalfOpen: false })

const writer = socket.writable.getWriter();
await writer.write(new TextEncoder().encode("ping"));
```

Like the native `connect()`, it returns a `Socket` synchronously; the proxy handshake completes in the background, so the connection is established by the time the first bytes flow. A failed handshake surfaces on `socket.opened` and on the streams.

## Limitations

- **`https:` targets through an HTTPS proxy are not supported.** That requires a TLS session inside the proxy's TLS session, and Workers sockets cannot nest TLS (`startTls()` only works once, on a plaintext socket). Use an HTTP or SOCKS5 proxy for `https:` targets, or an HTTPS proxy for `http:` targets.
- Proxied `fetch()` speaks HTTP/1.1 with `Connection: close` — one TCP connection per request, no keep-alive or HTTP/2.
- Redirects are returned as-is (like `redirect: "manual"`); they are not followed.
- Request bodies are buffered to compute `Content-Length`; response bodies stream.

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

</details>

## License

<!-- automd:contributors license=MIT author="timo972" -->

Published under the [MIT](https://github.com/timo972/workers-fetch-proxy/blob/main/LICENSE) license.
Made by [@timo972](https://github.com/timo972) and [community](https://github.com/timo972/workers-fetch-proxy/graphs/contributors) 💛
<br><br>
<a href="https://github.com/timo972/workers-fetch-proxy/graphs/contributors">
<img src="https://contrib.rocks/image?repo=timo972/workers-fetch-proxy" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
