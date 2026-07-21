import { useState, useEffect, useCallback } from "react";
import { createLinkCode, acceptLinkCode, getLinkStatus } from "../auth/linking.js";
import { fetchPeerSync } from "../bridge/sync.js";
import { TOOL_META, peerTool, peerUrl } from "../config.js";

export default function LinkPanel({ session, syncPayload }) {
  const toolId = session.user.toolId;
  const peer = peerTool(toolId);
  const peerMeta = TOOL_META[peer];

  const [status, setStatus] = useState({ linked: false });
  const [code, setCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [peerData, setPeerData] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    const s = await getLinkStatus(session);
    setStatus(s);
    if (s.linked) {
      const peerSync = await fetchPeerSync(session);
      setPeerData(peerSync);
      if (syncPayload) {
        const { publishSync } = await import("../bridge/sync.js");
        await publishSync(session, syncPayload);
      }
    }
  }, [session, syncPayload]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleGenerate = async () => {
    setErr("");
    try {
      const res = await createLinkCode(session);
      setGeneratedCode(res.code);
      setMsg(`Share code ${res.code} in ${peerMeta.name}`);
    } catch {
      setErr("Bridge offline — run: node bridge/server.js");
    }
  };

  const handleAccept = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await acceptLinkCode(session, inputCode);
      setInputCode("");
      setMsg(`Linked to ${peerMeta.name}`);
      refresh();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <div className="link-panel card">
      <p className="card-title">{peerMeta.name} Link</p>

      {status.bridgeOffline && (
        <p className="link-offline">Bridge offline — start with <code>node bridge/server.js</code></p>
      )}

      {status.linked ? (
        <>
          <p className="link-status linked">
            ✓ Linked to <strong>{status.peerName}</strong>
          </p>
          {peerData?.payload && (
            <div className="link-peer-data">
              <span className="link-peer-label">Receiving from {peerMeta.name}:</span>
              <dl className="link-kv">
                {Object.entries(peerData.payload).map(([k, v]) => (
                  <div key={k} className="link-kv-row">
                    <dt>{k.replace(/([A-Z])/g, " $1").trim()}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <a className="link-external" href={peerUrl(toolId)} target="_blank" rel="noreferrer">
            Open {peerMeta.name} →
          </a>
        </>
      ) : (
        <>
          <p className="link-status">
            Separate login · link accounts to share catalog &amp; hunt data
          </p>
          <div className="link-actions">
            <button type="button" className="btn btn-ghost" onClick={handleGenerate}>
              Generate link code
            </button>
            {generatedCode && (
              <div className="link-code-display">{generatedCode}</div>
            )}
          </div>
          <form onSubmit={handleAccept} className="link-accept-form">
            <input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              placeholder="Enter code from other app"
              maxLength={6}
            />
            <button type="submit" className="btn btn-primary">Link</button>
          </form>
        </>
      )}

      {msg && <p className="link-msg">{msg}</p>}
      {err && <p className="login-error">{err}</p>}
    </div>
  );
}
