/**
 * Seatbelt network proxy lifecycle management.
 *
 * Starts/stops the shared network proxy that enforces per-agent domain filtering
 * for seatbelt-sandboxed sessions. The proxy runs as a child process of the gateway.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { STATE_DIR } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveAgentConfig } from "../agent-scope.js";

const log = createSubsystemLogger("seatbelt-proxy");

const PROXY_SCRIPT = path.join(STATE_DIR, "seatbelt-proxy", "proxy.mjs");
const PROXY_CONFIG_PATH = path.join(STATE_DIR, "seatbelt-proxy", "config.json");
const PROXY_PID_PATH = path.join(STATE_DIR, "seatbelt-proxy", "proxy.pid");
const DEFAULT_PROXY_PORT = 18790;

let proxyProcess: ChildProcess | null = null;
let proxyPort: number | null = null;

export interface ProxyAgentPolicy {
  defaultPolicy: "allow" | "deny";
  allowedDomains: string[];
  deniedDomains: string[];
  /** Per-agent token to prevent impersonation via proxy auth. */
  token?: string;
}

export interface ProxyConfig {
  port: number;
  logDir: string | null;
  agents: Record<string, ProxyAgentPolicy>;
  defaultPolicy: "allow" | "deny";
}

/**
 * Build proxy config from OpenClaw config by extracting seatbelt proxy settings
 * from each agent in agents.list.
 */
export function buildProxyConfig(cfg: OpenClawConfig): ProxyConfig {
  const agents: Record<string, ProxyAgentPolicy> = {};
  const agentList = cfg.agents?.list ?? [];

  for (const agentDef of agentList) {
    const id = typeof agentDef === "string" ? agentDef : agentDef.id;
    if (!id) {
      continue;
    }
    const resolved = resolveAgentConfig(cfg, id);
    const seatbelt = resolved?.sandbox?.seatbelt;
    if (!seatbelt?.proxy) {
      continue;
    }

    // Generate a per-agent token to prevent agent impersonation via proxy auth.
    // Each agent gets a unique random token included in its proxy URL password.
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    agents[id] = {
      defaultPolicy: seatbelt.proxy.defaultPolicy ?? "deny",
      allowedDomains: seatbelt.proxy.allowedDomains ?? [],
      deniedDomains: seatbelt.proxy.deniedDomains ?? [],
      token,
    };
  }

  // Also check defaults
  const defaultSeatbelt = cfg.agents?.defaults?.sandbox?.seatbelt;
  const defaultProxy = defaultSeatbelt?.proxy;

  return {
    port: defaultProxy?.port ?? DEFAULT_PROXY_PORT,
    logDir: path.join(STATE_DIR, "seatbelt-proxy", "logs"),
    agents,
    defaultPolicy: defaultProxy?.defaultPolicy ?? "deny",
  };
}

/**
 * Kill any process listening on the given port.
 * Uses lsof to find PIDs, escalates from SIGTERM to SIGKILL.
 * Returns true if the port was freed.
 */
function killProcessOnPort(port: number): boolean {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pid = execSync(`lsof -ti tcp:${port} -s tcp:listen`, {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (!pid) return true; // port is free
      const signal = attempt < 2 ? "SIGTERM" : "SIGKILL";
      for (const p of pid.split("\n").filter(Boolean)) {
        try {
          process.kill(parseInt(p, 10), signal);
        } catch {
          // already dead
        }
      }
      log.info?.(`killed orphaned proxy on port ${port} (pid ${pid}, ${signal})`);
      // Wait for process to release the port
      const waitMs = signal === "SIGKILL" ? 200 : 1000;
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        // busy-wait (sync context, short duration)
      }
    } catch {
      return true; // lsof found nothing — port is free
    }
  }
  // Final check
  try {
    execSync(`lsof -ti tcp:${port} -s tcp:listen`, { encoding: "utf-8", timeout: 2000 });
    return false; // still occupied
  } catch {
    return true; // port is free
  }
}

/**
 * Kill the proxy identified by PID file, if it exists.
 */
