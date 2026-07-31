# cloudflare-workers-proxies

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/cloudflare-workers-proxies?color=yellow)](https://npmjs.com/package/cloudflare-workers-proxies)
[![npm downloads](https://img.shields.io/npm/dm/cloudflare-workers-proxies?color=yellow)](https://npm.chart.dev/cloudflare-workers-proxies)

<!-- /automd -->

Use HTTP, HTTPS & SOCKS5 proxies in Cloudflare Workers `fetch()`.

Workers cannot route `fetch()` through a proxy natively. This package speaks the proxy protocol over raw TCP sockets (`connect()` from `cloudflare:sockets`) and runs a minimal HTTP/1.1 client through the tunnel, so proxied requests feel like regular `fetch()` calls.

## Usage

Install the package:

<!-- automd:pm-install name="cloudflare-workers-proxies" -->

```sh
# ✨ Auto-detect
npx nypm install cloudflare-workers-proxies

# npm
npm install cloudflare-workers-proxies

# yarn
yarn add cloudflare-workers-proxies

# pnpm
pnpm add cloudflare-workers-proxies

# bun
bun install cloudflare-workers-proxies

# deno
deno install npm:cloudflare-workers-proxies
```

<!-- /automd -->

Create a proxy and use it like a fetcher:

```ts
import { createSOCKS5Proxy } from "cloudflare-workers-proxies";

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
} from "cloudflare-workers-proxies";

// SOCKS5 (RFC 1928), optional username/password auth (RFC 1929)
const socks5 = createSOCKS5Proxy({ host: "proxy.example.com", port: 1080 });

// Plaintext HTTP proxy: absolute-form requests for http:, CONNECT for https:
const http = createHTTPProxy({ host: "proxy.example.com", port: 8080 });

// HTTPS proxy (TLS to the proxy itself)
const https = createHTTPSProxy({ host: "proxy.example.com", port: 443 });
```

HTTP and HTTPS proxies authenticate with `Proxy-Authorization: Basic` when `username` and `password` are set.

### Raw TCP tunnels

Every proxy also exposes `connect()`, mirroring `connect()` from `cloudflare:sockets` — useful for talking to databases or other TCP services through the proxy:

```ts
const socket = await socks5.connect("db.example.com:5432");
// optionally TLS: await socks5.connect("db.example.com:5432", { secureTransport: "on", allowHalfOpen: false })

const writer = socket.writable.getWriter();
await writer.write(new TextEncoder().encode("ping"));
```

Unlike the native `connect()`, it is async: the proxy handshake completes before you get the socket.

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

Published under the [MIT](https://github.com/timo972/cloudflare-workers-http-proxy/blob/main/LICENSE) license.
Made by [@timo972](https://github.com/timo972) and [community](https://github.com/timo972/cloudflare-workers-http-proxy/graphs/contributors) 💛
<br><br>
<a href="https://github.com/timo972/cloudflare-workers-http-proxy/graphs/contributors">
<img src="https://contrib.rocks/image?repo=timo972/cloudflare-workers-http-proxy" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
