import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  resolveWorkingMemorySettings,
  isMemoryToolCall,
  checkMidRunNudge,
  checkEndOfRunNudge,
  NUDGE_MID_RUN,
  NUDGE_END_OF_RUN,
} from "./working-memory-nudge.js";

describe("resolveWorkingMemorySettings", () => {
  it("returns defaults when no config specified", () => {
    const settings = resolveWorkingMemorySettings({} as OpenClawConfig);
    expect(settings).toEqual({
      enabled: true,
      topicCheckOnStart: true,
      midRunNudgeAfterTools: 20,
      flushReminderMinTools: 5,
    });
  });

  it("returns null when disabled", () => {
    const cfg = {
      agents: { defaults: { workingMemory: { enabled: false } } },
    } as OpenClawConfig;
    const settings = resolveWorkingMemorySettings(cfg);
    expect(settings).toBeNull();
  });

  it("merges partial overrides with defaults", () => {
    const cfg = {
      agents: { defaults: { workingMemory: { midRunNudgeAfterTools: 10 } } },
    } as OpenClawConfig;
    const settings = resolveWorkingMemorySettings(cfg);
    expect(settings).toEqual({
      enabled: true,
      topicCheckOnStart: true,
      midRunNudgeAfterTools: 10,
      flushReminderMinTools: 5,
    });
  });

  it("applies per-agent override", () => {
    const cfg = {
      agents: {
        defaults: { workingMemory: { enabled: true } },
      },
    } as OpenClawConfig;
    const perAgent = { enabled: false };
    const settings = resolveWorkingMemorySettings(cfg, perAgent);
    expect(settings).toBeNull();
  });
});

describe("isMemoryToolCall", () => {
  it("detects agent_self topic_comment", () => {
    expect(isMemoryToolCall("agent_self", { command: "topic_comment" })).toBe(true);
  });

  it("detects agent_self topic_create", () => {
    expect(isMemoryToolCall("agent_self", { command: "topic_create" })).toBe(true);
  });

  it("detects agent_self memory_write", () => {
    expect(isMemoryToolCall("agent_self", { command: "memory_write" })).toBe(true);
  });

  it("detects agent_self ltm_write", () => {
    expect(isMemoryToolCall("agent_self", { command: "ltm_write" })).toBe(true);
  });

  it("returns false for agent_self with other commands", () => {
    expect(isMemoryToolCall("agent_self", { command: "whoami" })).toBe(false);
  });

  it("returns false for other tools", () => {
    expect(isMemoryToolCall("exec", { command: "ls" })).toBe(false);
  });

  it("handles missing args gracefully", () => {
    expect(isMemoryToolCall("agent_self", undefined)).toBe(false);
    expect(isMemoryToolCall("agent_self", null)).toBe(false);
    expect(isMemoryToolCall("agent_self", {})).toBe(false);
  });
});

describe("checkMidRunNudge", () => {
  const settings = {
    enabled: true,
    topicCheckOnStart: true,
    midRunNudgeAfterTools: 20,
    flushReminderMinTools: 5,
  };

  it("returns null below threshold", () => {
    expect(checkMidRunNudge(19, false, settings)).toBeNull();
  });

  it("returns nudge at threshold", () => {
    const result = checkMidRunNudge(20, false, settings);
    expect(result).toContain("20 tool calls");
    expect(result).toBe(NUDGE_MID_RUN(20));
  });

  it("returns null when memory tool was used", () => {
    expect(checkMidRunNudge(25, true, settings)).toBeNull();
  });
});

describe("checkEndOfRunNudge", () => {
  const settings = {
    enabled: true,
    topicCheckOnStart: true,
    midRunNudgeAfterTools: 20,
    flushReminderMinTools: 5,
  };

  it("returns null below threshold", () => {
    expect(checkEndOfRunNudge(4, false, false, settings)).toBeNull();
  });

  it("returns nudge for significant work without memory writes", () => {
    const result = checkEndOfRunNudge(10, false, false, settings);
    expect(result).toContain("significant work");
    expect(result).toBe(NUDGE_END_OF_RUN);
  });

  it("returns null when memory tool was used", () => {
    expect(checkEndOfRunNudge(10, true, false, settings)).toBeNull();
  });

  it("returns null when mid-run nudge was sent and memory was written after", () => {
    expect(checkEndOfRunNudge(25, true, true, settings)).toBeNull();
  });
});
