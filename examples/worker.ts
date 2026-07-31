import { createSOCKS5Proxy } from "cloudflare-workers-proxies";

interface Env {
  PROXY_HOST: string;
  PROXY_USERNAME: string;
  PROXY_PASSWORD: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxy = createSOCKS5Proxy({
      host: env.PROXY_HOST,
      port: 1080,
      username: env.PROXY_USERNAME,
      password: env.PROXY_PASSWORD,
    });

    // Fetch through the proxy instead of directly.
    return proxy.fetch("https://example.com/", {
      headers: request.headers,
    });
  },
};
