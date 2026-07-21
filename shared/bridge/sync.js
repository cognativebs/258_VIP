import { BRIDGE, peerTool } from "../config.js";

export async function publishSync(session, payload) {
  try {
    await fetch(`${BRIDGE.devUrl}/sync/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolId: session.user.toolId,
        userId: session.user.id,
        payload,
        at: new Date().toISOString(),
      }),
    });
  } catch {
    /* bridge offline — local-only mode */
  }
}

export async function fetchPeerSync(session) {
  try {
    const peer = peerTool(session.user.toolId);
    const res = await fetch(
      `${BRIDGE.devUrl}/sync/peer?toolId=${session.user.toolId}&userId=${session.user.id}&peer=${peer}`
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
