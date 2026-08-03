import type {
  AttachmentRecord,
  Awaitable,
  PromptRecord,
  ToolExecution,
} from "./types.js";

export interface AiRunEvent {
  runId: string;
  agent: string;
  provider: string;
  model: string;
  prompt?: string | undefined;
  conversationId?: string | undefined;
  attachmentCount?: number;
  attachments?: readonly AttachmentRecord[];
}

export interface AiRunCompletedEvent extends AiRunEvent {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  steps: number;
}

export interface AiRunFailedEvent extends AiRunEvent {
  durationMs: number;
  error: {
    name: string;
    message: string;
    code: string;
  };
}

export interface AiToolEvent extends AiRunEvent {
  step: number;
  tool: string;
  callId: string;
}

export interface AiToolCompletedEvent extends AiToolEvent {
  execution: ToolExecution;
}

export interface AiConversationEvent extends AiRunEvent {
  conversationId: string;
  messageCount: number;
}

export interface AiConversationFailedEvent extends AiRunEvent {
  conversationId: string;
  operation: "load" | "append";
  error: { name: string; message: string; code: string };
}

export interface AiEvents {
  "ai:run_started": AiRunEvent;
  "ai:run_completed": AiRunCompletedEvent;
  "ai:run_failed": AiRunFailedEvent;
  "ai:tool_started": AiToolEvent;
  "ai:tool_completed": AiToolCompletedEvent;
  "ai:tool_failed": AiToolCompletedEvent;
  "ai:conversation_loaded": AiConversationEvent;
  "ai:conversation_persisted": AiConversationEvent;
  "ai:conversation_failed": AiConversationFailedEvent;
}

export interface AiEventDispatcher {
  emit<TKey extends keyof AiEvents>(
    event: TKey,
    payload: AiEvents[TKey],
  ): Awaitable<void>;
}

export function eventPrompt(
  record: PromptRecord,
  includeContent: boolean,
): string | undefined {
  return includeContent ? record.prompt : undefined;
}
