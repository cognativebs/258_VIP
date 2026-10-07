import { TOOLS } from "../config.js";

/** Demo credentials — separate logins per tool (production: isolated auth providers) */
export const DEMO_USERS = {
  [TOOLS.VAULTOS]: [
    {
      id: "vs-store-001",
      email: "store@vaultos.demo",
      password: "demo",
      name: "Demo Card Shop",
      role: "store_operator",
    },
  ],
  [TOOLS.IQVAULT]: [
    {
      id: "iv-greg-001",
      email: "greg@iqvault.local",
      password: "vault",
      name: "Greg",
      role: "owner",
    },
  ],
};

export function authenticate(toolId, email, password) {
  const users = DEMO_USERS[toolId] ?? [];
  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );
  if (!user) return null;
  const { password: _, ...safe } = user;
  return { ...safe, toolId };
}
