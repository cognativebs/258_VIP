/** IQVault ecosystem — tool registry & dev URLs */

export const TOOLS = {
  VAULTOS: "vaultos",
  IQVAULT: "iqvault",
};

export const TOOL_META = {
  [TOOLS.VAULTOS]: {
    id: TOOLS.VAULTOS,
    name: "VaultOS",
    tagline: "Store operations · identify · acquire",
    port: 5174,
    devUrl: "http://127.0.0.1:5174",
    accent: "#34d399",
  },
  [TOOLS.IQVAULT]: {
    id: TOOLS.IQVAULT,
    name: "IQVault",
    tagline: "Personal intelligence · hunts · portfolio",
    port: 5175,
    devUrl: "http://127.0.0.1:5175",
    accent: "#d4a853",
  },
};

export const BRIDGE = {
  devUrl: "http://127.0.0.1:5199",
  pollMs: 4000,
};

export const ORCHESTR8 = {
  devUrl: "http://127.0.0.1:5210",
  proxyPath: "/api/orchestr8",
};

export const COMICS_API = {
  devUrl: "http://127.0.0.1:5200",
  proxyPath: "/api/comics",
};

export function peerTool(toolId) {
  return toolId === TOOLS.VAULTOS ? TOOLS.IQVAULT : TOOLS.VAULTOS;
}

export function peerUrl(toolId) {
  return TOOL_META[peerTool(toolId)].devUrl;
}
