import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  AbortedRequestError,
  AiManager,
  MaxStepsExceededError,
  StructuredOutputError,
  agent,
  defineTool,
} from "../index.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderStreamEvent,
} from "../src/provider.js";

function makeManager() {
  return new AiManager({
    default: "openai",
    providers: {
      openai: { driver: "openai", apiKey: "", model: "test-model" },
      anthropic: { driver: "anthropic", apiKey: "", model: "test-model" },
    },
  });
}

describe("AiManager", () => {
  it("runs anonymous agents and records prompts without network access", async () => {
    const ai = makeManager();
    const fake = ai.fake(["Hello from the fake"]).preventStrayRequests();
    const assistant = agent({ instructions: "Be concise." });

    const response = await ai.prompt(assistant, "Hello");

    assert.equal(response.text, "Hello from the fake");
    assert.equal(response.provider, "openai");
    assert.equal(response.model, "test-model");
    assert.equal(response.data, undefined);
    fake.assertPrompted("Hello");
    assert.equal(fake.prompts().length, 1);
  });

  it("validates structured fake responses with Zod", async () => {
    const ai = makeManager();
    const output = z.object({ answer: z.string(), confidence: z.number() });
    const assistant = agent({ instructions: "Return JSON.", output });
    ai.fake([
      { data: { answer: "AdonisJS", confidence: 0.98 } },
    ]).preventStrayRequests();

    const response = await ai.prompt(assistant, "Which framework?");

    assert.deepEqual(response.data, { answer: "AdonisJS", confidence: 0.98 });
  });

  it("rejects structured data that does not satisfy the schema", async () => {
    const ai = makeManager();
    const assistant = agent({
      instructions: "Return JSON.",
      output: z.object({ answer: z.string() }),
    });
    ai.fake([{ data: { answer: 42 } }]).preventStrayRequests();

    await assert.rejects(
      ai.prompt(assistant, "Question"),
      (error: unknown) =>
        error instanceof StructuredOutputError &&
        error.code === "E_AI_STRUCTURED_OUTPUT",
    );
  });

  it("executes tool calls sequentially in provider order and aggregates steps", async () => {
    const ai = makeManager();
    const executions: number[] = [];
    const double = defineTool({
      name: "double",
      description: "Double a number",
      input: z.object({ value: z.number() }),
      execute({ value }) {
        executions.push(value);
        return { result: value * 2 };
      },
    });
    const assistant = agent({
      instructions: "Use tools.",
      tools: [double],
    });
    ai.fake([
      {
        toolCalls: [
          { id: "call_1", name: "double", arguments: { value: 2 } },
          { id: "call_2", name: "double", arguments: { value: 4 } },
        ],
      },
      { text: "The results are 4 and 8." },
    ]).preventStrayRequests();

    const response = await ai.prompt(assistant, "Double these");

    assert.deepEqual(executions, [2, 4]);
    assert.equal(response.steps.length, 2);
    assert.equal(response.toolCalls.length, 2);
    assert.equal(response.text, "The results are 4 and 8.");
  });

  it("returns safe tool errors to the model by default", async () => {
    const ai = makeManager();
    const lookup = defineTool({
      name: "lookup",
      description: "Look up an identifier",
      input: z.object({ id: z.number() }),
      execute({ id }) {
        return { id };
      },
    });
    const assistant = agent({ instructions: "Use tools.", tools: [lookup] });
    let secondStepToolResult = "";
    ai.fake((_prompt, request) => {
      const toolResult = request.messages.findLast(
        (message) => message.role === "tool",
      );
      if (!toolResult) {
        return {
          toolCalls: [
            { id: "bad_call", name: "lookup", arguments: { id: "wrong" } },
          ],
        };
      }
      secondStepToolResult = toolResult.content;
      return "I could not complete the lookup.";
    }).preventStrayRequests();

    const response = await ai.prompt(assistant, "Look it up");

    assert.match(secondStepToolResult, /Invalid input for tool/);
    assert.equal(response.steps[0]?.toolExecutions[0]?.isError, true);
  });

  it("enforces the maximum tool step count", async () => {
    const ai = makeManager();
    const loop = defineTool({
      name: "loop",
      description: "Continue",
      input: z.object({}),
      execute: () => "again",
    });
    const assistant = agent({ instructions: "Loop.", tools: [loop] });
    ai.fake(() => ({
      toolCalls: [{ id: crypto.randomUUID(), name: "loop", arguments: {} }],
    })).preventStrayRequests();

    await assert.rejects(
      ai.prompt(assistant, "Loop", { maxSteps: 2 }),
      (error: unknown) => error instanceof MaxStepsExceededError,
    );
  });

  it("streams normalized events and exposes the final response", async () => {
    const ai = makeManager();
    const assistant = agent({ instructions: "Stream." });
    ai.fake([{ text: "Hello world", chunks: ["Hello", " ", "world"] }]);
    const stream = ai.stream(assistant, "Hi");
    const eventTypes: string[] = [];
    const deltas: string[] = [];

    for await (const event of stream) {
      eventTypes.push(event.type);
      if (event.type === "text.delta") deltas.push(event.delta);
    }
    const response = await stream.finalResponse();

    assert.deepEqual(deltas, ["Hello", " ", "world"]);
    assert.deepEqual(eventTypes, [
      "run.started",
      "text.delta",
      "text.delta",
      "text.delta",
      "step.completed",
      "run.completed",
    ]);
    assert.equal(response.text, "Hello world");
  });

  it("keeps prompt content out of observable events by default", async () => {
    const payloads: unknown[] = [];
    const ai = new AiManager(
      {
        default: "openai",
        providers: {
          openai: { driver: "openai", apiKey: "", model: "test-model" },
        },
      },
      {
        events: {
          emit(_event, payload) {
            payloads.push(payload);
          },
        },
      },
    );
    ai.fake(["safe"]);
    await ai.prompt(agent({ instructions: "Test." }), "secret prompt");

    assert.ok(payloads.length > 0);
    assert.equal(
      payloads.some((payload) =>
        JSON.stringify(payload).includes("secret prompt"),
      ),
      false,
    );
  });

  it("aborts upstream provider work when an SSE stream is destroyed", async () => {
    let markAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const slowProvider: ProviderAdapter = {
      name: "slow",
      capabilities: { streaming: true, tools: true, structuredOutput: true },
      complete: async () => {
        throw new Error("Not used");
      },
      async *stream(
        request: ProviderRequest,
      ): AsyncIterable<ProviderStreamEvent> {
        await new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              markAborted();
              reject(request.signal.reason);
            },
            { once: true },
          );
        });
      },
    };
    const ai = new AiManager({
      default: "slow",
      providers: { slow: { driver: "slow", model: "slow-model" } },
    });
    ai.extend("slow", () => slowProvider);
    const stream = ai.stream(agent({ instructions: "Wait." }), "Wait");
    const readable = stream.toSseReadable();
    readable.on("error", () => {});
    readable.once("data", () => readable.destroy());

    await aborted;
    await assert.rejects(
      stream.finalResponse(),
      (error: unknown) => error instanceof AbortedRequestError,
    );
  });
});
