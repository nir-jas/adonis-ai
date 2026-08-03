import { createAnthropic } from "@ai-sdk/anthropic";
import { ConfigurationError } from "../errors.js";
import { AiSdkProvider } from "./ai_sdk_provider.js";

interface AnthropicConfig {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
}

export class AnthropicProvider extends AiSdkProvider {
  constructor(config: AnthropicConfig, name = "anthropic") {
    if (!config.apiKey) {
      throw new ConfigurationError(
        `Provider "${name}" is missing an API key. Set ANTHROPIC_API_KEY or config.providers.${name}.apiKey.`,
      );
    }
    const provider = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.defaultHeaders ? { headers: config.defaultHeaders } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    super({
      name,
      providerOptionsKey: "anthropic",
      model: (modelId) => provider.messages(modelId),
      attachments: {
        images: ["image/jpeg", "image/png", "image/gif", "image/webp"],
        documents: ["application/pdf", "text/plain"],
      },
      ...(config.maxRetries !== undefined
        ? { maxRetries: config.maxRetries }
        : {}),
    });
  }
}
