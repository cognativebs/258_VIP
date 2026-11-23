import type { NextConfig } from "next";
import { shellRedirects } from "./src/lib/shellRedirects";

const comicsTarget = process.env.COMICS_API_URL ?? "http://127.0.0.1:5200";
const orchestr8Target = process.env.ORCHESTR8_URL ?? "http://127.0.0.1:5210";
const vipTarget = process.env.VIP_API_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Ricoh 600 DPI JPEGs are several MB each; the rewrite proxy defaults to 10MB.
  experimental: {
    middlewareClientMaxBodySize: "50mb",
  },
  async redirects() {
    // ADR 0014 keeps older pages reachable by URL until each one has a home in a
    // concept. Per page (Q22, owner 2026-11-23): a page redirects once it is
    // marked absorbed in src/lib/shellRedirects.ts, or when the operator names it
    // in VIP_SHELL_REDIRECTS (comma list, "all" or "off").
    return shellRedirects(process.env.VIP_SHELL_REDIRECTS);
  },
  async rewrites() {
    return [
      {
        source: "/api/comics/:path*",
        destination: `${comicsTarget}/api/comics/:path*`,
      },
      // Browser VIP calls go same-origin so they cannot hit a stale localhost
      // API on a different machine than the Next server.
      {
        source: "/api/vip/:path*",
        destination: `${vipTarget}/:path*`,
      },
      // JSON reads only — SSE job streams hit the gateway directly, since
      // rewrites buffer the stream and make live runs look frozen.
      {
        source: "/api/orchestr8/:path*",
        destination: `${orchestr8Target}/:path*`,
      },
    ];
  },
};

export default nextConfig;
