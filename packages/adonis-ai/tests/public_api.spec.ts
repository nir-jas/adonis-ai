import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AiManager,
  BaseAgent,
  BaseTool,
  agent,
  configure,
  defineConfig,
  defineTool,
} from "../index.js";
import type {
  AiEventDispatcher,
  AiEvents,
  ManagerOptions,
  Message,
  RunOptions,
} from "../index.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderFactory,
} from "../src/provider.js";
import { AiSdkProvider } from "../src/providers/ai_sdk_provider.js";
import { AnthropicProvider } from "../src/providers/anthropic_provider.js";
import { AiGatewayProvider } from "../src/providers/gateway_provider.js";
import { OpenAiProvider } from "../src/providers/openai_provider.js";
import { AiFake, FakeProvider } from "../src/testing.js";

describe("public API", () => {
  it("keeps every supported runtime entrypoint importable", () => {
    assert.equal(typeof AiManager, "function");
    assert.equal(typeof BaseAgent, "function");
    assert.equal(typeof BaseTool, "function");
    assert.equal(typeof agent, "function");
    assert.equal(typeof configure, "function");
    assert.equal(typeof defineConfig, "function");
    assert.equal(typeof defineTool, "function");
    assert.equal(typeof AiSdkProvider, "function");
    assert.equal(typeof OpenAiProvider, "function");
    assert.equal(typeof AnthropicProvider, "function");
    assert.equal(typeof AiGatewayProvider, "function");
    assert.equal(typeof AiFake, "function");
    assert.equal(typeof FakeProvider, "function");
  });

  it("keeps the supported type contracts usable", () => {
    const messages: Message[] = [{ role: "user", content: "hello" }];
    const options: RunOptions = { messages };
    const capabilities: ProviderCapabilities = {
      streaming: true,
      tools: true,
      structuredOutput: true,
    };
    const managerOptions: ManagerOptions = {};
    const events: AiEventDispatcher = {
      emit<TKey extends keyof AiEvents>(
        _event: TKey,
        _payload: AiEvents[TKey],
      ) {},
    };
    const factory: ProviderFactory = () => ({
      name: "test",
      capabilities,
      async complete() {
        throw new Error("contract only");
      },
      async *stream() {},
    });
    const adapter: ProviderAdapter = factory({}, { name: "test" });

    assert.deepEqual(options.messages, messages);
    assert.deepEqual(managerOptions, {});
    assert.equal(typeof events.emit, "function");
    assert.equal(adapter.name, "test");
  });
});
