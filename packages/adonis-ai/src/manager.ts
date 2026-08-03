import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentLike } from "./agent.js";
import { defineConfig } from "./config.js";
import type { AiConfig, AiConfigInput, ProviderConfig } from "./config.js";
import {
  AbortedRequestError,
  AiError,
  ConfigurationError,
  ConversationPersistenceError,
  InvalidRequestError,
  MaxStepsExceededError,
  StructuredOutputError,
  TimeoutError,
  ToolExecutionError,
  UnsupportedCapabilityError,
  normalizeProviderError,
} from "./errors.js";
import type { AiEventDispatcher, AiEvents } from "./events.js";
import { eventPrompt } from "./events.js";
import { AiFake, FakeProvider } from "./fake.js";
import type { FakeResponseSource } from "./fake.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderFactory,
  ProviderRequest,
  ProviderStepResponse,
} from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic_provider.js";
import { AiGatewayProvider } from "./providers/gateway_provider.js";
import { OpenAiProvider } from "./providers/openai_provider.js";
import { setAiManagerResolver } from "./runtime.js";
import type { AgentStream } from "./stream.js";
import { AgentStream as AgentStreamImplementation } from "./stream.js";
import type { Tool } from "./tool.js";
import type {
  AgentResponse,
  AgentStep,
  AgentStreamEvent,
  AttachmentRecord,
  ConversationStore,
  ConversationTurn,
  FileContentPart,
  InferAgentOutput,
  InternalMessage,
  OutputSchema,
  PromptRecord,
  RunOptions,
  TokenUsage,
  ToolCall,
  ToolExecution,
  UserContent,
} from "./types.js";
import { addUsage, emptyUsage } from "./types.js";

export interface ManagerOptions {
  events?: AiEventDispatcher;
  makeClass?: <T>(constructor: new (...args: never[]) => T) => Promise<T>;
}

type StreamEmitter<TOutput> = (event: AgentStreamEvent<TOutput>) => void;

export class AiManager {
  readonly config: AiConfig;

  #events: AiEventDispatcher | undefined;
  #makeClass?: ManagerOptions["makeClass"];
  #factories = new Map<string, ProviderFactory>();
  #providers = new Map<string, ProviderAdapter>();
  #fakeProvider: FakeProvider | undefined;
  #promptRecords: PromptRecord[] = [];
  #conversationStore: ConversationStore | undefined;

  constructor(config: AiConfigInput | AiConfig, options: ManagerOptions = {}) {
    this.config = defineConfig(config);
    this.#events = options.events;
    this.#makeClass = options.makeClass;

    this.extend("openai", (providerConfig, context) => {
      return new OpenAiProvider(providerConfig, context.name);
    });
    this.extend("anthropic", (providerConfig, context) => {
      return new AnthropicProvider(providerConfig, context.name);
    });
    this.extend("gateway", (providerConfig, context) => {
      return new AiGatewayProvider(providerConfig, context.name);
    });
  }

  asDefault(): this {
    setAiManagerResolver(async () => this);
    return this;
  }

  extend<TConfig = Record<string, unknown>>(
    driver: string,
    factory: ProviderFactory<TConfig>,
  ): this {
    this.#factories.set(driver, factory as ProviderFactory);
    this.#providers.clear();
    return this;
  }

  async make<TAgent>(
    constructor: new (...args: never[]) => TAgent,
  ): Promise<TAgent> {
    if (this.#makeClass) return this.#makeClass(constructor);
    return new constructor();
  }

  fake(source: FakeResponseSource = []): AiFake {
    const previous = this.#fakeProvider;
    const fake = new FakeProvider(source);
    this.#fakeProvider = fake;
    this.#promptRecords.splice(0);

    return new AiFake(fake, this.#promptRecords, () => {
      this.#fakeProvider = previous;
    });
  }

  prompts(): readonly PromptRecord[] {
    return this.#promptRecords;
  }

  useConversationStore(store: ConversationStore): this {
    this.#conversationStore = store;
    return this;
  }

  prompt<TSchema extends OutputSchema | undefined>(
    agent: AgentLike<TSchema>,
    input: UserContent,
    options: RunOptions = {},
  ): Promise<AgentResponse<InferAgentOutput<TSchema>>> {
    return this.execute(agent, input, options, false);
  }

