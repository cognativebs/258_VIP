import type { Metadata } from "next";
import { AppShell } from "@/shell/AppShell";
import { RoleProvider } from "@/shell/role-context";
import "./globals.css";
import "@/shell/tokens.css";
import "@/shell/shell.css";

export const metadata: Metadata = {
  title: "VIP",
  description: "Vault Intelligence Platform — decisions with provenance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
