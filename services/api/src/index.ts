import { createApp } from "./app.js";
import { resolveBinderDbPath } from "./lib/binderHoldings.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
createApp().listen(port, host, () => {
  console.log(`VIP API listening on http://${host}:${port}`);
  console.log(`Binder SQLite: ${resolveBinderDbPath()}`);
});
