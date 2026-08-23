/** Orchestr8 Console → gateway client (proxied via /api/orchestr8). */

export type Health = {
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
  vote?: { vetoed?: boolean; summary?: string; verdict?: string };
  council?: string | null;
  runId?: string;
  buildSpecId?: string;
  buildSpecPath?: string;
  buildSpecStatus?: string;
};

const BASE = "/api/orchestr8";
/** SSE must hit the gateway directly — Next.js rewrites buffer streams and freeze the UI. */
const STREAM_BASE =
  process.env.NEXT_PUBLIC_ORCHESTR8_URL?.replace(/\/$/, "") || "http://127.0.0.1:5210";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Orchestr8 ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch(`${BASE}/v1/health`);
    return (await res.json()) as Health;
  } catch {
    return { ok: false };
  }
}

export async function fetchAgents() {
  return getJson<{
    agents: Array<{
      id: string;
      label: string;
      provider: string;
      providerLabel?: string;
      description?: string;
      defaultModel: string;
      /** The whole catalog — any model can be assigned to any role. */
      allowedModels: Array<{
        id: string;
        label: string;
        provider?: string;
        tier?: string;
        cost?: string;
        context?: number;
        recommended?: boolean;
        configured?: boolean;
      }>;
      recommendedModels?: string[];
      councils?: string[];
      tier?: number;
      configured?: boolean;
      custom?: boolean;
      edited?: boolean;
      verificationStatus?: string;
    }>;
    pipelineOrder?: string[];
  }>("/v1/agents");
}

async function agentWrite<T>(
  path: string,
  method: "POST" | "PATCH",
  input: { name: string; description: string; skill: string }
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { detail?: string; error?: string };
    throw new Error(err.detail || err.error || `Role ${method} failed (${res.status})`);
  }
  return data as T;
}

/** Create an operator-authored role. The gateway derives id, contract and provenance. */
export async function createAgent(input: {
  name: string;
  description: string;
  skill: string;
}) {
  return agentWrite<{ id: string; path?: string }>("/v1/agents", "POST", input);
}

export async function fetchAgent(id: string) {
  const data = await getJson<{
    agent: {
      id: string;
      label: string;
      description?: string;
      skill?: string;
      custom?: boolean;
      edited?: boolean;
    };
  }>(`/v1/agents/${encodeURIComponent(id)}`);
  return data.agent;
}

/** Patch name, description and skill. The agent id never changes. */
export async function updateAgent(
  id: string,
  input: { name: string; description: string; skill: string }
) {
  return agentWrite<{ id: string; path?: string }>(
    `/v1/agents/${encodeURIComponent(id)}`,
    "PATCH",
    input
  );
}

export type Council = {
  id: string;
  label: string;
  purpose?: string;
  mode?: string;
  agents?: string[];
  voting?: string;
  outputOwner?: string;
  custom?: boolean;
  verificationStatus?: string;
};

export async function fetchCouncils() {
  return getJson<{ councils: Council[] }>("/v1/councils");
}

export type CouncilWriteInput = {
  name: string;
  purpose?: string;
  agents: string[];
  mode: "pipeline" | "parallel" | "single";
  voting?: "none" | "veto_on_critical" | "dissent_required";
};

async function councilWrite<T>(
  path: string,
  method: "POST" | "PATCH",
  input: Partial<CouncilWriteInput>
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { detail?: string; error?: string };
    throw new Error(err.detail || err.error || `Council ${method} failed (${res.status})`);
  }
  return data as T;
}

/** Save the current role picks as a named council (selection button). */
export async function createCouncil(input: CouncilWriteInput) {
  return councilWrite<{ id: string; council?: Council }>("/v1/councils", "POST", input);
}

/** Update an operator-saved council. Id never changes. */
export async function updateCouncil(id: string, input: Partial<CouncilWriteInput>) {
  return councilWrite<{ id: string; council?: Council }>(
    `/v1/councils/${encodeURIComponent(id)}`,
    "PATCH",
    input
  );
}

export async function deleteCouncil(id: string) {
  const res = await fetch(`${BASE}/v1/councils/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { detail?: string; error?: string };
    throw new Error(err.detail || err.error || `Council delete failed (${res.status})`);
  }
  return data as { id: string; deleted?: boolean };
}

export async function fetchRuns() {
  return getJson<{
    runs: Array<Record<string, unknown>>;
    count: number;
    retrieved_at?: string;
  }>("/v1/runs");
}

export async function fetchRun(id: string) {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Run ${res.status}`);
  return data as Record<string, unknown>;
}

export async function fetchSpecs() {
  return getJson<{
    specs: Array<{
      id: string;
      title: string;
      verification_status?: string;
      council?: string | null;
      run_id?: string | null;
      path?: string;
      md_path?: string;
    }>;
    count: number;
  }>("/v1/specs");
}

export async function fetchSpec(id: string) {
  const res = await fetch(`${BASE}/v1/specs/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Spec ${res.status}`);
  return data as {
    id: string;
    path?: string;
    md_path?: string | null;
    spec: Record<string, unknown>;
    markdown?: string | null;
  };
}

export async function streamJob(
  payload: {
    task: string;
    roles: string[];
    mode: string;
    question: string;
    contextJson?: string;
    modelOverrides?: Record<string, string>;
    council?: string | null;
  },
  handlers: {
    onStart?: (evt: unknown) => void;
    onProgress?: (evt: {
      phase?: string;
      role?: string;
      message?: string;
    }) => void;
    onStep?: (step: JobStep) => void;
    onDone?: (result: JobResult) => void;
  } = {},
  signal?: AbortSignal
): Promise<JobResult | null> {
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
        question: payload.question,
        contextJson: payload.contextJson ?? "{}",
        messages: [{ role: "user", content: payload.question }],
      },
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Orchestr8 error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: JobResult | null = null;

  try {
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
        let evt: {
          type?: string;
          step?: JobStep;
          result?: JobResult;
          error?: string;
          phase?: string;
          role?: string;
          message?: string;
        };
        try {
          evt = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }
        if (evt.type === "start") handlers.onStart?.(evt);
        else if (evt.type === "progress") {
          handlers.onProgress?.({
            phase: evt.phase,
            role: evt.role,
            message: evt.message,
          });
        } else if (evt.type === "step" && evt.step) handlers.onStep?.(evt.step);
        else if (evt.type === "done") {
          result = evt.result ?? null;
          if (result) handlers.onDone?.(result);
        } else if (evt.type === "error") {
          throw new Error(evt.error || "Orchestr8 stream error");
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) return null;
    throw e;
  }
  return result;
}
