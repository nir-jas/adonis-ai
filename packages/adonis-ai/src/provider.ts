import type { JSONSchema } from "zod/v4/core";
import type {
  FinishReason,
  InternalMessage,
  TokenUsage,
  ToolCall,
  ToolErrorMode,
} from "./types.js";

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: JSONSchema.BaseSchema;
}

export interface ProviderRequest {
  runId: string;
  agent: string;
  model: string;
  instructions: string;
  messages: InternalMessage[];
  tools: ProviderTool[];
  outputSchema?: JSONSchema.BaseSchema;
  maxOutputTokens: number;
  temperature?: number;
  timeout: number;
  signal: AbortSignal;
  toolErrorMode: ToolErrorMode;
  providerOptions?: Record<string, unknown>;
  includeRaw: boolean;
}

export interface ProviderStepResponse {
  id: string;
  requestId?: string;
  text: string;
  finishReason: FinishReason;
  usage: TokenUsage;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export type ProviderStreamEvent =
  | { type: "text.delta"; delta: string }
  | { type: "step.completed"; response: ProviderStepResponse };

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
  attachments?: ProviderAttachmentCapabilities;
}

export interface ProviderAttachmentCapabilities {
  images?: readonly string[];
  documents?: readonly string[];
}

export interface ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  complete(request: ProviderRequest): Promise<ProviderStepResponse>;
  stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
}

export interface ProviderFactoryContext {
  name: string;
}

export type ProviderFactory<TConfig = Record<string, unknown>> = (
  config: TConfig,
  context: ProviderFactoryContext,
) => ProviderAdapter;