  stream<TSchema extends OutputSchema | undefined>(
    agent: AgentLike<TSchema>,
    input: UserContent,
    options: RunOptions = {},
  ): AgentStream<InferAgentOutput<TSchema>> {
    return new AgentStreamImplementation(async ({ emit, signal }) => {
      return this.execute(agent, input, { ...options, signal }, true, emit);
    }, options.signal);
  }

  async execute<TSchema extends OutputSchema | undefined>(
    agent: AgentLike<TSchema>,
    input: UserContent,
    options: RunOptions,
    streaming: boolean,
    streamEmit?: StreamEmitter<InferAgentOutput<TSchema>>,
  ): Promise<AgentResponse<InferAgentOutput<TSchema>>> {
    const startedAt = Date.now();
    const runId = randomUUID();
    const providerName =
      options.provider ?? agent.defaultProvider ?? this.config.default;
    const providerConfig = this.#providerConfig(providerName);
    const model = options.model ?? agent.defaultModel ?? providerConfig.model;

    if (!model) {
      throw new ConfigurationError(
        `Provider "${providerName}" does not have a model. Set it in config/ai.ts or pass options.model.`,
      );
    }

    const provider =
      this.#fakeProvider ?? this.#provider(providerName, providerConfig);
    validateUserContent(input, provider.capabilities, providerName);
    const attachments = attachmentRecords(input);
    const conversationId = options.conversation?.id;
    if (conversationId !== undefined && !conversationId.trim()) {
      throw new InvalidRequestError("Conversation id must not be empty");
    }
    if (conversationId && !this.#conversationStore) {
      throw new ConfigurationError(
        "A conversation was requested but no ConversationStore is registered. Call ai.useConversationStore().",
      );
    }
    const record: PromptRecord = {
      agent: agent.name,
      prompt: textContent(input),
      input,
      messages: [],
      ...(conversationId ? { conversationId } : {}),
      attachments,
      provider: providerName,
      model,
      options,
      createdAt: new Date(),
    };
    this.#promptRecords.push(record);
    this.#fakeProvider?.setRecord(record);

    const timeout =
      options.timeout ?? providerConfig.timeout ?? this.config.timeout;
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () =>
        timeoutController.abort(
          new TimeoutError(`AI request timed out after ${timeout}ms`),
        ),
      timeout,
    );
    timer.unref();

    const signals = [timeoutController.signal];
    if (options.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);

    const eventBase = {
      runId,
      agent: agent.name,
      provider: providerName,
      model,
      ...(conversationId ? { conversationId } : {}),
      attachmentCount: attachments.length,
      attachments,
    };
    const visiblePrompt = eventPrompt(
      record,
      this.config.includeContentInEvents,
    );
    const observableEvent =
      visiblePrompt === undefined
        ? eventBase
        : { ...eventBase, prompt: visiblePrompt };

