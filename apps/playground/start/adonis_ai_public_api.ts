import {
  AiManager,
  BaseAgent,
  BaseTool,
  AgentStream,
  agent,
  configure,
  defineConfig,
  defineTool,
} from 'adonis-ai'
import type { AiEvents, ManagerOptions, Message, RunOptions, Tool } from 'adonis-ai'
import type { AiEventDispatcher } from 'adonis-ai/events'
import type { ProviderAdapter, ProviderFactory } from 'adonis-ai/provider'
import { AiSdkProvider } from 'adonis-ai/providers/ai-sdk'
import { AnthropicProvider } from 'adonis-ai/providers/anthropic'
import { AiGatewayProvider } from 'adonis-ai/providers/gateway'
import { OpenAiProvider } from 'adonis-ai/providers/openai'
import { AiFake, FakeProvider } from 'adonis-ai/testing'

export const publicApiRuntime = {
  AgentStream,
  AiFake,
  AiGatewayProvider,
  AiManager,
  AiSdkProvider,
  AnthropicProvider,
  BaseAgent,
  BaseTool,
  FakeProvider,
  OpenAiProvider,
  agent,
  configure,
  defineConfig,
  defineTool,
}

export type PublicApiTypes = {
  dispatcher: AiEventDispatcher
  events: AiEvents
  manager: ManagerOptions
  messages: Message[]
  options: RunOptions
  provider: ProviderAdapter
  providerFactory: ProviderFactory
  tool: Tool
}
