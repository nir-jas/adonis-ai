import type { z } from "zod";

export type Awaitable<T> = T | Promise<T>;
export type OutputSchema = z.ZodType;

export interface TextContentPart {
  type: "text";
  text: string;
}

export type FileSource =
  | { type: "bytes"; data: Uint8Array }
  | { type: "base64"; data: string }
  | { type: "url"; url: string };

export interface FileContentPart {
  type: "file";
  source: FileSource;
  mediaType: string;
  filename?: string;
}

export type UserContent =
  string | readonly (TextContentPart | FileContentPart)[];

export type InferAgentOutput<TSchema extends OutputSchema | undefined> =
  TSchema extends OutputSchema ? z.output<TSchema> : undefined;

export interface UserMessage {
  role: "user";
  content: UserContent;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolMessage;
export type InternalMessage = Message;

export interface ConversationRunContext {
  runId: string;
  signal: AbortSignal;
}

export interface ConversationTurn {
  runId: string;
  messages: readonly Message[];
}

export interface ConversationStore {
  load(
    id: string,
    context: ConversationRunContext,
  ): Awaitable<readonly Message[]>;
  append(
    id: string,
    turn: ConversationTurn,
    context: ConversationRunContext,
  ): Awaitable<void>;
}

export interface ConversationOptions {
  id: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
}

export type FinishReason =
  "stop" | "tool_calls" | "length" | "refusal" | "error" | "unknown";

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolExecution {
  call: ToolCall;
  output: string;
  isError: boolean;
  durationMs: number;
}

export interface AgentStep {
  id: string;
  index: number;
  text: string;
  finishReason: FinishReason;
  usage: TokenUsage;
  toolCalls: ToolCall[];
  toolExecutions: ToolExecution[];
}

export interface AgentResponse<TOutput = undefined> {
  id: string;
  text: string;
  data: TOutput;
  provider: string;
  model: string;
  finishReason: FinishReason;
  usage: TokenUsage;
  steps: AgentStep[];
  toolCalls: ToolCall[];
  requestIds: string[];
  raw?: unknown[];
}

export type ToolErrorMode = "report" | "throw";

export interface RunOptions {
  provider?: string;
  model?: string;
  messages?: Message[];
  maxSteps?: number;
  maxOutputTokens?: number;
  temperature?: number;
  timeout?: number;
  signal?: AbortSignal;
  toolErrorMode?: ToolErrorMode;
  includeRaw?: boolean;
  providerOptions?: Record<string, unknown>;
  conversation?: ConversationOptions;
}

export interface AttachmentRecord {
  mediaType: string;
  filename?: string;
  source: FileSource["type"];
}

export interface PromptRecord {
  agent: string;
  prompt: string;
  input?: UserContent;
  messages?: readonly Message[];
  conversationId?: string;
  attachments?: readonly AttachmentRecord[];
  provider: string;
  model: string;
  options: RunOptions;
  createdAt: Date;
}

export interface RunStartedEvent {
  type: "run.started";
  runId: string;
  agent: string;
  provider: string;
  model: string;
}

export interface TextDeltaEvent {
  type: "text.delta";
  runId: string;
  step: number;
  delta: string;
}

export interface ToolStartedEvent {
  type: "tool.started";
  runId: string;
  step: number;
  call: ToolCall;
}

export interface ToolCompletedEvent {
  type: "tool.completed";
  runId: string;
  step: number;
  execution: ToolExecution;
}

export interface StepCompletedEvent {
  type: "step.completed";
  runId: string;
  step: AgentStep;
}

export interface RunCompletedEvent<TOutput = unknown> {
  type: "run.completed";
  runId: string;
  response: AgentResponse<TOutput>;
}

export interface RunFailedEvent {
  type: "run.failed";
  runId: string;
  error: {
    name: string;
    message: string;
    code: string;
  };
}

export type AgentStreamEvent<TOutput = unknown> =
  | RunStartedEvent
  | TextDeltaEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | StepCompletedEvent
  | RunCompletedEvent<TOutput>
  | RunFailedEvent;

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };

  const cached = (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0);
  const cacheWrite =
    (left.cacheWriteInputTokens ?? 0) + (right.cacheWriteInputTokens ?? 0);
  const reasoning = (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0);

  if (cached > 0) usage.cachedInputTokens = cached;
  if (cacheWrite > 0) usage.cacheWriteInputTokens = cacheWrite;
  if (reasoning > 0) usage.reasoningTokens = reasoning;

  return usage;
}
