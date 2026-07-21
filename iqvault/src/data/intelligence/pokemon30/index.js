import run001 from "./run_001.json";

export const POKEMON30_RUNS = [run001];

export function getLatestPokemon30Run() {
  return run001;
}

export function getPokemon30Run(runId) {
  return POKEMON30_RUNS.find((r) => r.run_id === runId) ?? null;
}

const PRIORITY_MAP = {
  S: "critical",
  "A+": "high",
  A: "high",
  B: "medium",
  C: "low",
};

export function priorityLabel(p) {
  return p;
}

export function mapPriority(p) {
  return PRIORITY_MAP[p] ?? "medium";
}
