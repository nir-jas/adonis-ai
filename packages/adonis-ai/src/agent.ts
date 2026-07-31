import type { z } from "zod";
import { resolveAiManager } from "./runtime.js";
import { AgentStream } from "./stream.js";
import type { Tool } from "./tool.js";
import type {
  AgentResponse,
  Awaitable,
  InferAgentOutput,
  Message,
  OutputSchema,
  RunOptions,
} from "./types.js";

export interface AgentLike<
  TSchema extends OutputSchema | undefined = OutputSchema | undefined,
> {
  readonly name: string;
  readonly outputSchema?: TSchema;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  instructions(): Awaitable<string>;
  messages(): Awaitable<Message[]>;
  tools(): Awaitable<Tool[]>;
}

export abstract class BaseAgent<
  TSchema extends OutputSchema | undefined = undefined,
> implements AgentLike<TSchema> {
  readonly name: string = this.constructor.name;
  readonly outputSchema?: TSchema;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;

  abstract instructions(): Awaitable<string>;

  messages(): Awaitable<Message[]> {
    return [];
  }

  tools(): Awaitable<Tool[]> {
    return [];
  }

  async prompt(
    input: string,
    options: RunOptions = {},
  ): Promise<AgentResponse<InferAgentOutput<TSchema>>> {
    const ai = await resolveAiManager();
    return ai.prompt(this, input, options);
  }

  stream(
    input: string,
    options: RunOptions = {},
  ): AgentStream<InferAgentOutput<TSchema>> {
    return new AgentStream(async ({ emit, signal }) => {
      const ai = await resolveAiManager();
      return ai.execute(this, input, { ...options, signal }, true, emit);
    }, options.signal);
  }
}

export interface AgentDefinition<TSchema extends OutputSchema | undefined> {
  name?: string;
  instructions: string | (() => Awaitable<string>);
  messages?: Message[] | (() => Awaitable<Message[]>);
  tools?: Tool[] | (() => Awaitable<Tool[]>);
  output?: TSchema;
  provider?: string;
  model?: string;
}

class AnonymousAgent<
  TSchema extends OutputSchema | undefined,
> extends BaseAgent<TSchema> {
  declare readonly name: string;
  declare readonly outputSchema?: TSchema;
  declare readonly defaultProvider?: string;
  declare readonly defaultModel?: string;

  #definition: AgentDefinition<TSchema>;

  constructor(definition: AgentDefinition<TSchema>) {
    super();
    this.#definition = definition;
    this.name = definition.name ?? "AnonymousAgent";
    if (definition.output !== undefined) this.outputSchema = definition.output;
    if (definition.provider !== undefined)
      this.defaultProvider = definition.provider;
    if (definition.model !== undefined) this.defaultModel = definition.model;
  }

  instructions(): Awaitable<string> {
    const instructions = this.#definition.instructions;
    return typeof instructions === "function" ? instructions() : instructions;
  }

  messages(): Awaitable<Message[]> {
    const messages = this.#definition.messages;
    if (!messages) return [];
    return typeof messages === "function" ? messages() : messages;
  }

  tools(): Awaitable<Tool[]> {
    const tools = this.#definition.tools;
    if (!tools) return [];
    return typeof tools === "function" ? tools() : tools;
  }
}

export function agent<const TSchema extends z.ZodType | undefined = undefined>(
  definition: AgentDefinition<TSchema>,
): BaseAgent<TSchema> {
  return new AnonymousAgent(definition);
}
