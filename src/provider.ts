import * as vscode from 'vscode';
import { AuthManager } from './auth.js';
import {
  countAnthropicRequestChars,
  countOpenAIRequestChars,
  convertMessagesToAnthropic,
  convertMessagesToOpenAI,
  convertToolsToAnthropic,
  convertToolsToOpenAI,
  getMessageText,
} from './convert.js';
import {
  ASSISTANT_TURN_HISTORY_STORAGE_KEY,
  type AssistantTurnHistoryEntry,
  type AssistantTurnHistoryState,
} from './history.js';
import { logger } from './logger.js';
import { ModelCatalog, type ModelDefinition } from './modelCatalog.js';
import {
  getModelConfigurationSchema,
  resolveModelRequestConfiguration,
  resolveOpenAIToolChoice,
  type ModelConfigurationOptions,
  type ModelConfigurationSchema,
} from './modelConfiguration.js';
import { OpenCodeClient } from './opencodeClient.js';
import type { UsageInfo } from './protocolTypes.js';

const AUTH_REQUIRED_DETAIL = 'Run Opencode Go: Set API Key to configure access.';

type ModelPickerInformation = vscode.LanguageModelChatInformation & {
  isUserSelectable?: boolean;
  statusIcon?: vscode.ThemeIcon;
  detail?: string;
  tooltip?: string;
  configurationSchema?: ModelConfigurationSchema;
};

export class OpenCodeGoChatProvider implements vscode.LanguageModelChatProvider {
  private readonly authManager: AuthManager;
  private readonly modelCatalog: ModelCatalog;
  private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
  private readonly assistantTurnHistory: Map<number, AssistantTurnHistoryEntry>;
  private historyModelId: string | undefined;
  private nextAssistantTurnIndex: number;
  private charsPerToken = 4;

  readonly onDidChangeLanguageModelChatInformation =
    this.onDidChangeLanguageModelChatInformationEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.authManager = new AuthManager(context);
    this.modelCatalog = new ModelCatalog(this.authManager);
    const persisted = context.workspaceState.get<AssistantTurnHistoryState>(
      ASSISTANT_TURN_HISTORY_STORAGE_KEY,
    );
    this.assistantTurnHistory = new Map(persisted?.entries ?? []);
    this.historyModelId = persisted?.modelId;
    this.nextAssistantTurnIndex =
      persisted?.nextAssistantTurnIndex ?? this.assistantTurnHistory.size;

