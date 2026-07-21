const SESSION_PREFIX = "iqvault-session-";

export function sessionKey(toolId) {
  return `${SESSION_PREFIX}${toolId}`;
}

export function getSession(toolId) {
  try {
    const raw = localStorage.getItem(sessionKey(toolId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(toolId, user) {
  const payload = { user, signedInAt: new Date().toISOString() };
  localStorage.setItem(sessionKey(toolId), JSON.stringify(payload));
  return payload;
}

export function clearSession(toolId) {
  localStorage.removeItem(sessionKey(toolId));
}