function killProxyByPidFile(): void {
  try {
    if (!fs.existsSync(PROXY_PID_PATH)) return;
    const pid = parseInt(fs.readFileSync(PROXY_PID_PATH, "utf-8").trim(), 10);
    if (isNaN(pid)) return;
    try {
      process.kill(pid, "SIGTERM");
      log.info?.(`killed proxy from PID file (pid ${pid})`);
    } catch {
      // already dead
    }
    try {
      fs.unlinkSync(PROXY_PID_PATH);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

/**
 * Write proxy config and start the proxy process.
 * Returns the port the proxy is listening on.
 */
export async function startSeatbeltProxy(cfg: OpenClawConfig): Promise<number | null> {
  // Check if any agent uses seatbelt backend
  const hasSeatbelt =
    cfg.agents?.defaults?.sandbox?.backend === "seatbelt" ||
    (cfg.agents?.list ?? []).some((a) => {
      const agent = typeof a === "string" ? null : a;
      return agent?.sandbox?.backend === "seatbelt";
    });

  if (!hasSeatbelt) {
    log.info?.("no seatbelt agents configured, skipping proxy start");
    return null;
  }

  // Stop any existing proxy first (handles gateway restarts)
  stopSeatbeltProxy();

  // Check proxy script exists
  if (!fs.existsSync(PROXY_SCRIPT)) {
    log.warn?.(`proxy script not found at ${PROXY_SCRIPT} — copy proxy.mjs to this location`);
    return null;
  }

  const proxyConfig = buildProxyConfig(cfg);

  // Store agent tokens in memory so exec code can look them up
  const tokens: Record<string, string> = {};
  for (const [id, policy] of Object.entries(proxyConfig.agents)) {
    if (policy.token) {
      tokens[id] = policy.token;
    }
  }
  setAgentTokens(tokens);

  // Write config
  const configDir = path.dirname(PROXY_CONFIG_PATH);
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(proxyConfig.logDir!, { recursive: true });
  fs.writeFileSync(PROXY_CONFIG_PATH, JSON.stringify(proxyConfig, null, 2));

  // Kill any orphaned proxy on the configured port
  if (proxyConfig.port > 0) {
    killProxyByPidFile();
    if (!killProcessOnPort(proxyConfig.port)) {
      log.warn?.(`failed to free port ${proxyConfig.port} — proxy may not start`);
    }
  }

  // Start proxy process
  const child = spawn("node", [PROXY_SCRIPT, "--config", PROXY_CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  proxyProcess = child;

  // Write PID file for orphan cleanup on next restart
  if (child.pid) {
    try {
      fs.writeFileSync(PROXY_PID_PATH, String(child.pid), "utf-8");
    } catch {
      // non-fatal
    }
  }

  // Capture port from stdout (proxy emits PORT=NNNNN when auto-assigning)
  return new Promise<number | null>((resolve) => {
    let resolved = false;
    const port = proxyConfig.port || 0;

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      log.info?.(text.trim());
      if (!resolved) {
        const portMatch = text.match(/PORT=(\d+)/);
        if (portMatch) {
          proxyPort = parseInt(portMatch[1], 10);
          resolved = true;
          resolve(proxyPort);
        } else if (port > 0 && text.includes("Listening on")) {
          proxyPort = port;
          resolved = true;
          resolve(proxyPort);
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      log.warn?.(data.toString().trim());
    });

    child.on("error", (err) => {
      log.warn?.(`proxy process error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    child.on("exit", (code) => {
      log.info?.(`proxy exited with code ${code}`);
      proxyProcess = null;
      proxyPort = null;
      try { fs.unlinkSync(PROXY_PID_PATH); } catch { /* ignore */ }
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    // Timeout: if proxy doesn't report port in 5s, give up
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log.warn?.("proxy did not report port within 5s");
        resolve(null);
      }
    }, 5000);
  });
}

/** Stop the proxy process (in-memory reference + PID file + port orphan cleanup). */
export function stopSeatbeltProxy(): void {
  // 1. Kill in-memory child process
  if (proxyProcess) {
    try {
      proxyProcess.kill("SIGTERM");
    } catch {
      // already dead
    }
    proxyProcess = null;
    proxyPort = null;
  }
  // 2. Kill by PID file (catches orphans from crashed gateway)
  killProxyByPidFile();
}

/** Get the current proxy port (null if not running). */
export function getSeatbeltProxyPort(): number | null {
  return proxyPort;
}

/** In-memory map of agent tokens generated during proxy startup. */
let agentTokens: Record<string, string> = {};

/** Store the agent token map after building proxy config. */
export function setAgentTokens(tokens: Record<string, string>): void {
  agentTokens = tokens;
}

/** Get the proxy auth token for a specific agent. */
export function getSeatbeltProxyToken(agentId: string): string | undefined {
  return agentTokens[agentId];
}
