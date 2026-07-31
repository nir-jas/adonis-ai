import type { z } from "zod";
import type { Awaitable, OutputSchema } from "./types.js";

export interface ToolContext {
  runId: string;
  step: number;
  signal: AbortSignal;
  provider: string;
  model: string;
}

export interface Tool<TSchema extends OutputSchema = OutputSchema> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TSchema;
  execute(input: z.output<TSchema>, context: ToolContext): Awaitable<unknown>;
}

export abstract class BaseTool<
  TSchema extends OutputSchema,
> implements Tool<TSchema> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: TSchema;

  abstract execute(
    input: z.output<TSchema>,
    context: ToolContext,
  ): Awaitable<unknown>;
}

export interface ToolDefinition<TSchema extends OutputSchema> {
  name: string;
  description: string;
  input: TSchema;
  execute(input: z.output<TSchema>, context: ToolContext): Awaitable<unknown>;
}

export function defineTool<const TSchema extends OutputSchema>(
  definition: ToolDefinition<TSchema>,
): Tool<TSchema> {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.input,
    execute: definition.execute,
  };
}
