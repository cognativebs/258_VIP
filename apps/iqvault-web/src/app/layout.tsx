import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IQVault",
  description: "Collector face of the Vault Intelligence Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
