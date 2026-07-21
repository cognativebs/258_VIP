import { useState } from "react";
import { authenticate } from "../auth/demoUsers.js";
import { getSession, setSession } from "../auth/session.js";
import { TOOL_META } from "../config.js";

export default function LoginGate({ toolId, children }) {
  const meta = TOOL_META[toolId];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [session, setLocalSession] = useState(() => getSession(toolId));

  const signIn = (e) => {
    e.preventDefault();
    const user = authenticate(toolId, email, password);
    if (!user) {
      setError("Invalid email or password");
      return;
    }
    const s = setSession(toolId, user);
    setLocalSession(s);
    setError("");
  };

  if (!session) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand" style={{ borderColor: `${meta.accent}44` }}>
            <span className="login-icon">{toolId === "vaultos" ? "🏪" : "🏛"}</span>
            <h1>{meta.name}</h1>
            <p>{meta.tagline}</p>
          </div>
          <form onSubmit={signIn} className="login-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={toolId === "vaultos" ? "store@vaultos.demo" : "greg@iqvault.local"}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="btn btn-primary login-submit">
              Sign in
            </button>
          </form>
          <p className="login-hint">
            Demo: {toolId === "vaultos" ? "store@vaultos.demo / demo" : "greg@iqvault.local / vault"}
          </p>
        </div>
      </div>
    );
  }

  return children({ session, user: session.user });
}
