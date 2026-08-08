import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/orchestr8/:path*",
        destination: "http://127.0.0.1:5210/:path*",
      },
      {
        source: "/api/comics/:path*",
        destination: "http://127.0.0.1:5200/api/comics/:path*",
      },
      {
        source: "/api/vip/:path*",
        destination: "http://127.0.0.1:8787/api/:path*",
      },
    ];
  },
};

export default nextConfig;
