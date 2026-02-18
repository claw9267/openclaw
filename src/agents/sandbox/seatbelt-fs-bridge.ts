import fs from "node:fs/promises";
import path from "node:path";
import type { SandboxFsBridge, SandboxFsStat, SandboxResolvedPath } from "./fs-bridge.js";
import type { SandboxContext } from "./types.js";

/**
 * Native filesystem bridge for the seatbelt sandbox backend.
 * Since seatbelt runs on the host filesystem (not in a container),
 * all file operations use direct Node.js fs calls.
 */
export function createSeatbeltFsBridge(params: { sandbox: SandboxContext }): SandboxFsBridge {
  return new SeatbeltFsBridgeImpl(params.sandbox);
}

class SeatbeltFsBridgeImpl implements SandboxFsBridge {
  private readonly sandbox: SandboxContext;

  constructor(sandbox: SandboxContext) {
    this.sandbox = sandbox;
  }

  resolvePath(params: { filePath: string; cwd?: string }): SandboxResolvedPath {
    const cwd = params.cwd ?? this.sandbox.workspaceDir;
    const resolved = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(cwd, params.filePath);
    const relativePath = path.relative(this.sandbox.workspaceDir, resolved);
    return {
      hostPath: resolved,
      relativePath,
      containerPath: resolved, // seatbelt uses host paths directly
    };
  }

  async readFile(params: { filePath: string; cwd?: string; signal?: AbortSignal }): Promise<Buffer> {
    const { hostPath } = this.resolvePath(params);
    return fs.readFile(hostPath, { signal: params.signal });
  }

  async writeFile(params: {
    filePath: string;
    cwd?: string;
    data: Buffer | string;
    encoding?: BufferEncoding;
    mkdir?: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const { hostPath } = this.resolvePath(params);
    this.ensureWriteAccess(hostPath, "write files");
    if (params.mkdir !== false) {
      const dir = path.dirname(hostPath);
      await fs.mkdir(dir, { recursive: true });
    }
    const buffer = Buffer.isBuffer(params.data)
      ? params.data
      : Buffer.from(params.data, params.encoding ?? "utf8");
    await fs.writeFile(hostPath, buffer, { signal: params.signal });
  }

  async mkdirp(params: { filePath: string; cwd?: string; signal?: AbortSignal }): Promise<void> {
    const { hostPath } = this.resolvePath(params);
    this.ensureWriteAccess(hostPath, "create directories");
    await fs.mkdir(hostPath, { recursive: true });
  }

  async remove(params: {
    filePath: string;
    cwd?: string;
    recursive?: boolean;
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const { hostPath } = this.resolvePath(params);
    this.ensureWriteAccess(hostPath, "remove files");
    await fs.rm(hostPath, { recursive: params.recursive, force: params.force !== false });
  }

  async rename(params: { from: string; to: string; cwd?: string; signal?: AbortSignal }): Promise<void> {
    const from = this.resolvePath({ filePath: params.from, cwd: params.cwd });
    const to = this.resolvePath({ filePath: params.to, cwd: params.cwd });
    this.ensureWriteAccess(from.hostPath, "rename files");
    this.ensureWriteAccess(to.hostPath, "rename files");
    const toDir = path.dirname(to.hostPath);
    await fs.mkdir(toDir, { recursive: true });
    await fs.rename(from.hostPath, to.hostPath);
  }

  async stat(params: {
    filePath: string;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<SandboxFsStat | null> {
    const { hostPath } = this.resolvePath(params);
    try {
      const st = await fs.stat(hostPath);
      return {
        type: st.isDirectory() ? "directory" : st.isFile() ? "file" : "other",
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  private ensureWriteAccess(filePath: string, action: string) {
    if (this.sandbox.workspaceAccess === "ro") {
      throw new Error(`Sandbox path is read-only; cannot ${action}: ${filePath}`);
    }
  }
}
