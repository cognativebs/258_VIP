import type { NextConfig } from "next";

const comicsTarget = process.env.COMICS_API_URL ?? "http://127.0.0.1:5200";
const orchestr8Target = process.env.ORCHESTR8_URL ?? "http://127.0.0.1:5210";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/comics/:path*",
        destination: `${comicsTarget}/api/comics/:path*`,
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