    context.subscriptions.push(
      this.onDidChangeLanguageModelChatInformationEmitter,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('opencodeGo.apiKey') ||
          event.affectsConfiguration('opencodeGo.baseUrl') ||
          event.affectsConfiguration('opencodeGo.defaultMaxOutputTokens')
        ) {
          if (event.affectsConfiguration('opencodeGo.baseUrl')) {
            void this.syncModelCatalog();
          }
          this.onDidChangeLanguageModelChatInformationEmitter.fire();
        }
      }),
      context.secrets.onDidChange((event) => {
        if (event.key === 'opencodeGo.apiKey') {
          this.onDidChangeLanguageModelChatInformationEmitter.fire();
        }
      }),
    );

    void this.syncModelCatalog();
  }

  async configureApiKey(): Promise<void> {
    const saved = await this.authManager.promptForApiKey();
    if (saved) {
      this.onDidChangeLanguageModelChatInformationEmitter.fire();
    }
  }

  async clearApiKey(): Promise<void> {
    await this.authManager.deleteApiKey();
    this.onDidChangeLanguageModelChatInformationEmitter.fire();
    vscode.window.showInformationMessage('Opencode Go API key removed.');
  }

  async syncModelCatalog(): Promise<void> {
    try {
      await this.modelCatalog.refresh();
      this.onDidChangeLanguageModelChatInformationEmitter.fire();
    } catch (error) {
      logger.error('Failed to sync Opencode Go model list.', error);
    }
  }

  async showRegisteredModels(): Promise<void> {
    const hasApiKey = await this.authManager.hasApiKey();
    const models = this.modelCatalog.list();

    logger.info(`Registered Opencode Go models. count=${models.length} hasApiKey=${hasApiKey}`);
    for (const model of models) {
      logger.info(
        `model name="${model.name}" id="${model.id}" apiModel="${model.apiModel}" protocol="${model.protocol}"`,
      );
    }
    logger.show();

    void vscode.window.showInformationMessage(
      'Opencode Go model list written to the output log. Look for DeepSeek V4 Pro and DeepSeek V4 Flash.',
    );
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const hasApiKey = await this.authManager.hasApiKey();
    return this.modelCatalog.list().map((model) => toChatInformation(model, hasApiKey));
  }

  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      throw new Error('Opencode Go API key not configured. Run "Opencode Go: Set API Key".');
    }

    const model = this.modelCatalog.get(modelInfo.id);
    if (!model) {
      throw new Error(`Unknown Opencode Go model: ${modelInfo.id}`);
    }

    if (messages.length <= 2 || (this.historyModelId && this.historyModelId !== model.id)) {
      this.resetAssistantTurnHistory(model.id);
    } else if (!this.historyModelId) {
      this.historyModelId = model.id;
    }

    const client = new OpenCodeClient(this.authManager.getBaseUrl(), apiKey);
    const modelConfig = options as ModelConfigurationOptions;
    const requestConfiguration = resolveModelRequestConfiguration(model, modelConfig);

    await new Promise<void>((resolve, reject) => {
      let requestChars = 0;
      let accumulatedThinking = '';
      const callbacks = {
        onText: (text: string) => {
          progress.report(new vscode.LanguageModelTextPart(text));
        },
        onThinking: (text: string) => {
          accumulatedThinking += text;
          const thinkingPart = createThinkingPart(text);
          if (thinkingPart) {
            progress.report(thinkingPart);
          }
        },
        onToolCall: (toolCall: { id: string; name: string; input: Record<string, unknown> }) => {
          progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.input));
        },
        onUsage: (usage: UsageInfo) => {
          this.updateTokenEstimate(requestChars, usage);
          logger.info(formatUsageLog(model.id, usage));
        },
        onDone: () => resolve(),
        onError: (error: Error) => reject(error),
      };

      if (model.protocol === 'anthropic') {
        const anthropicMessages = convertMessagesToAnthropic(messages, {
          assistantTurnHistory: this.assistantTurnHistory,
          includeThinkingBlocks: requestConfiguration.preserveAnthropicThinking,
        });
        requestChars = countAnthropicRequestChars(anthropicMessages);

        void client.streamAnthropicMessage(
          {
            model: model.apiModel,
            messages: anthropicMessages,
            max_tokens: Math.min(model.maxOutputTokens, this.authManager.getDefaultMaxOutputTokens()),
            tools: convertToolsToAnthropic(options.tools),
            tool_choice: options.tools?.length
              ? { type: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'any' : 'auto' }
              : undefined,
            extraBody: requestConfiguration.anthropicBody,
          },
          withHistoryPersistence(
            callbacks,
            () => this.storeAssistantTurnHistory(model.id, requestConfiguration, accumulatedThinking),
          ),
          token,
        );
        return;
      }

      const openaiMessages = convertMessagesToOpenAI(messages, {
        assistantTurnHistory: this.assistantTurnHistory,
        includeReasoningContent: requestConfiguration.preserveOpenAIReasoning,
      });
      requestChars = countOpenAIRequestChars(openaiMessages);

      void client.streamOpenAIChat(
        {
          model: model.apiModel,
          messages: openaiMessages,
          tools: convertToolsToOpenAI(options.tools),
          tool_choice: resolveOpenAIToolChoice(model, options.toolMode, options.tools),
          extraBody: requestConfiguration.openaiBody,
        },
        withHistoryPersistence(
          callbacks,
          () => this.storeAssistantTurnHistory(model.id, requestConfiguration, accumulatedThinking),
        ),
        token,
      );
    });
  }

  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const rawText = getMessageText(text);
    return Math.max(1, Math.ceil(rawText.length / this.charsPerToken));
  }

  private updateTokenEstimate(requestChars: number, usage: UsageInfo): void {
    if (!requestChars || !usage.inputTokens) {
      return;
    }

    const observed = requestChars / usage.inputTokens;
    this.charsPerToken = this.charsPerToken * 0.7 + observed * 0.3;
  }

  private resetAssistantTurnHistory(modelId: string): void {
    this.assistantTurnHistory.clear();
    this.nextAssistantTurnIndex = 0;
    this.historyModelId = modelId;
    void this.persistAssistantTurnHistory();
  }

  private storeAssistantTurnHistory(
    modelId: string,
    requestConfiguration: ReturnType<typeof resolveModelRequestConfiguration>,
    accumulatedThinking: string,
  ): void {
    const historyEntry: AssistantTurnHistoryEntry = {
      timestamp: Date.now(),
    };

    if (requestConfiguration.preserveOpenAIReasoning) {
      historyEntry.reasoningContent = accumulatedThinking;
    }
    if (requestConfiguration.preserveAnthropicThinking) {
      historyEntry.anthropicThinking = accumulatedThinking;
    }

    this.assistantTurnHistory.set(this.nextAssistantTurnIndex, historyEntry);
    this.nextAssistantTurnIndex += 1;
    this.historyModelId = modelId;
    void this.persistAssistantTurnHistory();
  }

  private persistAssistantTurnHistory(): Thenable<void> {
    return this.context.workspaceState.update(ASSISTANT_TURN_HISTORY_STORAGE_KEY, {
      modelId: this.historyModelId,
      nextAssistantTurnIndex: this.nextAssistantTurnIndex,
      entries: [...this.assistantTurnHistory.entries()],
    } satisfies AssistantTurnHistoryState);
  }
}