    try {
      await this.#dispatch("ai:run_started", observableEvent);
      streamEmit?.({
        type: "run.started",
        runId,
        agent: agent.name,
        provider: providerName,
        model,
      });

      const instructions = await agent.instructions();
      const tools = await agent.tools();
      const conversationContext = { runId, signal };
      let conversationMessages: readonly InternalMessage[] = [];
      if (conversationId) {
        try {
          conversationMessages = await this.#conversationStore!.load(
            conversationId,
            conversationContext,
          );
        } catch (error) {
          const normalized = new ConversationPersistenceError(
            `Failed to load conversation "${conversationId}"`,
            "load",
            error,
          );
          await this.#dispatch("ai:conversation_failed", {
            ...eventBase,
            conversationId,
            operation: "load",
            error: eventError(normalized),
          });
          throw normalized;
        }
        await this.#dispatch("ai:conversation_loaded", {
          ...eventBase,
          conversationId,
          messageCount: conversationMessages.length,
        });
      }
      const userMessage: InternalMessage = { role: "user", content: input };
      const messages: InternalMessage[] = [
        ...(await agent.messages()),
        ...conversationMessages,
        ...(options.messages ?? []),
        userMessage,
      ];
      for (const message of messages) {
        if (message.role === "user") {
          validateUserContent(
            message.content,
            provider.capabilities,
            providerName,
          );
        }
      }
      record.messages = [...messages];
      const turnMessages: InternalMessage[] = [userMessage];
      const providerTools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }),
      }));
      const outputSchema = agent.outputSchema
        ? z.toJSONSchema(agent.outputSchema, { target: "draft-7" })
        : undefined;

      const steps: AgentStep[] = [];
      const raw: unknown[] = [];
      const requestIds: string[] = [];
      let usage = emptyUsage();
      const maxSteps = options.maxSteps ?? this.config.maxSteps;

      for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
        if (signal.aborted) throw signal.reason ?? new AbortedRequestError();

        const request: ProviderRequest = {
          runId,
          agent: agent.name,
          model,
          instructions,
          messages,
          tools: providerTools,
          maxOutputTokens:
            options.maxOutputTokens ?? this.config.maxOutputTokens,
          timeout,
          signal,
          toolErrorMode: options.toolErrorMode ?? "report",
          includeRaw: options.includeRaw ?? this.config.includeRaw,
        };
        if (outputSchema !== undefined) request.outputSchema = outputSchema;
        if (options.temperature !== undefined)
          request.temperature = options.temperature;
        if (options.providerOptions !== undefined) {
          request.providerOptions = options.providerOptions;
        }

        const providerResponse = streaming
          ? await this.#streamStep(
              provider,
              request,
              stepIndex,
              runId,
              streamEmit,
            )
          : await provider.complete(request);

        if (providerResponse.requestId)
          requestIds.push(providerResponse.requestId);
        if (providerResponse.raw !== undefined && request.includeRaw)
          raw.push(providerResponse.raw);
        usage = addUsage(usage, providerResponse.usage);

        const executions: ToolExecution[] = [];
        const step: AgentStep = {
          id: providerResponse.id,
          index: stepIndex,
          text: providerResponse.text,
          finishReason: providerResponse.finishReason,
          usage: providerResponse.usage,
          toolCalls: providerResponse.toolCalls,
          toolExecutions: executions,
        };

        if (providerResponse.toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: providerResponse.text,
            toolCalls: providerResponse.toolCalls,
          });
          turnMessages.push({
            role: "assistant",
            content: providerResponse.text,
            toolCalls: providerResponse.toolCalls,
          });

          for (const call of providerResponse.toolCalls) {
            streamEmit?.({
              type: "tool.started",
              runId,
              step: stepIndex,
              call,
            });
            await this.#dispatch("ai:tool_started", {
              ...observableEvent,
              step: stepIndex,
              tool: call.name,
              callId: call.id,
            });

            const execution = await this.#executeTool(
              tools,
              call,
              {
                runId,
                step: stepIndex,
                signal,
                provider: providerName,
                model,
              },
              options.toolErrorMode ?? "report",
            );
            executions.push(execution);
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: execution.output,
              isError: execution.isError,
            });
            turnMessages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: execution.output,
              isError: execution.isError,
            });

            streamEmit?.({
              type: "tool.completed",
              runId,
              step: stepIndex,
              execution,
            });
            await this.#dispatch(
              execution.isError ? "ai:tool_failed" : "ai:tool_completed",
              {
                ...observableEvent,
                step: stepIndex,
                tool: call.name,
                callId: call.id,
                execution,
              },
            );
          }

          steps.push(step);
          streamEmit?.({ type: "step.completed", runId, step });
          continue;
        }

        steps.push(step);
        streamEmit?.({ type: "step.completed", runId, step });

        const data = this.#parseOutput(
          agent.outputSchema,
          providerResponse.text,
          providerName,
          providerResponse.finishReason,
        ) as InferAgentOutput<TSchema>;
        const response: AgentResponse<InferAgentOutput<TSchema>> = {
          id: runId,
          text: providerResponse.text,
          data,
          provider: providerName,
          model,
          finishReason: providerResponse.finishReason,
          usage,
          steps,
          toolCalls: steps.flatMap((item) => item.toolCalls),
          requestIds,
        };
        if (raw.length > 0) response.raw = raw;

        if (conversationId) {
          turnMessages.push({ role: "assistant", content: response.text });
          const turn: ConversationTurn = { runId, messages: turnMessages };
          try {
            await this.#conversationStore!.append(
              conversationId,
              turn,
              conversationContext,
            );
          } catch (error) {
            const normalized = new ConversationPersistenceError(
              `Failed to append conversation "${conversationId}"`,
              "append",
              error,
            );
            await this.#dispatch("ai:conversation_failed", {
              ...eventBase,
              conversationId,
              operation: "append",
              error: eventError(normalized),
            });
            throw normalized;
          }
          await this.#dispatch("ai:conversation_persisted", {
            ...eventBase,
            conversationId,
            messageCount: turnMessages.length,
          });
        }

        streamEmit?.({ type: "run.completed", runId, response });
        await this.#dispatch("ai:run_completed", {
          ...observableEvent,
          durationMs: Date.now() - startedAt,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          steps: steps.length,
        });
        return response;
      }

      throw new MaxStepsExceededError(maxSteps);
    } catch (error) {
      let normalized: AiError;
      if (signal.aborted && timeoutController.signal.aborted) {
        normalized =
          timeoutController.signal.reason instanceof AiError
            ? timeoutController.signal.reason
            : new TimeoutError(
                `AI request timed out after ${timeout}ms`,
                providerName,
                error,
              );
      } else if (signal.aborted) {
        normalized =
          signal.reason instanceof AiError
            ? signal.reason
            : new AbortedRequestError(undefined, providerName, error);
      } else {
        normalized = normalizeProviderError(error, providerName);
      }

      streamEmit?.({
        type: "run.failed",
        runId,
        error: {
          name: normalized.name,
          message: normalized.message,
          code: normalized.code,
        },
      });
      await this.#dispatch("ai:run_failed", {
        ...observableEvent,
        durationMs: Date.now() - startedAt,
        error: {
          name: normalized.name,
          message: normalized.message,
          code: normalized.code,
        },
      });
      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }

  #providerConfig(name: string): ProviderConfig {
    const config = this.config.providers[name];
    if (!config) {
      throw new ConfigurationError(`AI provider "${name}" is not configured`);
    }
    return config;
  }

  #provider(name: string, config: ProviderConfig): ProviderAdapter {
    const existing = this.#providers.get(name);
    if (existing) return existing;
    const factory = this.#factories.get(config.driver);
    if (!factory) {
      throw new ConfigurationError(
        `AI provider "${name}" uses unknown driver "${config.driver}". Register it with ai.extend().`,
      );
    }
    const provider = factory(
      {
        timeout: this.config.timeout,
        maxRetries: this.config.maxRetries,
        ...config,
      },
      { name },
    );
    this.#providers.set(name, provider);
    return provider;
  }

  async #streamStep<TOutput>(
    provider: ProviderAdapter,
    request: ProviderRequest,
    step: number,
    runId: string,
    emit?: StreamEmitter<TOutput>,
  ): Promise<ProviderStepResponse> {
    let response: ProviderStepResponse | undefined;
    for await (const event of provider.stream(request)) {
      if (event.type === "text.delta") {
        emit?.({ type: "text.delta", runId, step, delta: event.delta });
      } else {
        response = event.response;
      }
    }
    if (!response) {
      throw new AiError("Provider stream ended without a completed response", {
        code: "E_AI_PROVIDER",
        provider: provider.name,
      });
    }
    return response;
  }

  async #executeTool(
    tools: Tool[],
    call: ToolCall,
    context: Parameters<Tool["execute"]>[1],
    errorMode: "report" | "throw",
  ): Promise<ToolExecution> {
    const startedAt = performance.now();
    const tool = tools.find((candidate) => candidate.name === call.name);

    try {
      if (!tool)
        throw new ToolExecutionError(
          `The model requested unknown tool "${call.name}"`,
        );
      const result = await tool.inputSchema.safeParseAsync(call.arguments);
      if (!result.success) {
        const issues = result.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
          )
          .join("; ");
        throw new ToolExecutionError(
          `Invalid input for tool "${call.name}": ${issues}`,
        );
      }

      const output = await tool.execute(result.data, context);
      return {
        call,
        output: serializeToolOutput(output),
        isError: false,
        durationMs: performance.now() - startedAt,
      };
    } catch (error) {
      const normalized =
        error instanceof ToolExecutionError
          ? error
          : new ToolExecutionError(`Tool "${call.name}" failed`, error);
      if (errorMode === "throw") throw normalized;
      return {
        call,
        output: JSON.stringify({ error: normalized.message }),
        isError: true,
        durationMs: performance.now() - startedAt,
      };
    }
  }

  #parseOutput(
    schema: OutputSchema | undefined,
    text: string,
    provider: string,
    finishReason: string,
  ): unknown {
    if (!schema) return undefined;
    if (finishReason === "refusal") {
      throw new StructuredOutputError(
        "The model refused to produce structured output",
        provider,
      );
    }

    try {
      return schema.parse(JSON.parse(text));
    } catch (error) {
      throw new StructuredOutputError(
        "The provider returned invalid structured output",
        provider,
        error,
      );
    }
  }

  async #dispatch<TKey extends keyof AiEvents>(
    event: TKey,
    payload: AiEvents[TKey],
  ): Promise<void> {
    try {
      await this.#events?.emit(event, payload);
    } catch {
      // Observability listeners must not change model execution behavior.
    }
  }
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  return JSON.stringify(output);
}

