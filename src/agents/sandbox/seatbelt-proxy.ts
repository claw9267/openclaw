/**
 * Seatbelt network proxy lifecycle management.
 *
 * Starts/stops the shared network proxy that enforces per-agent domain filtering
 * for seatbelt-sandboxed sessions. The proxy runs as a child process of the gateway.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { STATE_DIR } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveAgentConfig } from "../agent-scope.js";

const log = createSubsystemLogger("seatbelt-proxy");

const PROXY_SCRIPT = path.join(STATE_DIR, "seatbelt-proxy", "proxy.mjs");
const PROXY_CONFIG_PATH = path.join(STATE_DIR, "seatbelt-proxy", "config.json");
const DEFAULT_PROXY_PORT = 18790;

let proxyProcess: ChildProcess | null = null;
let proxyPort: number | null = null;

export interface ProxyAgentPolicy {
  defaultPolicy: "allow" | "deny";
  allowedDomains: string[];
  deniedDomains: string[];
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

    agents[id] = {
      defaultPolicy: seatbelt.proxy.defaultPolicy ?? "deny",
      allowedDomains: seatbelt.proxy.allowedDomains ?? [],
      deniedDomains: seatbelt.proxy.deniedDomains ?? [],
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

  // Check proxy script exists
  if (!fs.existsSync(PROXY_SCRIPT)) {
    log.warn?.(`proxy script not found at ${PROXY_SCRIPT} — copy proxy.mjs to this location`);
    return null;
  }

  const proxyConfig = buildProxyConfig(cfg);

  // Write config
  const configDir = path.dirname(PROXY_CONFIG_PATH);
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(proxyConfig.logDir!, { recursive: true });
  fs.writeFileSync(PROXY_CONFIG_PATH, JSON.stringify(proxyConfig, null, 2));

  // Start proxy process
  const child = spawn("node", [PROXY_SCRIPT, "--config", PROXY_CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  proxyProcess = child;

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

/** Stop the proxy process. */
export function stopSeatbeltProxy(): void {
  if (proxyProcess) {
    try {
      proxyProcess.kill("SIGTERM");
    } catch {
      // already dead
    }
    proxyProcess = null;
    proxyPort = null;
  }
}

/** Get the current proxy port (null if not running). */
export function getSeatbeltProxyPort(): number | null {
  return proxyPort;
}
