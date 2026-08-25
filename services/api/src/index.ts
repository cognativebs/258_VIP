import { createApp } from "./app.js";
import { comicsDsn, normalizeDsn, redactDsn } from "./db/client.js";
import { ebayAuthStatus } from "./lib/comps/ebayAuth.js";
import { loadLocalEnv } from "./lib/loadEnv.js";

loadLocalEnv();

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
createApp().listen(port, host, () => {
  const ebay = ebayAuthStatus();
  console.log(`VIP API listening on http://${host}:${port}`);
  console.log(`Postgres: ${redactDsn(normalizeDsn(comicsDsn()))}`);
  console.log(
    ebay.configured
      ? `eBay comps: ${ebay.mode} (${ebay.environment})`
      : "eBay comps: idle — set EBAY_APP_ID + EBAY_CERT_ID in services/api/.env",
  );
});
