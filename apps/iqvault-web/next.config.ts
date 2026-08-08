import type { NextConfig } from "next";

const comicsTarget = process.env.COMICS_API_URL ?? "http://127.0.0.1:5200";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/comics/:path*",
        destination: `${comicsTarget}/api/comics/:path*`,
      },
    ];
  },
};

export default nextConfig;
