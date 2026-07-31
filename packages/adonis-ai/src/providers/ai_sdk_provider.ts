import {
  generateText,
  jsonSchema,
  Output,
  streamText,
  tool,
  type FinishReason as AiSdkFinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { normalizeProviderError } from "../errors.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderStepResponse,
  ProviderStreamEvent,
  ProviderTool,
} from "../provider.js";
import type {
  FinishReason,
  InternalMessage,
  TokenUsage,
  ToolCall,
} from "../types.js";

type AiSdkCallProviderOptions = NonNullable<
  Parameters<typeof generateText>[0]["providerOptions"]
>;

export interface AiSdkProviderOptions {
  name: string;
  providerOptionsKey: string;
  model: (modelId: string) => LanguageModel;
  maxRetries?: number;
  defaultProviderOptions?: Record<string, unknown>;
}

interface AiSdkResult {
  response: {
    id: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  text: string;
  finishReason: AiSdkFinishReason;
  usage: LanguageModelUsage;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  output?: unknown;
}

export class AiSdkProvider implements ProviderAdapter {
  readonly capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
  };

  readonly name: string;
  #providerOptionsKey: string;
  #model: (modelId: string) => LanguageModel;
  #maxRetries: number;
  #defaultProviderOptions: Record<string, unknown>;

  constructor(options: AiSdkProviderOptions) {
    this.name = options.name;
    this.#providerOptionsKey = options.providerOptionsKey;
    this.#model = options.model;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#defaultProviderOptions = options.defaultProviderOptions ?? {};
  }

  async complete(request: ProviderRequest): Promise<ProviderStepResponse> {
    try {
      const result = await generateText(this.#settings(request));
      return normalizeResult(
        {
          response: result.response,
          text: result.text,
          finishReason: result.finishReason,
          usage: result.usage,
          toolCalls: result.toolCalls,
          output: request.outputSchema ? result.output : undefined,
        },
        request,
        result.response.body,
      );
    } catch (error) {
      throw normalizeProviderError(error, this.name);
    }
  }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    try {
      const result = streamText({
        ...this.#settings(request),
        includeRawChunks: request.includeRaw,
      });
      const raw: unknown[] = [];

      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          yield { type: "text.delta", delta: part.text };
        } else if (part.type === "raw") {
          raw.push(part.rawValue);
        } else if (part.type === "error") {
          throw part.error;
        } else if (part.type === "abort") {
          throw new DOMException(
            part.reason ?? "The request was aborted",
            "AbortError",
          );
        }
      }

      const [response, text, finishReason, usage, toolCalls, output] =
        await Promise.all([
          result.response,
          result.text,
          result.finishReason,
          result.usage,
          result.toolCalls,
          request.outputSchema ? result.output : Promise.resolve(undefined),
        ]);

      yield {
        type: "step.completed",
        response: normalizeResult(
          { response, text, finishReason, usage, toolCalls, output },
          request,
          request.includeRaw ? raw : undefined,
        ),
      };
    } catch (error) {
      throw normalizeProviderError(error, this.name);
    }
  }

  #settings(request: ProviderRequest) {
    const tools = toAiSdkTools(request.tools);
    const providerOptions = this.#providerOptions(request.providerOptions);

    return {
      model: this.#model(request.model),
      messages: toModelMessages(request.messages),
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: this.#maxRetries,
      abortSignal: request.signal,
      timeout: request.timeout,
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
      ...(request.outputSchema
        ? {
            output: Output.object({
              schema: jsonSchema(
                request.outputSchema as Parameters<typeof jsonSchema>[0],
              ),
            }),
          }
        : {}),
      ...(providerOptions ? { providerOptions } : {}),
    };
  }

  #providerOptions(
    requestOptions: Record<string, unknown> | undefined,
  ): AiSdkCallProviderOptions | undefined {
    const options = {
      ...this.#defaultProviderOptions,
      ...(requestOptions ?? {}),
    };
    if (Object.keys(options).length === 0) return undefined;
    return {
      [this.#providerOptionsKey]: options,
    } as AiSdkCallProviderOptions;
  }
}

function toAiSdkTools(providerTools: ProviderTool[]): ToolSet {
  return Object.fromEntries(
    providerTools.map((providerTool) => [
      providerTool.name,
      tool({
        description: providerTool.description,
        inputSchema: jsonSchema(
          providerTool.inputSchema as Parameters<typeof jsonSchema>[0],
        ),
      }),
    ]),
  );
}

function toModelMessages(messages: InternalMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: message.content };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: message.isError
              ? { type: "error-text", value: message.content }
              : { type: "text", value: message.content },
          },
        ],
      };
    }
    if (!message.toolCalls?.length) {
      return { role: "assistant", content: message.content };
    }
    return {
      role: "assistant",
      content: [
        ...(message.content
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...message.toolCalls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.arguments,
        })),
      ],
    };
  });
}

function normalizeResult(
  result: AiSdkResult,
  request: ProviderRequest,
  raw: unknown,
): ProviderStepResponse {
  const normalized: ProviderStepResponse = {
    id: result.response.id,
    text:
      request.outputSchema && result.output !== undefined
        ? JSON.stringify(result.output)
        : result.text,
    finishReason: normalizeFinishReason(result.finishReason),
    usage: normalizeUsage(result.usage),
    toolCalls: result.toolCalls.map<ToolCall>((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: call.input,
    })),
  };
  const requestId = findRequestId(result.response.headers);
  if (requestId) normalized.requestId = requestId;
  if (request.includeRaw && raw !== undefined) normalized.raw = raw;
  return normalized;
}

function normalizeUsage(usage: LanguageModelUsage): TokenUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const normalized: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
  const cached = usage.inputTokenDetails.cacheReadTokens;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens;
  const reasoning = usage.outputTokenDetails.reasoningTokens;
  if (cached !== undefined && cached > 0) normalized.cachedInputTokens = cached;
  if (cacheWrite !== undefined && cacheWrite > 0) {
    normalized.cacheWriteInputTokens = cacheWrite;
  }
  if (reasoning !== undefined && reasoning > 0) {
    normalized.reasoningTokens = reasoning;
  }
  return normalized;
}

function normalizeFinishReason(reason: AiSdkFinishReason): FinishReason {
  if (reason === "tool-calls") return "tool_calls";
  if (reason === "content-filter") return "refusal";
  if (reason === "other") return "unknown";
  return reason;
}

function findRequestId(headers: Record<string, string> | undefined) {
  if (!headers) return undefined;
  return (
    headers["x-request-id"] ??
    headers["request-id"] ??
    headers["anthropic-request-id"]
  );
}
