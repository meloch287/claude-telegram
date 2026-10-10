import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

export const INSTALLED_CLAUDE_MODELS: ModelInfo[] = [
  {
    "value": "default",
    "resolvedModel": "claude-sonnet-5",
    "displayName": "Default (recommended)",
    "description": "Sonnet 5 · Efficient for routine tasks",
    "supportsEffort": true,
    "supportedEffortLevels": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "supportsAdaptiveThinking": true,
    "supportsAutoMode": true
  },
  {
    "value": "sonnet",
    "resolvedModel": "claude-sonnet-5",
    "displayName": "Sonnet",
    "description": "Sonnet 5 · Efficient for routine tasks",
    "supportsEffort": true,
    "supportedEffortLevels": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "supportsAdaptiveThinking": true,
    "supportsAutoMode": true
  },
  {
    "value": "claude-fable-5-1",
    "resolvedModel": "claude-fable-5-1",
    "displayName": "Fable",
    "description": "Fable 5.1 · Most capable for your hardest and longest-running tasks",
    "supportsEffort": true,
    "supportedEffortLevels": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "supportsAdaptiveThinking": true,
    "supportsAutoMode": true
  },
  {
    "value": "opus",
    "resolvedModel": "claude-opus-5-5",
    "displayName": "Opus",
    "description": "Opus 5.5 · Best for everyday, complex tasks",
    "supportsEffort": true,
    "supportedEffortLevels": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "supportsAdaptiveThinking": true,
    "supportsFastMode": true,
    "supportsAutoMode": true
  },
  {
    "value": "haiku",
    "resolvedModel": "claude-haiku-4-5-20251001",
    "displayName": "Haiku",
    "description": "Haiku 4.5 · Fastest for quick answers"
  }
];
export const CLAUDE_CODE_VERSION = "2.1.280";
