import { AuthManager } from './auth.js';
import type { ProviderProtocol } from './protocolTypes.js';

const CATALOG_ENDPOINT_SUFFIX = '/models';
const DEFAULT_DETAIL = 'Opencode Go';

export interface ModelDefinition {
  id: string;
  apiModel: string;
  name: string;
  family: string;
  version: string;
  detail: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  protocol: ProviderProtocol;
  capabilities: {
    imageInput: boolean;
    toolCalling: boolean | number;
    thinking: boolean;
  };
}

const KNOWN_MODELS: readonly ModelDefinition[] = [
  defineModel({
    id: withProviderPrefix('glm-5.1'),
    apiModel: 'glm-5.1',
    name: 'GLM-5.1',
    family: 'glm',
    version: '5.1',
    protocol: 'openai',
    maxInputTokens: 202_752,
    maxOutputTokens: 32_768,
  }),
  defineModel({
    id: withProviderPrefix('glm-5'),
    apiModel: 'glm-5',
    name: 'GLM-5',
    family: 'glm',
    version: '5',
    protocol: 'openai',
    maxInputTokens: 202_752,
    maxOutputTokens: 32_768,
  }),
  defineModel({
    id: withProviderPrefix('kimi-k2.5'),
    apiModel: 'kimi-k2.5',
    name: 'Kimi K2.5',
    family: 'kimi',
    version: 'k2.5',
    protocol: 'openai',
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
  }),
  defineModel({
    id: withProviderPrefix('kimi-k2.6'),
    apiModel: 'kimi-k2.6',
    name: 'Kimi K2.6',
    family: 'kimi',
    version: 'k2.6',
    protocol: 'openai',
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
  }),
  defineModel({
    id: withProviderPrefix('mimo-v2-pro'),
    apiModel: 'mimo-v2-pro',
    name: 'MiMo-V2-Pro',
    family: 'mimo',
    version: 'v2-pro',
    protocol: 'openai',
    maxInputTokens: 1_048_576,
    maxOutputTokens: 128_000,
  }),
  defineModel({
    id: withProviderPrefix('mimo-v2-omni'),
    apiModel: 'mimo-v2-omni',
    name: 'MiMo-V2-Omni',
    family: 'mimo',
    version: 'v2-omni',
    protocol: 'openai',
    maxInputTokens: 262_144,
    maxOutputTokens: 128_000,
  }),
  defineModel({
    id: withProviderPrefix('mimo-v2.5-pro'),
    apiModel: 'mimo-v2.5-pro',
    name: 'MiMo-V2.5-Pro',
    family: 'mimo',
    version: 'v2.5-pro',
    protocol: 'openai',
    maxInputTokens: 1_048_576,
    maxOutputTokens: 128_000,
  }),
  defineModel({
    id: withProviderPrefix('mimo-v2.5'),
    apiModel: 'mimo-v2.5',
    name: 'MiMo-V2.5',
    family: 'mimo',
    version: 'v2.5',
    protocol: 'openai',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
  }),
  defineModel({
    id: withProviderPrefix('minimax-m2.5'),
    apiModel: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    family: 'minimax',
    version: 'm2.5',
    protocol: 'anthropic',
    maxInputTokens: 204_800,
    maxOutputTokens: 65_536,
  }),
  defineModel({
    id: withProviderPrefix('minimax-m2.7'),
    apiModel: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    family: 'minimax',
    version: 'm2.7',
    protocol: 'anthropic',
    maxInputTokens: 204_800,
    maxOutputTokens: 131_072,
  }),
  defineModel({
    id: withProviderPrefix('qwen3.5-plus'),
    apiModel: 'qwen3.5-plus',
    name: 'Qwen3.5 Plus',
    family: 'qwen',
    version: '3.5-plus',
    protocol: 'openai',
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
  }),
  defineModel({
    id: withProviderPrefix('qwen3.6-plus'),
    apiModel: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    family: 'qwen',
    version: '3.6-plus',
    protocol: 'openai',
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
  }),
  defineModel({
    id: withProviderPrefix('deepseek-v4-pro'),
    apiModel: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    family: 'deepseek',
    version: 'v4',
    protocol: 'openai',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 384_000,
  }),
  defineModel({
    id: withProviderPrefix('deepseek-v4-flash'),
    apiModel: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    family: 'deepseek',
    version: 'v4',
    protocol: 'openai',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 384_000,
  }),
];

const KNOWN_MODEL_MAP = new Map(
  KNOWN_MODELS.flatMap((model) => [
    [model.id, model],
    [model.apiModel, model],
  ]),
);

