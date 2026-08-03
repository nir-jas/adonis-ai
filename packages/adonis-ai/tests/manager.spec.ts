import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  AbortedRequestError,
  AiError,
  AiManager,
  ConversationPersistenceError,
  MaxStepsExceededError,
  StructuredOutputError,
  ToolExecutionError,
  UnsupportedCapabilityError,
  agent,
  defineTool,
} from "../index.js";
import type { ConversationStore, Message } from "../index.js";
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

  it("reports unknown tools to the model without invoking application code", async () => {
    const ai = makeManager();
    const assistant = agent({ instructions: "Use tools." });
    let toolResult = "";
    ai.fake((_prompt, request) => {
      const result = request.messages.findLast(
        (message) => message.role === "tool",
      );
      if (!result) {
        return {
          toolCalls: [{ id: "unknown_1", name: "missing", arguments: {} }],
        };
      }
      toolResult = result.content;
      return "Recovered";
    }).preventStrayRequests();

    const response = await ai.prompt(assistant, "Try it");

    assert.match(toolResult, /unknown tool/);
    assert.equal(response.steps[0]?.toolExecutions[0]?.isError, true);
    assert.equal(response.text, "Recovered");
  });

  it("throws normalized tool failures in throw mode", async () => {
    const ai = makeManager();
    const explode = defineTool({
      name: "explode",
      description: "Fail deterministically",
      input: z.object({}),
      execute() {
        throw new Error("secret handler detail");
      },
    });
    const assistant = agent({ instructions: "Use tools.", tools: [explode] });
    ai.fake([
      { toolCalls: [{ id: "explode_1", name: "explode", arguments: {} }] },
    ]).preventStrayRequests();

    await assert.rejects(
      ai.prompt(assistant, "Explode", { toolErrorMode: "throw" }),
      (error: unknown) =>
        error instanceof ToolExecutionError &&
        error.code === "E_AI_TOOL" &&
        !error.message.includes("secret handler detail"),
    );
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
    let appendCount = 0;
    ai.useConversationStore({
      load: () => [],
      append: () => void appendCount++,
    });
    ai.extend("slow", () => slowProvider);
    const stream = ai.stream(agent({ instructions: "Wait." }), "Wait", {
      conversation: { id: "cancelled_conversation" },
    });
    const readable = stream.toSseReadable();
    readable.on("error", () => {});
    readable.once("data", () => readable.destroy());

    await aborted;
    await assert.rejects(
      stream.finalResponse(),
      (error: unknown) => error instanceof AbortedRequestError,
    );
    assert.equal(appendCount, 0);
  });

  it("rejects partial streams that end without a completed provider response", async () => {
    const partialProvider: ProviderAdapter = {
      name: "partial",
      capabilities: { streaming: true, tools: true, structuredOutput: true },
      async complete() {
        throw new Error("Not used");
      },
      async *stream(): AsyncIterable<ProviderStreamEvent> {
        yield { type: "text.delta", delta: "partial" };
      },
    };
    const ai = new AiManager({
      default: "partial",
      providers: { partial: { driver: "partial", model: "partial-model" } },
    });
    ai.extend("partial", () => partialProvider);
    const stream = ai.stream(agent({ instructions: "Stream." }), "Start");

    await assert.rejects(
      stream.finalResponse(),
      (error: unknown) =>
        error instanceof AiError && error.code === "E_AI_PROVIDER",
    );
  });

  it("settles failed streams once and orders failure events deterministically", async () => {
    const dispatched: string[] = [];
    const failingProvider: ProviderAdapter = {
      name: "failing",
      capabilities: { streaming: true, tools: true, structuredOutput: true },
      async complete() {
        throw new Error("provider failed");
      },
      async *stream(): AsyncIterable<ProviderStreamEvent> {
        throw new Error("provider failed");
      },
    };
    const ai = new AiManager(
      {
        default: "failing",
        providers: { failing: { driver: "failing", model: "failure-model" } },
      },
      {
        events: {
          emit(event) {
            dispatched.push(event);
          },
        },
      },
    );
    ai.extend("failing", () => failingProvider);
    const stream = ai.stream(agent({ instructions: "Fail." }), "private input");
    const streamEvents: string[] = [];

    await assert.rejects(async () => {
      for await (const event of stream) streamEvents.push(event.type);
    });
    await assert.rejects(stream.finalResponse());

    assert.deepEqual(streamEvents, ["run.started", "run.failed"]);
    assert.deepEqual(dispatched, ["ai:run_started", "ai:run_failed"]);
  });

  it("loads conversation history in order and atomically appends a tool-assisted turn", async () => {
    const history: Message[] = [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ];
    const appended: Message[][] = [];
    const store: ConversationStore = {
      load: () => history,
      append(_id, turn) {
        appended.push([...turn.messages]);
      },
    };
    const ai = makeManager().useConversationStore(store);
    const lookup = defineTool({
      name: "lookup",
      description: "Look up a value",
      input: z.object({ value: z.string() }),
      execute: ({ value }) => ({ value }),
    });
    const assistant = agent({
      instructions: "Use context.",
      messages: [{ role: "user", content: "Seed example" }],
      tools: [lookup],
    });
    const requests: Message[][] = [];
    ai.fake((_record, request) => {
      requests.push([...request.messages]);
      return request.messages.some((message) => message.role === "tool")
        ? "Final answer"
        : {
            toolCalls: [
              {
                id: "lookup_1",
                name: "lookup",
                arguments: { value: "current" },
              },
            ],
          };
    }).preventStrayRequests();

    const response = await ai.prompt(assistant, "Current question", {
      conversation: { id: "conversation_1" },
      messages: [{ role: "assistant", content: "One-off context" }],
    });

    assert.deepEqual(
      requests[0]?.slice(0, 5).map((message) => message.role),
      ["user", "user", "assistant", "assistant", "user"],
    );
    assert.equal(response.text, "Final answer");
    assert.equal(appended.length, 1);
    assert.deepEqual(
      appended[0]?.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(appended[0]?.[0]?.role, "user");
    assert.equal(
      appended[0]?.[0]?.role === "user" ? appended[0][0].content : "",
      "Current question",
    );
  });

  it("fails the run when conversation persistence fails", async () => {
    const dispatched: string[] = [];
    const ai = new AiManager(
      {
        default: "openai",
        providers: {
          openai: { driver: "openai", apiKey: "", model: "test-model" },
        },
      },
      { events: { emit: (event) => void dispatched.push(event) } },
    ).useConversationStore({
      load: () => [],
      append() {
        throw new Error("database unavailable");
      },
    });
    ai.fake(["Generated but not persisted"]).preventStrayRequests();

    await assert.rejects(
      ai.prompt(agent({ instructions: "Answer." }), "Question", {
        conversation: { id: "conversation_2" },
      }),
      (error: unknown) =>
        error instanceof ConversationPersistenceError &&
        error.operation === "append",
    );
    assert.deepEqual(dispatched, [
      "ai:run_started",
      "ai:conversation_loaded",
      "ai:conversation_failed",
      "ai:run_failed",
    ]);
  });

  it("does not append failed structured runs", async () => {
    let appendCount = 0;
    const ai = makeManager().useConversationStore({
      load: () => [],
      append() {
        appendCount++;
      },
    });
    const assistant = agent({
      instructions: "Return JSON.",
      output: z.object({ answer: z.string() }),
    });
    ai.fake([{ data: { answer: 42 } }]).preventStrayRequests();

    await assert.rejects(
      ai.prompt(assistant, "Question", {
        conversation: { id: "conversation_3" },
      }),
    );
    assert.equal(appendCount, 0);
  });

  it("validates attachments and provider declarations before a request", async () => {
    let requested = false;
    const textOnlyProvider: ProviderAdapter = {
      name: "text-only",
      capabilities: { streaming: true, tools: true, structuredOutput: true },
      async complete() {
        requested = true;
        throw new Error("Must not run");
      },
      async *stream() {
        requested = true;
      },
    };
    const ai = new AiManager({
      default: "text-only",
      providers: { "text-only": { driver: "text-only", model: "model" } },
    });
    ai.extend("text-only", () => textOnlyProvider);

    await assert.rejects(
      ai.prompt(agent({ instructions: "Inspect." }), [
        { type: "text", text: "What is shown?" },
        {
          type: "file",
          mediaType: "image/png",
          source: { type: "base64", data: "aGVsbG8=" },
        },
      ]),
      (error: unknown) => error instanceof UnsupportedCapabilityError,
    );
    assert.equal(requested, false);
  });

  it("rejects malformed attachment sources before fake execution", async () => {
    const ai = makeManager();
    const fake = ai.fake(["Must not be consumed"]).preventStrayRequests();

    await assert.rejects(
      ai.prompt(agent({ instructions: "Inspect." }), [
        {
          type: "file",
          mediaType: "application/pdf",
          source: { type: "base64", data: "not base64" },
        },
      ]),
      (error: unknown) =>
        error instanceof AiError && error.code === "E_AI_INVALID_REQUEST",
    );
    assert.equal(fake.prompts().length, 0);
  });

  it("records redacted attachment metadata for fake assertions", async () => {
    const payloads: unknown[] = [];
    const ai = new AiManager(
      {
        default: "openai",
        includeContentInEvents: true,
        providers: {
          openai: { driver: "openai", apiKey: "", model: "test-model" },
        },
      },
      { events: { emit: (_event, payload) => void payloads.push(payload) } },
    );
    const fake = ai.fake(["Image received"]).preventStrayRequests();
    await ai.prompt(agent({ instructions: "Inspect." }), [
      { type: "text", text: "Inspect this" },
      {
        type: "file",
        mediaType: "image/png",
        filename: "sample.png",
        source: { type: "bytes", data: new Uint8Array([1, 2, 3]) },
      },
    ]);

    fake.assertPrompted({
      attachment: {
        mediaType: "image/png",
        filename: "sample.png",
        source: "bytes",
      },
    });
    const serialized = JSON.stringify(payloads);
    assert.match(serialized, /Inspect this/);
    assert.match(serialized, /sample\.png/);
    assert.doesNotMatch(serialized, /"data"/);
    assert.doesNotMatch(serialized, /1,2,3/);
  });
});
