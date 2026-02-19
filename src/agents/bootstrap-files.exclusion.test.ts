import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInternalHooks } from "../hooks/internal-hooks.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { resolveBootstrapFilesForRun } from "./bootstrap-files.js";
import type { OpenClawConfig } from "../config/config.js";

describe("resolveBootstrapFilesForRun — bootstrap file exclusion", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("auto-skips MEMORY.md when plugins.slots.memory is 'none'", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-excl-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "AGENTS.md", content: "# Agents" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "MEMORY.md", content: "# Memory" });

    const config: OpenClawConfig = {
      plugins: { slots: { memory: "none" } },
    };

    const files = await resolveBootstrapFilesForRun({ workspaceDir, config });

    expect(files.some((f) => f.name === "MEMORY.md")).toBe(false);
    expect(files.some((f) => f.name === "AGENTS.md")).toBe(true);
  });

  it("excludes files listed in workspace.bootstrapExclude", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-excl-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "AGENTS.md", content: "# Agents" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "SOUL.md", content: "# Soul" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "TOOLS.md", content: "# Tools" });

    const config: OpenClawConfig = {
      workspace: { bootstrapExclude: ["SOUL.md"] },
    };

    const files = await resolveBootstrapFilesForRun({ workspaceDir, config });

    expect(files.some((f) => f.name === "SOUL.md")).toBe(false);
    expect(files.some((f) => f.name === "AGENTS.md")).toBe(true);
    expect(files.some((f) => f.name === "TOOLS.md")).toBe(true);
  });

  it("applies both auto-skip and config excludes simultaneously", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-excl-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "AGENTS.md", content: "# Agents" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "SOUL.md", content: "# Soul" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "MEMORY.md", content: "# Memory" });

    const config: OpenClawConfig = {
      plugins: { slots: { memory: "none" } },
      workspace: { bootstrapExclude: ["SOUL.md"] },
    };

    const files = await resolveBootstrapFilesForRun({ workspaceDir, config });

    expect(files.some((f) => f.name === "MEMORY.md")).toBe(false);
    expect(files.some((f) => f.name === "SOUL.md")).toBe(false);
    expect(files.some((f) => f.name === "AGENTS.md")).toBe(true);
  });

  it("includes all files when neither exclusion mechanism is configured", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-excl-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "AGENTS.md", content: "# Agents" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "MEMORY.md", content: "# Memory" });

    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    const nonMissingNames = files.filter((f) => !f.missing).map((f) => f.name);
    expect(nonMissingNames).toContain("AGENTS.md");
    expect(nonMissingNames).toContain("MEMORY.md");
  });

  it("does not skip MEMORY.md when memory plugin is set to a value other than 'none'", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-excl-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "MEMORY.md", content: "# Memory" });

    const config: OpenClawConfig = {
      plugins: { slots: { memory: "built-in" } },
    };

    const files = await resolveBootstrapFilesForRun({ workspaceDir, config });

    expect(files.some((f) => f.name === "MEMORY.md" && !f.missing)).toBe(true);
  });
});
