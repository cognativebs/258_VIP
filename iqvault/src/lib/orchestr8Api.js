/** IQVault → Orchestr8 AI Gateway client */

export async function fetchOrchestr8Health() {
  const res = await fetch("/api/orchestr8/v1/health");
  return res.json().catch(() => ({ ok: false }));
}

/** @deprecated Prefer fetchOrchestr8Agents */
export async function fetchOrchestr8Roles() {
  const res = await fetch("/api/orchestr8/v1/roles");
  if (!res.ok) throw new Error("Orchestr8 roles unavailable");
  return res.json();
}

export async function fetchOrchestr8Agents() {
  const res = await fetch("/api/orchestr8/v1/agents");
  if (!res.ok) throw new Error("Orchestr8 agents unavailable");
  return res.json();
}

export async function fetchOrchestr8Models() {
  const res = await fetch("/api/orchestr8/v1/models");
  if (!res.ok) throw new Error("Orchestr8 models unavailable");
  return res.json();
}

export async function fetchOrchestr8Councils() {
  const res = await fetch("/api/orchestr8/v1/councils");
  if (!res.ok) throw new Error("Orchestr8 councils unavailable");
  return res.json();
}

export async function fetchOrchestr8Accounts() {
  const res = await fetch("/api/orchestr8/v1/accounts");
  if (!res.ok) throw new Error("Orchestr8 accounts unavailable");
  return res.json();
}

/** Ask Orchestr8 to recommend a cost-aware team plan (does not run the job). */
export async function planOrchestr8Job({ task, question, contextJson, budgetUsd, quality, maxAgents, council }) {
  const res = await fetch("/api/orchestr8/v1/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task,
      quality,
      council: council || undefined,
      budgetUsd: budgetUsd ?? undefined,
      maxAgents: maxAgents ?? undefined,
      input: { question, contextJson },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Orchestr8 plan error ${res.status}`);
  return data;
}

export async function submitOrchestr8Job({
  task,
  roles,
  mode,
  messages,
  contextJson,
  modelOverrides,
  council,
}) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const res = await fetch("/api/orchestr8/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task,
      roles,
      mode,
      council: council || undefined,
      model_overrides: modelOverrides && Object.keys(modelOverrides).length ? modelOverrides : undefined,
      input: {
        messages,
        question: lastUser?.content ?? "",
        contextJson,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Orchestr8 error ${res.status}`);
  return data;
}

/** Streaming variant — emits each agent step live via callbacks; resolves to final result. */
export async function streamOrchestr8Job(
  { task, roles, mode, messages, contextJson, modelOverrides, council },
  { onStart, onStep, onDone } = {}
) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const res = await fetch("/api/orchestr8/v1/jobs/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task,
      roles,
      mode,
      council: council || undefined,
      model_overrides: modelOverrides && Object.keys(modelOverrides).length ? modelOverrides : undefined,
      input: { messages, question: lastUser?.content ?? "", contextJson },
    }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Orchestr8 error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let evt;
      try {
        evt = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (evt.type === "start") onStart?.(evt);
      else if (evt.type === "step") onStep?.(evt.step);
      else if (evt.type === "done") {
        result = evt.result;
        onDone?.(evt.result);
      } else if (evt.type === "error") {
        throw new Error(evt.error || "Orchestr8 stream error");
      }
    }
  }
  return result;
}
