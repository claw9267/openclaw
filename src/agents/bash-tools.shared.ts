import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { sliceUtf16Safe } from "../utils.js";
import { assertSandboxPath } from "./sandbox-paths.js";

const CHUNK_LIMIT = 8 * 1024;

import type { SandboxBackend, SandboxSeatbeltConfig } from "./sandbox/types.js";

export type BashSandboxConfig = {
  /** Sandbox backend. Default: "docker". */
  backend: SandboxBackend;
  containerName: string;
  workspaceDir: string;
  containerWorkdir: string;
  env?: Record<string, string>;
  /** Seatbelt configuration. Set when backend is "seatbelt". */
  seatbelt?: SandboxSeatbeltConfig;
};

export function buildSandboxEnv(params: {
  defaultPath: string;
  paramsEnv?: Record<string, string>;
  sandboxEnv?: Record<string, string>;
  containerWorkdir: string;
}) {
  const env: Record<string, string> = {
    PATH: params.defaultPath,
    HOME: params.containerWorkdir,
  };
  for (const [key, value] of Object.entries(params.sandboxEnv ?? {})) {
    env[key] = value;
  }
  for (const [key, value] of Object.entries(params.paramsEnv ?? {})) {
    env[key] = value;
  }
  return env;
}

export function coerceEnv(env?: NodeJS.ProcessEnv | Record<string, string>) {
  const record: Record<string, string> = {};
  if (!env) {
    return record;
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}

export function buildDockerExecArgs(params: {
  containerName: string;
  command: string;
  workdir?: string;
  env: Record<string, string>;
  tty: boolean;
}) {
  const args = ["exec", "-i"];
  if (params.tty) {
    args.push("-t");
  }
  if (params.workdir) {
    args.push("-w", params.workdir);
  }
  for (const [key, value] of Object.entries(params.env)) {
    args.push("-e", `${key}=${value}`);
  }
  const hasCustomPath = typeof params.env.PATH === "string" && params.env.PATH.length > 0;
  if (hasCustomPath) {
    // Avoid interpolating PATH into the shell command; pass it via env instead.
    args.push("-e", `OPENCLAW_PREPEND_PATH=${params.env.PATH}`);
  }
  // Login shell (-l) sources /etc/profile which resets PATH to a minimal set,
  // overriding both Docker ENV and -e PATH=... environment variables.
  // Prepend custom PATH after profile sourcing to ensure custom tools are accessible
  // while preserving system paths that /etc/profile may have added.
  const pathExport = hasCustomPath
    ? 'export PATH="${OPENCLAW_PREPEND_PATH}:$PATH"; unset OPENCLAW_PREPEND_PATH; '
    : "";
  args.push(params.containerName, "sh", "-lc", `${pathExport}${params.command}`);
  return args;
}

export function buildSeatbeltExecArgs(params: {
  profilePath: string;
  command: string;
  workdir?: string;
  env: Record<string, string>;
  seatbeltParams?: Record<string, string>;
  proxyPort?: number;
  proxyToken?: string;
  agentId?: string;
}) {
  const args = ["-f", params.profilePath];

  // Add seatbelt -D parameters
  for (const [key, value] of Object.entries(params.seatbeltParams ?? {})) {
    args.push("-D", `${key}=${value}`);
  }

  // Build env export prefix for the shell command
  const envParts: string[] = [];

  // For seatbelt, HOME should be the real home dir so tools (e.g. Claude Code)
  // can find macOS Keychain credentials. The seatbelt profile controls actual
  // read/write permissions, not the HOME env var.
  const env = { ...params.env };
  if (process.env.HOME) {
    env.HOME = process.env.HOME;
  }

  for (const [key, value] of Object.entries(env)) {
    // Escape single quotes in values
    const escaped = value.replace(/'/g, "'\\''");
    envParts.push(`export ${key}='${escaped}';`);
  }

  // Inject proxy env vars if a proxy port is configured
  if (params.proxyPort) {
    // Include agent ID in proxy URL via basic auth so the proxy can identify the agent
    // for per-agent domain filtering (works with CONNECT tunneling too)
    const password = params.proxyToken || "x";
    const authPart = params.agentId ? `${params.agentId}:${password}@` : "";
    const proxyUrl = `http://${authPart}127.0.0.1:${params.proxyPort}`;
    envParts.push(`export HTTP_PROXY='${proxyUrl}';`);
    envParts.push(`export HTTPS_PROXY='${proxyUrl}';`);
    envParts.push(`export http_proxy='${proxyUrl}';`);
    envParts.push(`export https_proxy='${proxyUrl}';`);
    envParts.push(`export no_proxy='localhost,127.0.0.1';`);
    envParts.push(`export NO_PROXY='localhost,127.0.0.1';`);
  }

  const cdPart = params.workdir ? `cd '${params.workdir.replace(/'/g, "'\\''")}';` : "";
  const envExport = envParts.length > 0 ? envParts.join(" ") + " " : "";

  args.push("sh", "-c", `${envExport}${cdPart}${params.command}`);

  return args;
}

export async function resolveSandboxWorkdir(params: {
  workdir: string;
  sandbox: BashSandboxConfig;
  warnings: string[];
}) {
  const fallback = params.sandbox.workspaceDir;
  try {
    const resolved = await assertSandboxPath({
      filePath: params.workdir,
      cwd: process.cwd(),
      root: params.sandbox.workspaceDir,
    });
    const stats = await fs.stat(resolved.resolved);
    if (!stats.isDirectory()) {
      throw new Error("workdir is not a directory");
    }
    const relative = resolved.relative
      ? resolved.relative.split(path.sep).join(path.posix.sep)
      : "";
    const containerWorkdir = relative
      ? path.posix.join(params.sandbox.containerWorkdir, relative)
      : params.sandbox.containerWorkdir;
    return { hostWorkdir: resolved.resolved, containerWorkdir };
  } catch {
    params.warnings.push(
      `Warning: workdir "${params.workdir}" is unavailable; using "${fallback}".`,
    );
    return {
      hostWorkdir: fallback,
      containerWorkdir: params.sandbox.containerWorkdir,
    };
  }
}

export function resolveWorkdir(workdir: string, warnings: string[]) {
  const current = safeCwd();
  const fallback = current ?? homedir();
  try {
    const stats = statSync(workdir);
    if (stats.isDirectory()) {
      return workdir;
    }
  } catch {
    // ignore, fallback below
  }
  warnings.push(`Warning: workdir "${workdir}" is unavailable; using "${fallback}".`);
  return fallback;
}

function safeCwd() {
  try {
    const cwd = process.cwd();
    return existsSync(cwd) ? cwd : null;
  } catch {
    return null;
  }
}

/**
 * Clamp a number within min/max bounds, using defaultValue if undefined or NaN.
 */
export function clampWithDefault(
  value: number | undefined,
  defaultValue: number,
  min: number,
  max: number,
) {
  if (value === undefined || Number.isNaN(value)) {
    return defaultValue;
  }
  return Math.min(Math.max(value, min), max);
}

export function readEnvInt(key: string) {
  const raw = process.env[key];
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function chunkString(input: string, limit = CHUNK_LIMIT) {
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += limit) {
    chunks.push(input.slice(i, i + limit));
  }
  return chunks;
}

export function truncateMiddle(str: string, max: number) {
  if (str.length <= max) {
    return str;
  }
  const half = Math.floor((max - 3) / 2);
  return `${sliceUtf16Safe(str, 0, half)}...${sliceUtf16Safe(str, -half)}`;
}

export function sliceLogLines(
  text: string,
  offset?: number,
  limit?: number,
): { slice: string; totalLines: number; totalChars: number } {
  if (!text) {
    return { slice: "", totalLines: 0, totalChars: 0 };
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const totalLines = lines.length;
  const totalChars = text.length;
  let start =
    typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  if (limit !== undefined && offset === undefined) {
    const tailCount = Math.max(0, Math.floor(limit));
    start = Math.max(totalLines - tailCount, 0);
  }
  const end =
    typeof limit === "number" && Number.isFinite(limit)
      ? start + Math.max(0, Math.floor(limit))
      : undefined;
  return { slice: lines.slice(start, end).join("\n"), totalLines, totalChars };
}

export function deriveSessionName(command: string): string | undefined {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return undefined;
  }
  const verb = tokens[0];
  let target = tokens.slice(1).find((t) => !t.startsWith("-"));
  if (!target) {
    target = tokens[1];
  }
  if (!target) {
    return verb;
  }
  const cleaned = truncateMiddle(stripQuotes(target), 48);
  return `${stripQuotes(verb)} ${cleaned}`;
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
  return matches.map((token) => stripQuotes(token)).filter(Boolean);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function pad(str: string, width: number) {
  if (str.length >= width) {
    return str;
  }
  return str + " ".repeat(width - str.length);
}
