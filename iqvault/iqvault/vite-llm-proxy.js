/**
 * Vite dev/preview middleware — unified LLM proxy for comics analytics.
 * Keys: request body apiKey OR server .env.local (ANTHROPIC_API_KEY, etc.)
 */

const SYSTEM_PREFIX = `You are IQVault Comics Intelligence — a personal collection analyst for a serious comic collector.

You analyze CLZ export data with IQVault intelligence scores (Museum, Investment, Liquidity, Collection Pillar, Recommendation).
Ground answers in the provided JSON context. Be direct and actionable.`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function resolveKey(body, env, provider) {
  const fromClient = body.apiKey?.trim();
  if (fromClient) return fromClient;
  const map = {
    anthropic: env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY,
    grok: env.XAI_API_KEY || env.VITE_XAI_API_KEY,
    cursor: env.CURSOR_API_KEY || env.VITE_CURSOR_API_KEY,
  };
  return map[provider] || "";
}

async function callAnthropic({ apiKey, model, system, messages }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 2048,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Anthropic ${res.status}`);
  const text = data.content?.find((b) => b.type === "text")?.text?.trim();
  if (!text) throw new Error("Empty Anthropic response");
  return { text };
}

async function callOpenAICompatible({ apiKey, baseUrl, model, system, messages }) {
  const chatMessages = [
    { role: "system", content: system },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: chatMessages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `API ${res.status}`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty chat response");
  return { text };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollCursorRun({ apiKey, agentId, runId, maxWaitMs = 120000 }) {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const res = await fetch(`https://api.cursor.com/v1/agents/${agentId}/runs/${runId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || `Cursor ${res.status}`);
    const status = data.status;
    if (status === "FINISHED") {
      const text = data.result?.trim();
      if (!text) throw new Error("Cursor run finished with no text");
      return { text, cursorAgentId: agentId };
    }
    if (["ERROR", "CANCELLED", "EXPIRED"].includes(status)) {
      throw new Error(`Cursor run ${status}`);
    }
    await sleep(2000);
  }
  throw new Error("Cursor run timed out — try Claude/OpenAI/Grok for faster replies");
}

async function callCursor({ apiKey, model, system, messages, cursorAgentId }) {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const modelId = model === "auto" ? undefined : model || "composer-2.5";

  let agentId = cursorAgentId;
  let runId;

  if (!agentId) {
    const promptText = `${system}\n\n--- USER QUESTION ---\n${lastUser}`;
    const body = {
      prompt: { text: promptText.slice(0, 120000) },
      mode: "plan",
    };
    if (modelId) body.model = { id: modelId };

    const res = await fetch("https://api.cursor.com/v1/agents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || `Cursor create ${res.status}`);
    agentId = data.agent?.id;
    runId = data.run?.id;
    if (!agentId || !runId) throw new Error("Cursor did not return agent/run ids");
  } else {
    const res = await fetch(`https://api.cursor.com/v1/agents/${agentId}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        prompt: { text: lastUser.slice(0, 32000) },
        mode: "plan",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || `Cursor follow-up ${res.status}`);
    runId = data.run?.id;
    if (!runId) throw new Error("Cursor did not return run id");
  }

  return pollCursorRun({ apiKey, agentId, runId });
}

async function handleLlmChat(body, env) {
  const { provider, model, messages, contextJson, apiKey: clientKey, cursorAgentId } = body;
  if (!messages?.length) throw new Error("No messages");

  const apiKey = clientKey?.trim() || resolveKey(body, env, provider);
  if (!apiKey) throw new Error(`No API key for ${provider} — add in Settings or .env.local`);

  const system = `${SYSTEM_PREFIX}\n\n--- CURRENT COLLECTION CONTEXT ---\n${contextJson || "{}"}`;

  switch (provider) {
    case "anthropic":
      return callAnthropic({ apiKey, model, system, messages });
    case "openai":
      return callOpenAICompatible({
        apiKey,
        baseUrl: "https://api.openai.com",
        model: model || "gpt-4.1",
        system,
        messages,
      });
    case "grok":
      return callOpenAICompatible({
        apiKey,
        baseUrl: "https://api.x.ai",
        model: model || "grok-3",
        system,
        messages,
      });
    case "cursor":
      return callCursor({ apiKey, model, system, messages, cursorAgentId });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function llmMiddleware(env) {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/llm/chat")) return next();
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readBody(req);
      const result = await handleLlmChat(body, env);
      json(res, 200, result);
    } catch (e) {
      json(res, 500, { error: e.message || "LLM request failed" });
    }
  };
}

export function llmProxyPlugin(env) {
  const middleware = llmMiddleware(env);
  return {
    name: "iqvault-llm-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export function buildLlmEnvFlags(env) {
  return {
    anthropic: Boolean(env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY),
    grok: Boolean(env.XAI_API_KEY || env.VITE_XAI_API_KEY),
    cursor: Boolean(env.CURSOR_API_KEY || env.VITE_CURSOR_API_KEY),
  };
}
