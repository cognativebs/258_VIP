/**
 * IQVault Bridge — dev sync server for VaultOS ↔ IQVault data exchange.
 * Run: node bridge/server.js  (port 5199)
 */
import http from "node:http";

const PORT = 5199;
const links = new Map();
const pendingCodes = new Map();
const syncByUser = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function userKey(toolId, userId) {
  return `${toolId}:${userId}`;
}

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "POST" && url.pathname === "/link/create") {
      const body = await readBody(req);
      const code = genCode();
      pendingCodes.set(code, {
        ...body,
        code,
        createdAt: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      json(res, 200, { code, expiresInMinutes: 15 });
      return;
    }

    if (req.method === "POST" && url.pathname === "/link/accept") {
      const body = await readBody(req);
      const pending = pendingCodes.get(body.code?.toUpperCase());
      if (!pending || pending.expiresAt < Date.now()) {
        json(res, 400, { error: "Invalid or expired link code" });
        return;
      }
      if (pending.toolId === body.toolId) {
        json(res, 400, { error: "Cannot link the same tool — use the other app" });
        return;
      }

      const linkId = crypto.randomUUID();
      const record = {
        linkId,
        linkedAt: new Date().toISOString(),
        [pending.toolId]: { userId: pending.userId, userName: pending.userName },
        [body.toolId]: { userId: body.userId, userName: body.userName },
      };
      links.set(userKey(pending.toolId, pending.userId), record);
      links.set(userKey(body.toolId, body.userId), record);
      pendingCodes.delete(body.code.toUpperCase());
      json(res, 200, { linked: true, linkId, peer: pending });
      return;
    }

    if (req.method === "GET" && url.pathname === "/link/status") {
      const toolId = url.searchParams.get("toolId");
      const userId = url.searchParams.get("userId");
      const record = links.get(userKey(toolId, userId));
      if (!record) {
        json(res, 200, { linked: false });
        return;
      }
      const peerEntry = Object.entries(record).find(
        ([k]) => k !== "linkId" && k !== "linkedAt" && k !== toolId
      );
      json(res, 200, {
        linked: true,
        linkId: record.linkId,
        linkedAt: record.linkedAt,
        peerToolId: peerEntry?.[0],
        peerName: peerEntry?.[1]?.userName,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/sync/publish") {
      const body = await readBody(req);
      const key = userKey(body.toolId, body.userId);
      if (!links.has(key)) {
        json(res, 403, { error: "Accounts not linked" });
        return;
      }
      syncByUser.set(key, body);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sync/peer") {
      const toolId = url.searchParams.get("toolId");
      const userId = url.searchParams.get("userId");
      const peer = url.searchParams.get("peer");
      const record = links.get(userKey(toolId, userId));
      if (!record) {
        json(res, 200, { linked: false, payload: null });
        return;
      }
      const peerInfo = record[peer];
      if (!peerInfo) {
        json(res, 200, { linked: true, payload: null });
        return;
      }
      const peerSync = syncByUser.get(userKey(peer, peerInfo.userId));
      json(res, 200, {
        linked: true,
        payload: peerSync?.payload ?? null,
        peerUpdatedAt: peerSync?.at ?? null,
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: String(e.message) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`IQVault Bridge listening on http://127.0.0.1:${PORT}`);
});
