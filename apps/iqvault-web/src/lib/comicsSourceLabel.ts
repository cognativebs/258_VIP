/** Status line for Comics Terminal — VIP fallback is editable; CLZ inbox still needs :5200. */

export type ComicsTerminalSource = "comics-api" | "vip-api" | null;

export function comicsTerminalSourceLabel(source: ComicsTerminalSource): string {
  if (source === "comics-api") return "Postgres live (editable)";
  if (source === "vip-api") {
    return "VIP → Postgres (editable) · start Comics API :5200 for CLZ inbox";
  }
  return "Loading source…";
}
