import * as vscode from 'vscode';
import type { ModelDefinition } from './modelCatalog.js';

const DEEPSEEK_CONFIGURATION_SCHEMA = {
  properties: {
    reasoningEffort: {
      type: 'string',
      title: 'Thinking',
      enum: ['none', 'high', 'max'],
      enumItemLabels: ['Off', 'High', 'Max'],
      default: 'high',
      group: 'navigation',
    },
  },
} as const;

const GLM_CONFIGURATION_SCHEMA = {
  properties: {
    thinkingMode: {
      type: 'string',
      title: 'Thinking',
      enum: ['enabled', 'disabled'],
      enumItemLabels: ['On', 'Off'],
      default: 'enabled',
      group: 'navigation',
    },
  },
} as const;

const KIMI_CONFIGURATION_SCHEMA = {
  properties: {
    thinkingMode: {
      type: 'string',
      title: 'Thinking',
      enum: ['enabled', 'disabled'],
      enumItemLabels: ['On', 'Off'],
      default: 'enabled',
      group: 'navigation',
    },
  },
} as const;

const QWEN_CONFIGURATION_SCHEMA = {
  properties: {
    thinkingMode: {
      type: 'string',
      title: 'Thinking',
      enum: ['auto', 'enabled', 'disabled'],
      enumItemLabels: ['Auto', 'On', 'Off'],
      default: 'auto',
      group: 'navigation',
    },
    thinkingBudget: {
      type: 'string',
      title: 'Thinking Budget',
      enum: ['auto', '4096', '16384', '32768', '81920'],
      enumItemLabels: ['Auto', '4K', '16K', '32K', '80K'],
      default: 'auto',
      group: 'navigation',
    },
  },
} as const;

export type ModelConfigurationSchema =
  | typeof DEEPSEEK_CONFIGURATION_SCHEMA
  | typeof GLM_CONFIGURATION_SCHEMA
  | typeof KIMI_CONFIGURATION_SCHEMA
  | typeof QWEN_CONFIGURATION_SCHEMA;

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
};

export interface ResolvedModelRequestConfiguration {
  readonly openaiBody?: Record<string, unknown>;
  readonly anthropicBody?: Record<string, unknown>;
  readonly preserveOpenAIReasoning: boolean;
  readonly preserveAnthropicThinking: boolean;
}

export function getModelConfigurationSchema(
  model: ModelDefinition,
): ModelConfigurationSchema | undefined {
  switch (model.family) {
    case 'deepseek':
      return DEEPSEEK_CONFIGURATION_SCHEMA;
    case 'glm':
      return GLM_CONFIGURATION_SCHEMA;
    case 'kimi':
      return KIMI_CONFIGURATION_SCHEMA;
    case 'qwen':
      return QWEN_CONFIGURATION_SCHEMA;
    default:
      return undefined;
  }
}

export function resolveModelRequestConfiguration(
  model: ModelDefinition,
  options: ModelConfigurationOptions,
): ResolvedModelRequestConfiguration {
  switch (model.family) {
    case 'deepseek':
      return resolveDeepSeekRequestConfiguration(options);
    case 'glm':
      return resolveGlmRequestConfiguration(options);
    case 'kimi':
      return resolveKimiRequestConfiguration(options);
    case 'qwen':
      return resolveQwenRequestConfiguration(options);
    case 'minimax':
      return {
        preserveOpenAIReasoning: false,
        preserveAnthropicThinking: true,
      };
    default:
      return {
        preserveOpenAIReasoning: false,
        preserveAnthropicThinking: false,
      };
  }
}

export function resolveOpenAIToolChoice(
  model: ModelDefinition,
  toolMode: vscode.LanguageModelChatToolMode,
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): 'auto' | 'required' | 'none' | undefined {
  if (!tools?.length) {
    return undefined;
  }

  if (model.family === 'kimi' || model.family === 'qwen') {
    return 'auto';
  }

  return toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
}

function resolveDeepSeekRequestConfiguration(
  options: ModelConfigurationOptions,
): ResolvedModelRequestConfiguration {
  const effort = readStringOption(options, 'reasoningEffort');
  if (effort === 'none') {
    return {
      openaiBody: {
        thinking: {
          type: 'disabled',
        },
      },
      preserveOpenAIReasoning: true,
      preserveAnthropicThinking: false,
    };
  }

  const normalizedEffort = effort === 'max' ? 'max' : 'high';
  return {
    openaiBody: {
      thinking: {
        type: 'enabled',
      },
      reasoning_effort: normalizedEffort,
    },
    preserveOpenAIReasoning: true,
    preserveAnthropicThinking: false,
  };
}

function resolveGlmRequestConfiguration(
  options: ModelConfigurationOptions,
): ResolvedModelRequestConfiguration {
  const mode = readStringOption(options, 'thinkingMode');
  if (mode === 'disabled') {
    return {
      openaiBody: {
        thinking: {
          type: 'disabled',
        },
      },
      preserveOpenAIReasoning: true,
      preserveAnthropicThinking: false,
    };
  }

  return {
    openaiBody: {
      thinking: {
        type: 'enabled',
        clear_thinking: false,
      },
    },
    preserveOpenAIReasoning: true,
    preserveAnthropicThinking: false,
  };
}

function resolveKimiRequestConfiguration(
  options: ModelConfigurationOptions,
): ResolvedModelRequestConfiguration {
  const mode = readStringOption(options, 'thinkingMode');
  return {
    openaiBody: {
      thinking: {
        type: mode === 'disabled' ? 'disabled' : 'enabled',
      },
    },
    preserveOpenAIReasoning: true,
    preserveAnthropicThinking: false,
  };
}

function resolveQwenRequestConfiguration(
  options: ModelConfigurationOptions,
): ResolvedModelRequestConfiguration {
  const mode = readStringOption(options, 'thinkingMode');
  const budget = parseThinkingBudget(readStringOption(options, 'thinkingBudget'));
  const body: Record<string, unknown> = {};

  if (mode === 'enabled') {
    body.enable_thinking = true;
  } else if (mode === 'disabled') {
    body.enable_thinking = false;
  } else if (budget !== undefined) {
    body.enable_thinking = true;
  }

  if (budget !== undefined) {
    body.thinking_budget = budget;
  }

  return {
    openaiBody: Object.keys(body).length > 0 ? body : undefined,
    preserveOpenAIReasoning: true,
    preserveAnthropicThinking: false,
  };
}

function readStringOption(
  options: ModelConfigurationOptions,
  key: string,
): string | undefined {
  const modelValue = options.modelConfiguration?.[key];
  if (typeof modelValue === 'string' && modelValue.trim()) {
    return modelValue.trim();
  }

  const legacyValue = options.configuration?.[key];
  if (typeof legacyValue === 'string' && legacyValue.trim()) {
    return legacyValue.trim();
  }

  return undefined;
}

function parseThinkingBudget(value: string | undefined): number | undefined {
  if (!value || value === 'auto') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