function textContent(input: UserContent): string {
  if (typeof input === "string") return input;
  return input
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function attachmentRecords(input: UserContent): AttachmentRecord[] {
  if (typeof input === "string") return [];
  return input
    .filter((part): part is FileContentPart => part.type === "file")
    .map((part) => ({
      mediaType: part.mediaType,
      ...(part.filename ? { filename: part.filename } : {}),
      source: part.source.type,
    }));
}

function validateUserContent(
  input: UserContent,
  capabilities: ProviderCapabilities,
  provider: string,
): void {
  if (typeof input === "string") return;
  if (input.length === 0) {
    throw new InvalidRequestError("User content must not be empty", provider);
  }

  for (const part of input) {
    if (part.type === "text") {
      if (!part.text.trim()) {
        throw new InvalidRequestError(
          "Text content parts must not be empty",
          provider,
        );
      }
      continue;
    }
    validateFilePart(part, capabilities, provider);
  }
}

function validateFilePart(
  part: FileContentPart,
  capabilities: ProviderCapabilities,
  provider: string,
): void {
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(part.mediaType)) {
    throw new InvalidRequestError(
      `Attachment media type "${part.mediaType}" is invalid`,
      provider,
    );
  }
  if (part.filename !== undefined && !part.filename.trim()) {
    throw new InvalidRequestError(
      "Attachment filename must not be empty",
      provider,
    );
  }

  if (part.source.type === "bytes") {
    if (
      !(part.source.data instanceof Uint8Array) ||
      part.source.data.byteLength === 0
    ) {
      throw new InvalidRequestError(
        "Attachment bytes must be a non-empty Uint8Array",
        provider,
      );
    }
  } else if (part.source.type === "base64") {
    if (
      !part.source.data ||
      part.source.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(part.source.data)
    ) {
      throw new InvalidRequestError(
        "Attachment base64 data is invalid",
        provider,
      );
    }
  } else {
    let url: URL;
    try {
      url = new URL(part.source.url);
    } catch (error) {
      throw new InvalidRequestError(
        "Attachment URL must be absolute",
        provider,
        400,
        error,
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new InvalidRequestError(
        "Attachment URL must use HTTP or HTTPS",
        provider,
      );
    }
  }

  const attachmentCapabilities = capabilities.attachments;
  const supported = part.mediaType.startsWith("image/")
    ? attachmentCapabilities?.images
    : attachmentCapabilities?.documents;
  if (
    !supported?.some((candidate) => mediaTypeMatches(candidate, part.mediaType))
  ) {
    throw new UnsupportedCapabilityError(
      `Provider "${provider}" does not declare support for ${part.mediaType} attachments`,
      provider,
    );
  }
}

function mediaTypeMatches(pattern: string, mediaType: string): boolean {
  if (pattern === "*/*" || pattern === mediaType) return true;
  return pattern.endsWith("/*") && mediaType.startsWith(pattern.slice(0, -1));
}

function eventError(error: AiError) {
  return { name: error.name, message: error.message, code: error.code };
}