function toChatInformation(model: ModelDefinition, hasApiKey: boolean): vscode.LanguageModelChatInformation {
  const configurationSchema = getModelConfigurationSchema(model);
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    version: model.version,
    detail: model.detail,
    tooltip: hasApiKey ? undefined : AUTH_REQUIRED_DETAIL,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: {
      imageInput: model.capabilities.imageInput,
      toolCalling: model.capabilities.toolCalling,
    },
    isUserSelectable: true,
    statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
    ...(configurationSchema ? { configurationSchema } : {}),
  } as ModelPickerInformation;
}

function createThinkingPart(text: string): vscode.LanguageModelResponsePart | undefined {
  const vscodeWithThinking = vscode as typeof vscode & {
    LanguageModelThinkingPart?: new (value: string) => vscode.LanguageModelResponsePart;
  };

  if (typeof vscodeWithThinking.LanguageModelThinkingPart !== 'function') {
    return undefined;
  }

  return new vscodeWithThinking.LanguageModelThinkingPart(text);
}

function formatUsageLog(modelId: string, usage: UsageInfo): string {
  const parts = [`[${modelId}]`];
  if (usage.inputTokens !== undefined) {
    parts.push(`input=${usage.inputTokens}`);
  }
  if (usage.outputTokens !== undefined) {
    parts.push(`output=${usage.outputTokens}`);
  }
  if (usage.totalTokens !== undefined) {
    parts.push(`total=${usage.totalTokens}`);
  }
  if (usage.cacheReadTokens !== undefined) {
    parts.push(`cache-read=${usage.cacheReadTokens}`);
  }
  if (usage.cacheWriteTokens !== undefined) {
    parts.push(`cache-write=${usage.cacheWriteTokens}`);
  }
  return parts.join(' ');
}

function withHistoryPersistence(
  callbacks: {
    onText: (text: string) => void;
    onToolCall: (toolCall: { id: string; name: string; input: Record<string, unknown> }) => void;
    onThinking?: (text: string) => void;
    onUsage?: (usage: UsageInfo) => void;
    onDone: () => void;
    onError: (error: Error) => void;
  },
  persist: () => void,
): typeof callbacks {
  return {
    ...callbacks,
    onDone: () => {
      persist();
      callbacks.onDone();
    },
  };
}
