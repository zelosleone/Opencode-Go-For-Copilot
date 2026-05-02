export interface AssistantTurnHistoryEntry {
  reasoningContent?: string;
  anthropicThinking?: string;
  timestamp: number;
}

export interface AssistantTurnHistoryState {
  modelId?: string;
  nextAssistantTurnIndex: number;
  entries: Array<[number, AssistantTurnHistoryEntry]>;
}

export const ASSISTANT_TURN_HISTORY_STORAGE_KEY = 'opencodeGo.assistantTurnHistory';
