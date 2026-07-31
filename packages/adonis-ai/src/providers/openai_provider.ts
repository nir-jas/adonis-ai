import OpenAI from "openai";
import { ConfigurationError, normalizeProviderError } from "../errors.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderStepResponse,
  ProviderStreamEvent,
} from "../provider.js";
import type { InternalMessage, TokenUsage, ToolCall } from "../types.js";

interface OpenAiConfig {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  store?: boolean;
  organization?: string;
  project?: string;
  fetch?: typeof fetch;
}

export class OpenAiProvider implements ProviderAdapter {
  readonly capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
  };

  readonly name: string;
  #client: OpenAI;
  #store: boolean;

  constructor(config: OpenAiConfig, name = "openai") {
    if (!config.apiKey) {
      throw new ConfigurationError(
        `Provider "${name}" is missing an API key. Set OPENAI_API_KEY or config.providers.${name}.apiKey.`,
      );
    }
    this.name = name;
    this.#store = config.store ?? false;
    this.#client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 2,
      timeout: config.timeout ?? 60_000,
      organization: config.organization,
      project: config.project,
      fetch: config.fetch,
    });
  }

  async complete(request: ProviderRequest): Promise<ProviderStepResponse> {
    try {
      const response = (await this.#client.responses.create(
        this.#body(request),
        {
          signal: request.signal,
          timeout: request.timeout,
        },
      )) as OpenAI.Responses.Response;
      return this.#normalize(response, request.includeRaw);
    } catch (error) {
      throw normalizeProviderError(error, this.name);
    }
  }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    try {
      const stream = await this.#client.responses.create(
        { ...this.#body(request), stream: true },
        { signal: request.signal, timeout: request.timeout },
      );
      let completed: OpenAI.Responses.Response | undefined;

      for await (const rawEvent of stream) {
        const event = rawEvent as unknown as {
          type: string;
          delta?: string;
          response?: OpenAI.Responses.Response;
          error?: { message?: string };
        };
        if (event.type === "response.output_text.delta" && event.delta) {
          yield { type: "text.delta", delta: event.delta };
        } else if (event.type === "response.completed" && event.response) {
          completed = event.response;
        } else if (event.type === "response.failed") {
          throw new Error(event.error?.message ?? "OpenAI response failed");
        }
      }

      if (!completed)
        throw new Error("OpenAI stream ended without response.completed");
      yield {
        type: "step.completed",
        response: this.#normalize(completed, request.includeRaw),
      };
    } catch (error) {
      throw normalizeProviderError(error, this.name);
    }
  }

  #body(
    request: ProviderRequest,
  ): OpenAI.Responses.ResponseCreateParamsNonStreaming {
    const body: Record<string, unknown> = {
      ...(request.providerOptions ?? {}),
      model: request.model,
      instructions: request.instructions || undefined,
      input: toOpenAiInput(request.messages),
      max_output_tokens: request.maxOutputTokens,
      store: this.#store,
    };

    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        strict: true,
      }));
    }
    if (request.outputSchema) {
      body.text = {
        format: {
          type: "json_schema",
          name: "agent_output",
          strict: true,
          schema: request.outputSchema,
        },
      };
    }

    return body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
  }

  #normalize(
    response: OpenAI.Responses.Response,
    includeRaw: boolean,
  ): ProviderStepResponse {
    const raw = response as unknown as {
      _request_id?: string;
      output?: Array<Record<string, unknown>>;
      output_text?: string;
      status?: string;
      incomplete_details?: { reason?: string };
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
        output_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const toolCalls: ToolCall[] = [];
    const text: string[] = [];
    let refused = false;

    for (const item of raw.output ?? []) {
      if (item.type === "function_call") {
        let argumentsValue: unknown = {};
        try {
          argumentsValue =
            typeof item.arguments === "string"
              ? JSON.parse(item.arguments)
              : item.arguments;
        } catch {
          argumentsValue = item.arguments;
        }
        toolCalls.push({
          id: String(item.call_id ?? item.id ?? ""),
          name: String(item.name ?? ""),
          arguments: argumentsValue,
        });
      }
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const content of item.content as Array<Record<string, unknown>>) {
          if (
            content.type === "output_text" &&
            typeof content.text === "string"
          ) {
            text.push(content.text);
          }
          if (content.type === "refusal") {
            refused = true;
            if (typeof content.refusal === "string") text.push(content.refusal);
          }
        }
      }
    }

    const inputTokens = raw.usage?.input_tokens ?? 0;
    const outputTokens = raw.usage?.output_tokens ?? 0;
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: raw.usage?.total_tokens ?? inputTokens + outputTokens,
    };
    const cached = raw.usage?.input_tokens_details?.cached_tokens;
    const reasoning = raw.usage?.output_tokens_details?.reasoning_tokens;
    if (cached !== undefined && cached > 0) usage.cachedInputTokens = cached;
    if (reasoning !== undefined && reasoning > 0)
      usage.reasoningTokens = reasoning;

    const normalized: ProviderStepResponse = {
      id: response.id,
      text: raw.output_text ?? response.output_text ?? text.join(""),
      finishReason: refused
        ? "refusal"
        : toolCalls.length > 0
          ? "tool_calls"
          : raw.status === "incomplete"
            ? raw.incomplete_details?.reason === "max_output_tokens"
              ? "length"
              : "error"
            : "stop",
      usage,
      toolCalls,
    };
    if (raw._request_id) normalized.requestId = raw._request_id;
    if (includeRaw) normalized.raw = response;
    return normalized;
  }
}

function toOpenAiInput(
  messages: InternalMessage[],
): OpenAI.Responses.ResponseInput {
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      });
      continue;
    }

    input.push({ role: message.role, content: message.content });
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        });
      }
    }
  }

  return input as unknown as OpenAI.Responses.ResponseInput;
}
