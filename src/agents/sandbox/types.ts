import type { SandboxFsBridge } from "./fs-bridge.js";
import type { SandboxDockerConfig } from "./types.docker.js";
import type { SandboxSeatbeltConfig } from "./types.seatbelt.js";

export type { SandboxDockerConfig } from "./types.docker.js";
export type { SandboxSeatbeltConfig, SandboxSeatbeltProxyConfig } from "./types.seatbelt.js";

export type SandboxBackend = "docker" | "seatbelt";

export type SandboxToolPolicy = {
  allow?: string[];
  deny?: string[];
};

export type SandboxToolPolicySource = {
  source: "agent" | "global" | "default";
  /**
   * Config key path hint for humans.
   * (Arrays use `agents.list[].…` form.)
   */
  key: string;
};

export type SandboxToolPolicyResolved = {
  allow: string[];
  deny: string[];
  sources: {
    allow: SandboxToolPolicySource;
    deny: SandboxToolPolicySource;
  };
};

export type SandboxWorkspaceAccess = "none" | "ro" | "rw";

export type SandboxBrowserConfig = {
  enabled: boolean;
  image: string;
  containerPrefix: string;
  network: string;
  cdpPort: number;
  cdpSourceRange?: string;
  vncPort: number;
  noVncPort: number;
  headless: boolean;
  enableNoVnc: boolean;
  allowHostControl: boolean;
  autoStart: boolean;
  autoStartTimeoutMs: number;
  binds?: string[];
};

export type SandboxPruneConfig = {
  idleHours: number;
  maxAgeDays: number;
};

export type SandboxScope = "session" | "agent" | "shared";

export type SandboxConfig = {
  mode: "off" | "non-main" | "all";
  /** Sandbox backend: "docker" (default) or "seatbelt" (macOS only). */
  backend: SandboxBackend;
  scope: SandboxScope;
  workspaceAccess: SandboxWorkspaceAccess;
  workspaceRoot: string;
  docker: SandboxDockerConfig;
  /** Seatbelt (sandbox-exec) configuration. Only used when backend is "seatbelt". */
  seatbelt?: SandboxSeatbeltConfig;
  browser: SandboxBrowserConfig;
  tools: SandboxToolPolicy;
  prune: SandboxPruneConfig;
};

export type SandboxBrowserContext = {
  bridgeUrl: string;
  noVncUrl?: string;
  containerName: string;
};

export type SandboxContext = {
  enabled: boolean;
  /** Sandbox backend in use for this session. */
  backend: SandboxBackend;
  sessionKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  workspaceAccess: SandboxWorkspaceAccess;
  /** Docker container name. Set when backend is "docker". */
  containerName: string;
  containerWorkdir: string;
  docker: SandboxDockerConfig;
  /** Seatbelt config. Set when backend is "seatbelt". */
  seatbelt?: SandboxSeatbeltConfig;
  tools: SandboxToolPolicy;
  browserAllowHostControl: boolean;
  browser?: SandboxBrowserContext;
  fsBridge?: SandboxFsBridge;
};

export type SandboxWorkspaceInfo = {
  workspaceDir: string;
  containerWorkdir: string;
};
