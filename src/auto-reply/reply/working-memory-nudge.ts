import type { OpenClawConfig } from "../../config/config.js";

export type WorkingMemorySettings = {
  enabled: boolean;
  topicCheckOnStart: boolean;
  midRunNudgeAfterTools: number;
  flushReminderMinTools: number;
};

type WorkingMemoryConfigPartial = {
  enabled?: boolean;
  topicCheckOnStart?: boolean;
  midRunNudgeAfterTools?: number;
  flushReminderMinTools?: number;
};

const DEFAULT_WORKING_MEMORY_SETTINGS: WorkingMemorySettings = {
  enabled: true,
  topicCheckOnStart: true,
  midRunNudgeAfterTools: 20,
  flushReminderMinTools: 5,
};

export const NUDGE_START_NO_TOPIC =
  "[System] You have no open topics. If you're starting work, create one now with `agent_self topic_create` and update it as you work with `agent_self topic_comment`. Topics are your safety net for session recovery.";

export const NUDGE_MID_RUN = (toolCount: number) =>
  `[System] You've made ${toolCount} tool calls without updating your topic. Flush your current state: decisions made, findings, what's next.`;

export const NUDGE_END_OF_RUN =
  "[System] You did significant work this run without updating working memory. Flush your state to topics or daily notes before wrapping up.";

const MEMORY_TOOL_COMMANDS = new Set([
  "topic_comment",
  "topic_create",
  "memory_write",
  "ltm_write",
]);

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int > 0 ? int : null;
}

export function resolveWorkingMemorySettings(
  cfg: OpenClawConfig,
  perAgent?: WorkingMemoryConfigPartial,
): WorkingMemorySettings | null {
  const globalConfig = cfg?.agents?.defaults?.workingMemory;

  const merged: WorkingMemorySettings = {
    enabled: perAgent?.enabled ?? globalConfig?.enabled ?? DEFAULT_WORKING_MEMORY_SETTINGS.enabled,
    topicCheckOnStart:
      perAgent?.topicCheckOnStart ??
      globalConfig?.topicCheckOnStart ??
      DEFAULT_WORKING_MEMORY_SETTINGS.topicCheckOnStart,
    midRunNudgeAfterTools:
      normalizePositiveInt(perAgent?.midRunNudgeAfterTools) ??
      normalizePositiveInt(globalConfig?.midRunNudgeAfterTools) ??
      DEFAULT_WORKING_MEMORY_SETTINGS.midRunNudgeAfterTools,
    flushReminderMinTools:
      normalizePositiveInt(perAgent?.flushReminderMinTools) ??
      normalizePositiveInt(globalConfig?.flushReminderMinTools) ??
      DEFAULT_WORKING_MEMORY_SETTINGS.flushReminderMinTools,
  };

  if (!merged.enabled) {
    return null;
  }

  return merged;
}

export function isMemoryToolCall(toolName: string, args: unknown): boolean {
  if (toolName !== "agent_self") {
    return false;
  }
  if (!args || typeof args !== "object") {
    return false;
  }
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string") {
    return false;
  }
  return MEMORY_TOOL_COMMANDS.has(command);
}

export function checkMidRunNudge(
  toolCallCount: number,
  hadMemoryTool: boolean,
  settings: WorkingMemorySettings,
): string | null {
  if (hadMemoryTool) {
    return null;
  }
  if (toolCallCount < settings.midRunNudgeAfterTools) {
    return null;
  }
  return NUDGE_MID_RUN(toolCallCount);
}

export function checkEndOfRunNudge(
  toolCallCount: number,
  hadMemoryTool: boolean,
  hadMidRunNudge: boolean,
  settings: WorkingMemorySettings,
): string | null {
  if (toolCallCount < settings.flushReminderMinTools) {
    return null;
  }
  if (hadMemoryTool) {
    return null;
  }
  if (hadMidRunNudge) {
    return null;
  }
  return NUDGE_END_OF_RUN;
}
