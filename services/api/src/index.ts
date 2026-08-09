import { createApp } from "./app.js";
import { comicsDsn, normalizeDsn, redactDsn } from "./db/client.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
createApp().listen(port, host, () => {
  console.log(`VIP API listening on http://${host}:${port}`);
  console.log(`Postgres: ${redactDsn(normalizeDsn(comicsDsn()))}`);
});
