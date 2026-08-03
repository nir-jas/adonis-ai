import { randomUUID } from "node:crypto";
import { AiError } from "./errors.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderStepResponse,
  ProviderStreamEvent,
} from "./provider.js";
import type {
  AttachmentRecord,
  FinishReason,
  Message,
  PromptRecord,
  TokenUsage,
  ToolCall,
} from "./types.js";
import { emptyUsage } from "./types.js";

export interface FakeResponseObject {
  text?: string;
  data?: unknown;
  chunks?: string[];
  toolCalls?: ToolCall[];
  finishReason?: FinishReason;
  usage?: Partial<TokenUsage>;
  id?: string;
}

export type FakeResponse = string | FakeResponseObject;
export type FakeResponseFactory = (
  prompt: PromptRecord,
  request: ProviderRequest,
) => FakeResponse | Promise<FakeResponse>;
export type FakeResponseSource = FakeResponse[] | FakeResponseFactory;

export class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    attachments: { images: ["image/*"], documents: ["*/*"] },
  };

  #responses: FakeResponse[];
  #factory?: FakeResponseFactory;
  #preventStray = false;
  #record?: PromptRecord;

  constructor(source: FakeResponseSource = []) {
    if (typeof source === "function") {
      this.#responses = [];
      this.#factory = source;
    } else {
      this.#responses = [...source];
    }
  }

  setRecord(record: PromptRecord): void {
    this.#record = record;
  }

  preventStrayRequests(): this {
    this.#preventStray = true;
    return this;
  }

  async complete(request: ProviderRequest): Promise<ProviderStepResponse> {
    const response = await this.#next(request);
    return this.#normalize(response);
  }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const response = await this.#next(request);
    const normalized = this.#normalize(response);
    const chunks =
      typeof response === "string"
        ? [response]
        : (response.chunks ?? (normalized.text ? [normalized.text] : []));

    for (const delta of chunks) yield { type: "text.delta", delta };
    yield { type: "step.completed", response: normalized };
  }

  async #next(request: ProviderRequest): Promise<FakeResponse> {
    if (!this.#record) {
      throw new AiError("Fake provider did not receive a prompt record", {
        code: "E_AI_PROVIDER",
        provider: "fake",
      });
    }
    if (this.#factory) return this.#factory(this.#record, request);
    const response = this.#responses.shift();
    if (response !== undefined) return response;
    if (this.#preventStray) {
      throw new AiError(
        "An AI request was made without a matching fake response",
        {
          code: "E_AI_PROVIDER",
          provider: "fake",
        },
      );
    }
    return "Fake response";
  }

  #normalize(response: FakeResponse): ProviderStepResponse {
    const object: FakeResponseObject =
      typeof response === "string" ? { text: response } : response;
    const text =
      object.data === undefined
        ? (object.text ?? "")
        : JSON.stringify(object.data);
    const baseUsage = emptyUsage();
    const usage: TokenUsage = {
      inputTokens: object.usage?.inputTokens ?? baseUsage.inputTokens,
      outputTokens: object.usage?.outputTokens ?? baseUsage.outputTokens,
      totalTokens:
        object.usage?.totalTokens ??
        (object.usage?.inputTokens ?? 0) + (object.usage?.outputTokens ?? 0),
    };

    const normalized: ProviderStepResponse = {
      id: object.id ?? `fake_${randomUUID()}`,
      text,
      finishReason:
        object.finishReason ??
        (object.toolCalls?.length ? "tool_calls" : "stop"),
      usage,
      toolCalls: object.toolCalls ?? [],
      raw: object,
    };
    if (object.id) normalized.requestId = object.id;
    return normalized;
  }
}

export interface PromptMatcherObject {
  agent?: string;
  prompt?: string | RegExp;
  provider?: string;
  conversationId?: string;
  messages?: (messages: readonly Message[]) => boolean;
  attachment?: Partial<AttachmentRecord>;
}

export type PromptMatcher =
  string | RegExp | PromptMatcherObject | ((record: PromptRecord) => boolean);

export class AiFake {
  readonly provider: FakeProvider;
  #records: PromptRecord[];
  #restore: () => void;

  constructor(
    provider: FakeProvider,
    records: PromptRecord[],
    restore: () => void,
  ) {
    this.provider = provider;
    this.#records = records;
    this.#restore = restore;
  }

  preventStrayRequests(): this {
    this.provider.preventStrayRequests();
    return this;
  }

  prompts(): readonly PromptRecord[] {
    return this.#records;
  }

  assertPrompted(matcher: PromptMatcher): void {
    if (!this.#records.some((record) => matchesPrompt(record, matcher))) {
      throw new Error(
        "Expected an AI prompt matching the assertion, but none was recorded",
      );
    }
  }

  assertNotPrompted(matcher: PromptMatcher): void {
    if (this.#records.some((record) => matchesPrompt(record, matcher))) {
      throw new Error(
        "Expected no AI prompt matching the assertion, but one was recorded",
      );
    }
  }

  assertNothingPrompted(): void {
    if (this.#records.length > 0) {
      throw new Error(
        `Expected no AI prompts, but ${this.#records.length} were recorded`,
      );
    }
  }

  restore(): void {
    this.#restore();
  }
}

function matchesPrompt(record: PromptRecord, matcher: PromptMatcher): boolean {
  if (typeof matcher === "function") return matcher(record);
  if (typeof matcher === "string") return record.prompt.includes(matcher);
  if (matcher instanceof RegExp) return matcher.test(record.prompt);
  if (matcher.agent && matcher.agent !== record.agent) return false;
  if (matcher.provider && matcher.provider !== record.provider) return false;
  if (
    matcher.conversationId &&
    matcher.conversationId !== record.conversationId
  )
    return false;
  if (matcher.messages && !matcher.messages(record.messages ?? []))
    return false;
  if (
    matcher.attachment &&
    !(record.attachments ?? []).some((attachment) =>
      Object.entries(matcher.attachment!).every(
        ([key, value]) => attachment[key as keyof AttachmentRecord] === value,
      ),
    )
  )
    return false;
  if (
    typeof matcher.prompt === "string" &&
    !record.prompt.includes(matcher.prompt)
  )
    return false;
  if (matcher.prompt instanceof RegExp && !matcher.prompt.test(record.prompt))
    return false;
  return true;
}
