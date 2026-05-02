import type { CancellationToken } from 'vscode';
import { logger } from './logger.js';
import type {
  AnthropicMessage,
  AnthropicTool,
  OpenAICompatibleMessage,
  OpenAICompatibleTool,
  OpenAICompatibleToolCall,
  StreamCallbacks,
  UsageInfo,
} from './protocolTypes.js';

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
}

interface AnthropicPendingToolUse {
  id: string;
  name: string;
  inputJson: string;
}

export class OpenCodeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async streamOpenAIChat(
    request: {
      model: string;
      messages: OpenAICompatibleMessage[];
      tools?: OpenAICompatibleTool[];
      tool_choice?: 'auto' | 'required' | 'none';
      extraBody?: Record<string, unknown>;
    },
    callbacks: StreamCallbacks,
    cancellationToken?: CancellationToken,
  ): Promise<void> {
    const controller = new AbortController();
    const cancelListener = cancellationToken?.onCancellationRequested(() => controller.abort());
    let done = false;

    try {
      const { extraBody, ...baseRequest } = request;
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          ...baseRequest,
          ...extraBody,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await extractErrorMessage(response));
      }
      if (!response.body) {
        throw new Error('Opencode Go returned no response body.');
      }

      const pendingToolCalls = new Map<number, OpenAICompatibleToolCall>();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (cancellationToken?.isCancellationRequested) {
          controller.abort();
          break;
        }

        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const stop = processOpenAILine(line, pendingToolCalls, callbacks);
          if (stop) {
            done = true;
            break;
          }
        }

        if (done) {
          break;
        }
      }

      if (!done) {
        buffer += decoder.decode();
        if (buffer) {
          for (const line of buffer.split(/\r?\n/)) {
            const stop = processOpenAILine(line, pendingToolCalls, callbacks);
            if (stop) {
              done = true;
              break;
            }
          }
        }
      }

      if (!done) {
        flushOpenAIToolCalls(pendingToolCalls, callbacks);
        callbacks.onDone();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        callbacks.onDone();
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      cancelListener?.dispose();
    }
  }

  async streamAnthropicMessage(
    request: {
      model: string;
      messages: AnthropicMessage[];
      max_tokens: number;
      tools?: AnthropicTool[];
      tool_choice?: { type: 'auto' | 'any' };
      extraBody?: Record<string, unknown>;
    },
    callbacks: StreamCallbacks,
    cancellationToken?: CancellationToken,
  ): Promise<void> {
    const controller = new AbortController();
    const cancelListener = cancellationToken?.onCancellationRequested(() => controller.abort());
    let done = false;

    try {
      const { extraBody, ...baseRequest } = request;
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          ...baseRequest,
          ...extraBody,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await extractErrorMessage(response));
      }
      if (!response.body) {
        throw new Error('Opencode Go returned no response body.');
      }

      const pendingToolUses = new Map<number, AnthropicPendingToolUse>();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (cancellationToken?.isCancellationRequested) {
          controller.abort();
          break;
        }

        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });

        while (true) {
          const boundary = buffer.search(/\r?\n\r?\n/);
          if (boundary === -1) {
            break;
          }

          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
          const stop = processAnthropicEvent(rawEvent, pendingToolUses, callbacks);
          if (stop) {
            done = true;
            break;
          }
        }

        if (done) {
          break;
        }
      }

      if (!done && buffer.trim()) {
        processAnthropicEvent(buffer, pendingToolUses, callbacks);
      }

      if (!done) {
        flushAnthropicToolUses(pendingToolUses, callbacks);
        callbacks.onDone();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        callbacks.onDone();
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      cancelListener?.dispose();
    }
  }
}

function processOpenAILine(
  line: string,
  pendingToolCalls: Map<number, OpenAICompatibleToolCall>,
  callbacks: StreamCallbacks,
): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) {
    return false;
  }

  if (trimmed === 'data: [DONE]') {
    flushOpenAIToolCalls(pendingToolCalls, callbacks);
    callbacks.onDone();
    return true;
  }

  if (!trimmed.startsWith('data: ')) {
    return false;
  }

  const json = trimmed.slice(6);
  let chunk: OpenAIStreamChunk;
  try {
    chunk = JSON.parse(json) as OpenAIStreamChunk;
  } catch (error) {
    logger.warn('Failed to parse OpenAI-compatible SSE payload.', json.slice(0, 200), error);
    return false;
  }

  const usage = mapOpenAIUsage(chunk.usage);
  if (usage) {
    callbacks.onUsage?.(usage);
  }

  const choice = chunk.choices?.[0];
  if (!choice?.delta) {
    return false;
  }

  if (choice.delta.reasoning_content) {
    callbacks.onThinking?.(choice.delta.reasoning_content);
  }

  if (choice.delta.content) {
    callbacks.onText(choice.delta.content);
  }

  if (choice.delta.tool_calls) {
    for (const toolCall of choice.delta.tool_calls) {
      let pending = pendingToolCalls.get(toolCall.index);
      if (!pending && toolCall.id) {
        pending = {
          id: toolCall.id,
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        };
        pendingToolCalls.set(toolCall.index, pending);
      }

      if (pending) {
        if (toolCall.function?.name) {
          pending.function.name += toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          pending.function.arguments += toolCall.function.arguments;
        }
      }
    }
  }

  if (choice.finish_reason === 'tool_calls') {
    flushOpenAIToolCalls(pendingToolCalls, callbacks);
  }

  return false;
}

