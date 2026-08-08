/** Collector face → Orchestr8 AI Gateway client. */

export type Orchestr8Health = {
  ok?: boolean;
  service?: string;
  providers?: Record<string, boolean>;
};

export type JobStep = {
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

export type JobResult = {
  text?: string;
  trace?: JobStep[];
  mode?: string;
  roles?: string[];
  usage?: { costUsd?: number; total?: number; errors?: number };
  vote?: { vetoed?: boolean; dissent?: boolean; summary?: string; verdict?: string };
  council?: string | null;
  runId?: string;
};

export type AgentInfo = {
  id: string;
  label: string;
  provider: string;
  providerLabel?: string;
  defaultModel?: string;
  configured?: boolean;
};

/** Proxied through Next rewrites for plain JSON reads. */
const BASE = "/api/orchestr8";

/**
 * SSE must hit the gateway directly — Next.js rewrites buffer the stream, which
 * makes a live multi-agent run look frozen until it finishes.
 */
const STREAM_BASE =
  process.env.NEXT_PUBLIC_ORCHESTR8_URL?.replace(/\/$/, "") || "http://127.0.0.1:5210";

export async function fetchOrchestr8Health(): Promise<Orchestr8Health> {
  try {
    const res = await fetch(`${BASE}/v1/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return (await res.json()) as Orchestr8Health;
  } catch {
    return { ok: false };
  }
}

export async function fetchOrchestr8Agents(): Promise<{ agents: AgentInfo[] }> {
  const res = await fetch(`${BASE}/v1/agents`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Orchestr8 agents unavailable (${res.status})`);
  return (await res.json()) as { agents: AgentInfo[] };
}

export async function streamOrchestr8Job(
  payload: {
    task: string;
    roles: string[];
    mode: string;
    question: string;
    contextJson?: string;
    council?: string | null;
  },
  handlers: {
    onStep?: (step: JobStep) => void;
    onDone?: (result: JobResult) => void;
  } = {},
  signal?: AbortSignal,
): Promise<JobResult | null> {
  const res = await fetch(`${STREAM_BASE}/v1/jobs/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: payload.task,
      roles: payload.roles,
      mode: payload.mode,
      council: payload.council || undefined,
      input: {
        question: payload.question,
        contextJson: payload.contextJson ?? "{}",
        messages: [{ role: "user", content: payload.question }],
      },
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Orchestr8 error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: JobResult | null = null;
  let finished = false;

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        let evt: { type?: string; step?: JobStep; result?: JobResult; error?: string };
        try {
          evt = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }
        if (evt.type === "step" && evt.step) handlers.onStep?.(evt.step);
        else if (evt.type === "done") {
          result = evt.result ?? null;
          if (result) handlers.onDone?.(result);
          // `done` is the end of the job. Don't wait for the socket to close —
          // gateways may hold the SSE connection open, which would hang the UI
          // forever with the answer already in hand.
          finished = true;
          break;
        } else if (evt.type === "error") {
          throw new Error(evt.error || "Orchestr8 stream error");
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) return null;
    throw e;
  } finally {
    await reader.cancel().catch(() => {});
  }
  return result;
}
