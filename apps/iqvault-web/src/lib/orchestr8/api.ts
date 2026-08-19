/** Collector face → Orchestr8 gateway. Health/agents via Next rewrite; SSE hits :5210 directly. */

export type Orchestr8Health = {
  ok?: boolean;
  service?: string;
  providers?: Record<string, boolean>;
};

export type Orchestr8JobStep = {
  role?: string;
  role_label?: string;
  provider?: string;
  provider_label?: string;
  model?: string;
  model_label?: string;
  text?: string;
  confidence?: number;
  verdict?: string;
  error?: string;
  costUsd?: number;
  usage?: { total?: number };
};

export type Orchestr8JobResult = {
  text?: string;
  trace?: Orchestr8JobStep[];
  mode?: string;
  usage?: { costUsd?: number; total?: number; errors?: number };
  vote?: { vetoed?: boolean; dissent?: boolean; summary?: string };
};

export type Orchestr8Agent = {
  id: string;
  label: string;
  provider: string;
  providerLabel?: string;
  description?: string;
  defaultModel: string;
  allowedModels: Array<{ id: string; label: string; provider?: string }>;
  councils?: string[];
  tier?: number;
};

export type Orchestr8Council = {
  id: string;
  label: string;
  purpose?: string;
  mode?: string;
  agents?: string[];
  voting?: string;
};

const BASE = "/api/orchestr8";
const STREAM_BASE =
  process.env.NEXT_PUBLIC_ORCHESTR8_URL?.replace(/\/$/, "") || "http://127.0.0.1:5210";

export async function fetchOrchestr8Health(): Promise<Orchestr8Health> {
  try {
    const res = await fetch(`${BASE}/v1/health`);
    return (await res.json()) as Orchestr8Health;
  } catch {
    return { ok: false };
  }
}

export async function fetchOrchestr8Agents() {
  const res = await fetch(`${BASE}/v1/agents`);
  if (!res.ok) throw new Error("Orchestr8 agents unavailable");
  return (await res.json()) as { agents: Orchestr8Agent[]; pipelineOrder?: string[] };
}

export async function fetchOrchestr8Councils() {
  const res = await fetch(`${BASE}/v1/councils`);
  if (!res.ok) throw new Error("Orchestr8 councils unavailable");
  return (await res.json()) as { councils: Orchestr8Council[] };
}

export async function streamOrchestr8Job(
  payload: {
    task: string;
    roles: string[];
    mode: string;
    messages: Array<{ role: string; content: string }>;
    contextJson: string;
    modelOverrides?: Record<string, string>;
    council?: string | null;
  },
  handlers: { onStep?: (step: Orchestr8JobStep) => void } = {},
): Promise<Orchestr8JobResult | null> {
  const lastUser = [...payload.messages].reverse().find((m) => m.role === "user");
  const res = await fetch(`${STREAM_BASE}/v1/jobs/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: payload.task,
      roles: payload.roles,
      mode: payload.mode,
      council: payload.council || undefined,
      model_overrides:
        payload.modelOverrides && Object.keys(payload.modelOverrides).length
          ? payload.modelOverrides
          : undefined,
      input: {
        messages: payload.messages,
        question: lastUser?.content ?? "",
        contextJson: payload.contextJson,
      },
    }),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Orchestr8 error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Orchestr8JobResult | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let evt: { type?: string; step?: Orchestr8JobStep; result?: Orchestr8JobResult; error?: string };
      try {
        evt = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (evt.type === "step" && evt.step) handlers.onStep?.(evt.step);
      else if (evt.type === "done") result = evt.result ?? null;
      else if (evt.type === "error") throw new Error(evt.error || "Orchestr8 stream error");
    }
  }
  return result;
}