export class ModelCatalog {
  private models: ModelDefinition[] = [...KNOWN_MODELS];

  constructor(private readonly authManager: AuthManager) {}

  list(): readonly ModelDefinition[] {
    return this.models;
  }

  get(id: string): ModelDefinition | undefined {
    return this.models.find((model) => model.id === id);
  }

  async refresh(): Promise<{ changed: boolean; count: number }> {
    const response = await fetch(`${this.authManager.getBaseUrl()}${CATALOG_ENDPOINT_SUFFIX}`);
    if (!response.ok) {
      throw new Error(`Model catalog request failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = payload.data
      ?.map((entry) => entry.id?.trim())
      .filter((id): id is string => Boolean(id));

    if (!ids || ids.length === 0) {
      throw new Error('Opencode Go returned an empty model catalog.');
    }

    const nextModels = ids.map((id) => KNOWN_MODEL_MAP.get(id) || inferModel(id));
    const changed = !sameModelIds(this.models, nextModels);
    this.models = nextModels;

    return { changed, count: nextModels.length };
  }
}

function defineModel(
  model: Omit<ModelDefinition, 'detail' | 'capabilities'>,
): ModelDefinition {
  return {
    ...model,
    detail: DEFAULT_DETAIL,
    capabilities: {
      imageInput: false,
      toolCalling: true,
      thinking: true,
    },
  };
}

function withProviderPrefix(id: string): string {
  return `opencode-go/${id}`;
}

function sameModelIds(current: readonly ModelDefinition[], next: readonly ModelDefinition[]): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((model, index) => model.id === next[index]?.id);
}

function inferModel(id: string): ModelDefinition {
  return {
    id: withProviderPrefix(id),
    apiModel: id,
    name: humanizeModelId(id),
    family: inferFamily(id),
    version: inferVersion(id),
    detail: DEFAULT_DETAIL,
    maxInputTokens: inferMaxInputTokens(id),
    maxOutputTokens: inferMaxOutputTokens(id),
    protocol: id.startsWith('minimax-') ? 'anthropic' : 'openai',
    capabilities: {
      imageInput: false,
      toolCalling: true,
      thinking: false,
    },
  };
}

function humanizeModelId(id: string): string {
  return id
    .split('-')
    .map((segment) => {
      if (segment === 'glm') {
        return 'GLM';
      }
      if (segment === 'kimi') {
        return 'Kimi';
      }
      if (segment === 'mimo') {
        return 'MiMo';
      }
      if (segment === 'minimax') {
        return 'MiniMax';
      }
      if (segment === 'qwen3.5') {
        return 'Qwen3.5';
      }
      if (segment === 'qwen3.6') {
        return 'Qwen3.6';
      }
      if (segment === 'deepseek') {
        return 'DeepSeek';
      }
      if (segment.startsWith('v') || segment.startsWith('m') || segment.startsWith('k')) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function inferFamily(id: string): string {
  if (id.startsWith('deepseek-')) {
    return 'deepseek';
  }
  if (id.startsWith('glm-')) {
    return 'glm';
  }
  if (id.startsWith('kimi-')) {
    return 'kimi';
  }
  if (id.startsWith('mimo-')) {
    return 'mimo';
  }
  if (id.startsWith('minimax-')) {
    return 'minimax';
  }
  if (id.startsWith('qwen')) {
    return 'qwen';
  }

  return 'opencode-go';
}

function inferVersion(id: string): string {
  const family = inferFamily(id);
  return id.startsWith(`${family}-`) ? id.slice(family.length + 1) : id;
}

function inferMaxInputTokens(id: string): number {
  if (id.startsWith('deepseek-')) {
    return 1_000_000;
  }
  if (id.startsWith('mimo-v2-pro') || id.startsWith('mimo-v2.5')) {
    return 1_000_000;
  }
  if (id.startsWith('glm-')) {
    return 202_752;
  }
  if (
    id.startsWith('kimi-') ||
    id.startsWith('minimax-') ||
    id.startsWith('mimo-') ||
    id.startsWith('qwen')
  ) {
    return 262_144;
  }

  return 128_000;
}

function inferMaxOutputTokens(id: string): number {
  if (id.startsWith('deepseek-')) {
    return 384_000;
  }
  if (id.startsWith('minimax-m2.7')) {
    return 131_072;
  }
  if (id.startsWith('mimo-')) {
    return 128_000;
  }
  if (id.startsWith('kimi-') || id.startsWith('minimax-m2.5') || id.startsWith('qwen')) {
    return 65_536;
  }
  if (id.startsWith('glm-')) {
    return 32_768;
  }

  return 32_768;
}
