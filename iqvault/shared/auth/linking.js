import { BRIDGE } from "../config.js";

export async function createLinkCode(session) {
  const res = await fetch(`${BRIDGE.devUrl}/link/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: session.user.toolId,
      userId: session.user.id,
      userName: session.user.name,
    }),
  });
  if (!res.ok) throw new Error("Failed to create link code");
  return res.json();
}

export async function acceptLinkCode(session, code) {
  const res = await fetch(`${BRIDGE.devUrl}/link/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: session.user.toolId,
      userId: session.user.id,
      userName: session.user.name,
      code: code.trim().toUpperCase(),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Invalid or expired link code");
  }
  return res.json();
}

export async function getLinkStatus(session) {
  try {
    const res = await fetch(
      `${BRIDGE.devUrl}/link/status?toolId=${session.user.toolId}&userId=${session.user.id}`
    );
    if (!res.ok) return { linked: false };
    return res.json();
  } catch {
    return { linked: false, bridgeOffline: true };
  }
}
