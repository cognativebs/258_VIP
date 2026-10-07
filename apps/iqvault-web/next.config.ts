import type { NextConfig } from "next";

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
    return [
      { source: "/portfolio", destination: "/vault", permanent: false },
      { source: "/collections", destination: "/vault", permanent: false },
      { source: "/collections/:path*", destination: "/vault", permanent: false },
      { source: "/scan", destination: "/ingest", permanent: false },
      { source: "/batch/:path*", destination: "/ingest", permanent: false },
      { source: "/intelligence", destination: "/advisor", permanent: false },
      { source: "/recommendations", destination: "/advisor", permanent: false },
      { source: "/signals-feed", destination: "/signals", permanent: false },
      { source: "/sell-queue", destination: "/operate/sell", permanent: false },
      { source: "/listings", destination: "/operate/listings", permanent: false },
      { source: "/transactions", destination: "/operate/transactions", permanent: false },
      { source: "/ebay", destination: "/operate/listings", permanent: false },
      { source: "/ebay/:path*", destination: "/operate/listings", permanent: false },
      { source: "/hunts", destination: "/vault", permanent: false },
      { source: "/watchlist", destination: "/vault", permanent: false },
      { source: "/theses", destination: "/advisor", permanent: false },
      { source: "/sources", destination: "/operate/integrations", permanent: false },
    ];
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