function flushOpenAIToolCalls(
  pendingToolCalls: Map<number, OpenAICompatibleToolCall>,
  callbacks: StreamCallbacks,
): void {
  for (const toolCall of pendingToolCalls.values()) {
    callbacks.onToolCall({
      id: toolCall.id,
      name: toolCall.function.name,
      input: safeJsonParse(toolCall.function.arguments),
    });
  }
  pendingToolCalls.clear();
}

function processAnthropicEvent(
  rawEvent: string,
  pendingToolUses: Map<number, AnthropicPendingToolUse>,
  callbacks: StreamCallbacks,
): boolean {
  const lines = rawEvent.split(/\r?\n/);
  let eventType = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return false;
  }

  const payloadText = dataLines.join('\n');
  let payload: AnthropicStreamEvent;
  try {
    payload = JSON.parse(payloadText) as AnthropicStreamEvent;
  } catch (error) {
    logger.warn('Failed to parse Anthropic-compatible SSE payload.', payloadText.slice(0, 200), error);
    return false;
  }

  const usage = mapAnthropicUsage(payload.usage ?? payload.message?.usage);
  if (usage) {
    callbacks.onUsage?.(usage);
  }

  const type = eventType || payload.type || '';
  switch (type) {
    case 'content_block_start': {
      if (payload.content_block?.type === 'tool_use' && typeof payload.index === 'number') {
        pendingToolUses.set(payload.index, {
          id: payload.content_block.id || crypto.randomUUID(),
          name: payload.content_block.name || 'tool',
          inputJson: payload.content_block.input ? JSON.stringify(payload.content_block.input) : '',
        });
      }
      return false;
    }
    case 'content_block_delta': {
      if (payload.delta?.type === 'text_delta' && payload.delta.text) {
        callbacks.onText(payload.delta.text);
      }
      if (payload.delta?.type === 'thinking_delta' && payload.delta.thinking) {
        callbacks.onThinking?.(payload.delta.thinking);
      }
      if (
        payload.delta?.type === 'input_json_delta' &&
        typeof payload.index === 'number' &&
        payload.delta.partial_json
      ) {
        const pending = pendingToolUses.get(payload.index);
        if (pending) {
          pending.inputJson += payload.delta.partial_json;
        }
      }
      return false;
    }
    case 'content_block_stop': {
      if (typeof payload.index === 'number') {
        const pending = pendingToolUses.get(payload.index);
        if (pending) {
          callbacks.onToolCall({
            id: pending.id,
            name: pending.name,
            input: safeJsonParse(pending.inputJson),
          });
          pendingToolUses.delete(payload.index);
        }
      }
      return false;
    }
    case 'message_stop': {
      flushAnthropicToolUses(pendingToolUses, callbacks);
      callbacks.onDone();
      return true;
    }
    default:
      return false;
  }
}

function flushAnthropicToolUses(
  pendingToolUses: Map<number, AnthropicPendingToolUse>,
  callbacks: StreamCallbacks,
): void {
  for (const pending of pendingToolUses.values()) {
    callbacks.onToolCall({
      id: pending.id,
      name: pending.name,
      input: safeJsonParse(pending.inputJson),
    });
  }
  pendingToolUses.clear();
}

async function extractErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || `HTTP ${response.status}`;
  } catch {
    return body || `HTTP ${response.status}`;
  }
}

function safeJsonParse(value: string): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    logger.warn('Failed to parse tool input JSON.', value.slice(0, 200));
  }

  return {};
}

function mapOpenAIUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
      }
    | undefined,
): UsageInfo | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens: usage.prompt_cache_hit_tokens,
    cacheWriteTokens: usage.prompt_cache_miss_tokens,
  };
}

function mapAnthropicUsage(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined,
): UsageInfo | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
  };
}
