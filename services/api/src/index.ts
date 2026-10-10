import { createApp } from "./app.js";
import { comicsDsn, normalizeDsn, redactDsn } from "./db/client.js";
import { ebayAuthStatus } from "./lib/comps/ebayAuth.js";
import { ebayDeletionStatus } from "./lib/comps/ebayMarketplaceDeletion.js";
import { loadLocalEnv } from "./lib/loadEnv.js";
import { startScanAutoIntake } from "./lib/scanAutoIntake.js";

loadLocalEnv();

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
createApp().listen(port, host, () => {
  const ebay = ebayAuthStatus();
  console.log(`VIP API listening on http://${host}:${port}`);
  console.log(`Postgres: ${redactDsn(normalizeDsn(comicsDsn()))}`);
  console.log(
    ebay.configured
      ? `eBay comps: ${ebay.mode} (${ebay.environment}) scope=${ebay.oauthScope}`
      : "eBay comps: idle — set EBAY_APP_ID + EBAY_CERT_ID in services/api/.env",
  );
  const deletion = ebayDeletionStatus();
  console.log(
    deletion.configured
      ? `eBay deletion endpoint: ${deletion.endpointUrl}`
      : "eBay deletion endpoint: not public yet — see docs/how-to/11-ebay-marketplace-deletion.md",
  );
  // New Ricoh scan folders import themselves through the same endpoint as the /scan Import button.
  startScanAutoIntake(async (folder, categoryHint) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/scan/import-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, categoryHint, notes: "auto-intake", pairing: "auto" }),
    });
    const body = (await res.json()) as { ok?: boolean; batchId?: string; error?: string };
    if (!res.ok || !body.batchId) throw new Error(body.error ?? `HTTP ${res.status}`);
    return { batchId: body.batchId };
  });
  if (process.env.VIP_SCAN_INBOX && process.env.VIP_SCAN_AUTO_INTAKE !== "0") {
    console.log(`Scan auto-intake: watching ${process.env.VIP_SCAN_INBOX} every 5 min`);
  }
});
