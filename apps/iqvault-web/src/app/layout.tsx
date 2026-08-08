import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IQVault · Personal Intelligence",
  description: "Collector face of the Vault Intelligence Platform — decisions with provenance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
