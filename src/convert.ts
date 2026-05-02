import * as vscode from 'vscode';
import type { AssistantTurnHistoryEntry } from './history.js';
import type {
  AnthropicMessage,
  AnthropicThinkingBlock,
  AnthropicTextBlock,
  AnthropicTool,
  OpenAICompatibleMessage,
  OpenAICompatibleTool,
  OpenAICompatibleToolCall,
} from './protocolTypes.js';

export function convertMessagesToOpenAI(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options?: {
    assistantTurnHistory?: ReadonlyMap<number, AssistantTurnHistoryEntry>;
    includeReasoningContent?: boolean;
  },
): OpenAICompatibleMessage[] {
  const result: OpenAICompatibleMessage[] = [];
  let assistantTurnIndex = 0;

  for (const message of messages) {
    const role = mapRole(message.role);
    let text = '';
    let inlineThinking = '';
    const toolCalls: OpenAICompatibleToolCall[] = [];
    const toolResults: Array<{ callId: string; content: string }> = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value;
      } else {
        const thinkingText = readThinkingText(part);
        if (thinkingText) {
          inlineThinking += thinkingText;
        }
      }

      if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          },
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push({
          callId: part.callId,
          content: serializeToolResultContent(part.content),
        });
      }
    }

    if (role === 'assistant') {
      const cachedReasoning =
        options?.assistantTurnHistory?.get(assistantTurnIndex)?.reasoningContent ?? inlineThinking;
      const shouldIncludeReasoning = options?.includeReasoningContent === true;
      assistantTurnIndex += 1;

      if (text || toolCalls.length > 0 || shouldIncludeReasoning) {
        result.push({
          role: 'assistant',
          content: text || '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          ...(shouldIncludeReasoning ? { reasoning_content: cachedReasoning } : {}),
        });
      }
    } else if (text) {
      result.push({ role, content: text });
    }

    for (const toolResult of toolResults) {
      result.push({
        role: 'tool',
        content: toolResult.content,
        tool_call_id: toolResult.callId,
      });
    }
  }

  return result;
}

export function convertMessagesToAnthropic(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options?: {
    assistantTurnHistory?: ReadonlyMap<number, AssistantTurnHistoryEntry>;
    includeThinkingBlocks?: boolean;
  },
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  let assistantTurnIndex = 0;

  for (const message of messages) {
    const role = mapRole(message.role);
    const content: AnthropicMessage['content'] = [];
    let inlineThinking = '';

    if (role === 'assistant') {
      for (const part of message.content) {
        const thinkingText = readThinkingText(part);
        if (thinkingText) {
          inlineThinking += thinkingText;
        }
      }

      if (options?.includeThinkingBlocks) {
        const cachedThinking =
          options.assistantTurnHistory?.get(assistantTurnIndex)?.anthropicThinking ?? inlineThinking;
        appendThinkingBlock(content, cachedThinking);
      }
      assistantTurnIndex += 1;
    }

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        appendTextBlock(content, part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        content.push({
          type: 'tool_use',
          id: part.callId,
          name: part.name,
          input: normalizeToolInput(part.input),
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        content.push({
          type: 'tool_result',
          tool_use_id: part.callId,
          content: serializeAnthropicToolResultContent(part.content),
          is_error: readIsError(part),
        });
      }
    }

    if (content.length > 0) {
      result.push({ role, content });
    }
  }

  return result;
}

export function convertToolsToOpenAI(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): OpenAICompatibleTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown> | undefined,
    },
  }));
}

export function convertToolsToAnthropic(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Record<string, unknown> | undefined,
  }));
}

export function countRequestChars(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): number {
  let total = 0;

  for (const message of messages) {
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += part.value.length;
      }
    }
  }

  return total;
}

export function getMessageText(
  text: string | vscode.LanguageModelChatRequestMessage,
): string {
  if (typeof text === 'string') {
    return text;
  }

  let result = '';
  for (const part of text.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      result += part.value;
    }
  }
  return result;
}

export function countOpenAIRequestChars(messages: readonly OpenAICompatibleMessage[]): number {
  let total = 0;

  for (const message of messages) {
    total += message.content?.length ?? 0;
    total += message.reasoning_content?.length ?? 0;
    total += message.tool_call_id?.length ?? 0;

    for (const toolCall of message.tool_calls ?? []) {
      total += toolCall.id.length;
      total += toolCall.function.name.length;
      total += toolCall.function.arguments.length;
    }
  }

  return total;
}

export function countAnthropicRequestChars(messages: readonly AnthropicMessage[]): number {
  let total = 0;

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') {
        total += block.text.length;
      } else if (block.type === 'thinking') {
        total += block.thinking.length;
      } else if (block.type === 'tool_use') {
        total += block.id.length;
        total += block.name.length;
        total += JSON.stringify(block.input).length;
      } else if (typeof block.content === 'string') {
        total += block.content.length;
      } else {
        for (const textBlock of block.content) {
          total += textBlock.text.length;
        }
      }
    }
  }

  return total;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' {
  if (role === vscode.LanguageModelChatMessageRole.Assistant) {
    return 'assistant';
  }

  return 'user';
}

function appendTextBlock(content: AnthropicMessage['content'], value: string): void {
  if (!value) {
    return;
  }

  const last = content.at(-1);
  if (last && last.type === 'text') {
    last.text += value;
    return;
  }

  content.push({ type: 'text', text: value });
}

function appendThinkingBlock(content: AnthropicMessage['content'], value: string | undefined): void {
  if (!value) {
    return;
  }

  content.push({
    type: 'thinking',
    thinking: value,
  } satisfies AnthropicThinkingBlock);
}

function serializeToolResultContent(parts: readonly unknown[]): string {
  const text = extractText(parts);
  return text || JSON.stringify(parts);
}

function serializeAnthropicToolResultContent(
  parts: readonly unknown[],
): string | AnthropicTextBlock[] {
  const text = extractText(parts);
  if (text) {
    return [{ type: 'text', text }];
  }

  return JSON.stringify(parts);
}

function extractText(parts: readonly unknown[]): string {
  let text = '';

  for (const part of parts) {
    if (part instanceof vscode.LanguageModelTextPart) {
      text += part.value;
    }
  }

  return text;
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function readIsError(part: vscode.LanguageModelToolResultPart): boolean | undefined {
  const candidate = part as vscode.LanguageModelToolResultPart & { isError?: boolean };
  return candidate.isError;
}

function readThinkingText(part: unknown): string | undefined {
  if (!part || typeof part !== 'object') {
    return undefined;
  }

  const candidate = part as { thinking?: unknown };
  return typeof candidate.thinking === 'string' ? candidate.thinking : undefined;
}
