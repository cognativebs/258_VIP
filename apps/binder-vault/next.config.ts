import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @libsql/client loads a native (Node-API) addon; keep it out of the bundler.
  serverExternalPackages: ["@libsql/client", "libsql"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pokemontcg.io" },
      { protocol: "https", hostname: "assets.tcgdex.net" },
    ],
  },
};

export default nextConfig;
