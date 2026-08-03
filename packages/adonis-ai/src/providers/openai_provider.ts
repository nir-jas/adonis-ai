import { createOpenAI } from "@ai-sdk/openai";
import { ConfigurationError } from "../errors.js";
import { AiSdkProvider } from "./ai_sdk_provider.js";

interface OpenAiConfig {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  store?: boolean;
  organization?: string;
  project?: string;
  fetch?: typeof fetch;
}

export class OpenAiProvider extends AiSdkProvider {
  constructor(config: OpenAiConfig, name = "openai") {
    if (!config.apiKey) {
      throw new ConfigurationError(
        `Provider "${name}" is missing an API key. Set OPENAI_API_KEY or config.providers.${name}.apiKey.`,
      );
    }
    const provider = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.organization ? { organization: config.organization } : {}),
      ...(config.project ? { project: config.project } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    super({
      name,
      providerOptionsKey: "openai",
      model: (modelId) => provider.responses(modelId),
      ...(config.maxRetries !== undefined
        ? { maxRetries: config.maxRetries }
        : {}),
      defaultProviderOptions: { store: config.store ?? false },
      attachments: {
        images: ["image/jpeg", "image/png", "image/gif", "image/webp"],
        documents: ["application/pdf"],
      },
    });
  }
}
