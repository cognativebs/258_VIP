import type { MetadataRoute } from "next";

/** Lite PWA — Add to Home Screen on phone (same LAN). Offline sync deferred. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Binder Vault",
    short_name: "Binder",
    description: "Digital Pokémon binder — hunt and shelf on your LAN",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0e13",
    theme_color: "#7a2331",
    orientation: "any",
  };
}
