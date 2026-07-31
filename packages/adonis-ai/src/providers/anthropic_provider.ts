import Anthropic from "@anthropic-ai/sdk";
import { ConfigurationError, normalizeProviderError } from "../errors.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderStepResponse,
  ProviderStreamEvent,
} from "../provider.js";
import type { InternalMessage, TokenUsage, ToolCall } from "../types.js";

interface AnthropicConfig {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
}

export class AnthropicProvider implements ProviderAdapter {
  readonly capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
  };

  readonly name: string;
  #client: Anthropic;

  constructor(config: AnthropicConfig, name = "anthropic") {
    if (!config.apiKey) {
      throw new ConfigurationError(
        `Provider "${name}" is missing an API key. Set ANTHROPIC_API_KEY or config.providers.${name}.apiKey.`,
      );
    }
    this.name = name;
    this.#client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 2,
      timeout: config.timeout ?? 60_000,
      defaultHeaders: config.defaultHeaders,
      fetch: config.fetch,
    });
  }

  async complete(request: ProviderRequest): Promise<ProviderStepResponse> {
    try {
      const response = await this.#client.messages.create(this.#body(request), {
        signal: request.signal,
        timeout: request.timeout,
      });
      return this.#normalize(response, request.includeRaw);
    } catch (error) {
      throw normalizeProviderError(error, this.name);
    }
  }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    try {
      const stream = this.#client.messages.stream(this.#body(request), {
        signal: request.signal,
        timeout: request.timeout,
      });

      for await (const rawEvent of stream) {
        const event = rawEvent as unknown as {
          type: string;
          delta?: { type?: string; text?: string };
        };
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          event.delta.text
        ) {
          yield { type: "text.delta", delta: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      yield {
        type: "step.completed",
        response: this.#normalize(message, request.includeRaw),
      };
    } catch (error) {
      throw normalizeProviderError(error, this.name);
    }
  }

  #body(request: ProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
    const body: Record<string, unknown> = {
      ...(request.providerOptions ?? {}),
      model: request.model,
      max_tokens: request.maxOutputTokens,
      messages: toAnthropicMessages(request.messages),
    };
    if (request.instructions) body.system = request.instructions;
    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
        strict: true,
      }));
    }
    if (request.outputSchema) {
      body.output_config = {
        format: {
          type: "json_schema",
          schema: request.outputSchema,
        },
      };
    }
    return body as unknown as Anthropic.MessageCreateParamsNonStreaming;
  }

  #normalize(
    message: Anthropic.Message,
    includeRaw: boolean,
  ): ProviderStepResponse {
    const text: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of message.content) {
      if (block.type === "text") text.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    const rawUsage = message.usage as typeof message.usage & {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const usage: TokenUsage = {
      inputTokens: rawUsage.input_tokens,
      outputTokens: rawUsage.output_tokens,
      totalTokens: rawUsage.input_tokens + rawUsage.output_tokens,
    };
    if (rawUsage.cache_creation_input_tokens) {
      usage.cacheWriteInputTokens = rawUsage.cache_creation_input_tokens;
    }
    if (rawUsage.cache_read_input_tokens) {
      usage.cachedInputTokens = rawUsage.cache_read_input_tokens;
    }

    const normalized: ProviderStepResponse = {
      id: message.id,
      text: text.join(""),
      finishReason:
        toolCalls.length > 0
          ? "tool_calls"
          : message.stop_reason === "max_tokens"
            ? "length"
            : message.stop_reason === "refusal"
              ? "refusal"
              : message.stop_reason === "end_turn" ||
                  message.stop_reason === "stop_sequence"
                ? "stop"
                : "unknown",
      usage,
      toolCalls,
    };
    const requestId = (message as unknown as { _request_id?: string })
      ._request_id;
    if (requestId) normalized.requestId = requestId;
    if (includeRaw) normalized.raw = message;
    return normalized;
  }
}

function toAnthropicMessages(
  messages: InternalMessage[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;

    if (message.role === "tool") {
      const blocks: Anthropic.ToolResultBlockParam[] = [];
      let cursor = index;
      while (cursor < messages.length) {
        const candidate = messages[cursor]!;
        if (candidate.role !== "tool") break;
        const block: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: candidate.toolCallId,
          content: candidate.content,
        };
        if (candidate.isError !== undefined) block.is_error = candidate.isError;
        blocks.push(block);
        cursor++;
      }
      result.push({ role: "user", content: blocks });
      index = cursor - 1;
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content)
        content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
}
