import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { AiSdkProvider } from "../src/providers/ai_sdk_provider.js";
import { AnthropicProvider } from "../src/providers/anthropic_provider.js";
import { OpenAiProvider } from "../src/providers/openai_provider.js";
import type { ProviderRequest, ProviderStreamEvent } from "../src/provider.js";

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    runId: "run_1",
    agent: "ContractAgent",
    model: "test-model",
    instructions: "Be concise.",
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    maxOutputTokens: 256,
    timeout: 1_000,
    signal: new AbortController().signal,
    toolErrorMode: "report",
    includeRaw: false,
    ...overrides,
  };
}

describe("provider adapters", () => {
  it("accepts any AI SDK language model and preserves namespaced options", async () => {
    let requestedModel: string | undefined;
    const model = new MockLanguageModelV4({
      provider: "community-provider",
      modelId: "community-model",
      doGenerate: {
        content: [{ type: "text", text: "Hello from any model" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 3,
            noCache: 3,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 4, text: 4, reasoning: 0 },
        },
        response: { id: "generic_1", modelId: "community-model" },
        warnings: [],
      },
    });
    const provider = new AiSdkProvider({
      name: "community",
      model: (modelId) => {
        requestedModel = modelId;
        return model;
      },
    });

    const response = await provider.complete(
      request({
        model: "chosen-model",
        providerOptions: {
          gateway: { order: ["vertex"] },
          community: { featureFlag: true },
        },
      }),
    );

    assert.equal(requestedModel, "chosen-model");
    assert.equal(response.text, "Hello from any model");
    assert.deepEqual(model.doGenerateCalls[0]?.providerOptions, {
      gateway: { order: ["vertex"] },
      community: { featureFlag: true },
    });
  });

  it("maps an OpenAI Responses API request and response", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAiProvider({
      apiKey: "test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json(
          {
            id: "resp_1",
            object: "response",
            created_at: 1,
            status: "completed",
            model: "test-model",
            output: [
              {
                id: "message_1",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Hello from OpenAI",
                    annotations: [],
                    logprobs: [],
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 4,
              output_tokens: 3,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 1 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
          { headers: { "x-request-id": "request_1" } },
        );
      },
    });

    const response = await provider.complete(request());

    assert.equal(body?.model, "test-model");
    assert.equal(body?.store, false);
    assert.deepEqual((body?.input as Array<Record<string, unknown>>)[0], {
      role: "system",
      content: "Be concise.",
    });
    assert.equal(response.text, "Hello from OpenAI");
    assert.deepEqual(response.usage, {
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 7,
      cachedInputTokens: 1,
    });
  });

  it("maps OpenAI function calls into normalized tool calls", async () => {
    const provider = new OpenAiProvider({
      apiKey: "test",
      fetch: async () =>
        Response.json({
          id: "resp_tool",
          status: "completed",
          model: "test-model",
          output_text: "",
          output: [
            {
              id: "fc_1",
              type: "function_call",
              call_id: "call_1",
              name: "weather",
              arguments: '{"city":"Paris"}',
            },
          ],
          usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
        }),
    });

    const response = await provider.complete(
      request({
        tools: [
          {
            name: "weather",
            description: "Get weather",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
              additionalProperties: false,
            },
          },
        ],
      }),
    );

    assert.equal(response.finishReason, "tool_calls");
    assert.deepEqual(response.toolCalls, [
      { id: "call_1", name: "weather", arguments: { city: "Paris" } },
    ]);
  });

  it("maps an Anthropic Messages API request and response", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new AnthropicProvider({
      apiKey: "test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json(
          {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "test-model",
            content: [{ type: "text", text: "Hello from Claude" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 5, output_tokens: 3 },
          },
          { headers: { "request-id": "request_2" } },
        );
      },
    });

    const response = await provider.complete(request());

    assert.equal(body?.model, "test-model");
    assert.deepEqual(body?.system, [{ type: "text", text: "Be concise." }]);
    assert.equal(response.text, "Hello from Claude");
    assert.deepEqual(response.usage, {
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
    });
  });

  it("maps Anthropic tool use into normalized tool calls", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test",
      fetch: async () =>
        Response.json({
          id: "msg_tool",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "weather",
              input: { city: "Paris" },
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 4 },
        }),
    });

    const response = await provider.complete(request());

    assert.equal(response.finishReason, "tool_calls");
    assert.deepEqual(response.toolCalls, [
      { id: "tool_1", name: "weather", arguments: { city: "Paris" } },
    ]);
  });

  it("normalizes OpenAI Responses streaming events", async () => {
    const provider = new OpenAiProvider({
      apiKey: "test",
      fetch: async () =>
        eventStream([
          {
            type: "response.output_item.added",
            sequence_number: 1,
            output_index: 0,
            item: {
              id: "message_1",
              type: "message",
              status: "in_progress",
              role: "assistant",
              content: [],
            },
          },
          {
            type: "response.output_text.delta",
            delta: "Hello",
            sequence_number: 2,
            item_id: "message_1",
            output_index: 0,
            content_index: 0,
            logprobs: [],
          },
          {
            type: "response.output_text.delta",
            delta: " world",
            sequence_number: 3,
            item_id: "message_1",
            output_index: 0,
            content_index: 0,
            logprobs: [],
          },
          {
            type: "response.output_item.done",
            sequence_number: 4,
            output_index: 0,
            item: {
              id: "message_1",
              type: "message",
              status: "completed",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "Hello world",
                  annotations: [],
                  logprobs: [],
                },
              ],
            },
          },
          {
            type: "response.completed",
            sequence_number: 5,
            response: {
              id: "resp_stream",
              status: "completed",
              model: "test-model",
              output: [
                {
                  id: "message_1",
                  type: "message",
                  status: "completed",
                  role: "assistant",
                  content: [
                    {
                      type: "output_text",
                      text: "Hello world",
                      annotations: [],
                      logprobs: [],
                    },
                  ],
                },
              ],
              usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
            },
          },
        ]),
    });

    const events: ProviderStreamEvent[] = [];
    for await (const event of provider.stream(request())) events.push(event);

    assert.deepEqual(
      events
        .filter((event) => event.type === "text.delta")
        .map((event) => event.delta),
      ["Hello", " world"],
    );
    const completed = events.at(-1);
    assert.equal(completed?.type, "step.completed");
    assert.equal(
      completed?.type === "step.completed" ? completed.response.text : "",
      "Hello world",
    );
  });

  it("normalizes Anthropic Messages streaming events", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test",
      fetch: async () =>
        eventStream([
          {
            type: "message_start",
            message: {
              id: "msg_stream",
              type: "message",
              role: "assistant",
              content: [],
              model: "test-model",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 3, output_tokens: 0 },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "", citations: null },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "Claude stream",
              citations: null,
            },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 2 },
          },
          { type: "message_stop" },
        ]),
    });

    const events: ProviderStreamEvent[] = [];
    for await (const event of provider.stream(request())) events.push(event);

    assert.equal(events[0]?.type, "text.delta");
    assert.equal(
      events[0]?.type === "text.delta" ? events[0].delta : "",
      "Claude stream",
    );
    const completed = events.at(-1);
    assert.equal(
      completed?.type === "step.completed" ? completed.response.text : "",
      "Claude stream",
    );
  });
});

function eventStream(events: Record<string, unknown>[]): Response {
  const body = events.map(
    (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  return new Response(body.join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}
