import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Binder Vault — Digital Card Binder Builder",
  description:
    "Build, theme and fill Pokémon card binders with drag-and-drop, live card search and high-res art. Local-first, saved to SQLite. Shared TCG truth for IQVault.",
  applicationName: "Binder Vault",
  appleWebApp: {
    capable: true,
    title: "Binder Vault",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7a2331",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
