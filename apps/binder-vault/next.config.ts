import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the Postgres driver out of the Next bundler.
  serverExternalPackages: ["pg", "drizzle-orm"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pokemontcg.io" },
      { protocol: "https", hostname: "assets.tcgdex.net" },
    ],
  },
};

export default nextConfig;
