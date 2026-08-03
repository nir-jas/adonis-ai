import { createGateway } from "ai";
import { AiSdkProvider } from "./ai_sdk_provider.js";

interface GatewayConfig {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  teamIdOrSlug?: string;
  headers?: Record<string, string>;
  metadataCacheRefreshMillis?: number;
  fetch?: typeof fetch;
}

export class AiGatewayProvider extends AiSdkProvider {
  constructor(config: GatewayConfig, name = "gateway") {
    const gateway = createGateway({
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.teamIdOrSlug ? { teamIdOrSlug: config.teamIdOrSlug } : {}),
      ...(config.headers ? { headers: config.headers } : {}),
      ...(config.metadataCacheRefreshMillis !== undefined
        ? { metadataCacheRefreshMillis: config.metadataCacheRefreshMillis }
        : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });

    super({
      name,
      model: (modelId) => gateway.languageModel(modelId),
      ...(config.maxRetries !== undefined
        ? { maxRetries: config.maxRetries }
        : {}),
    });
  }
}
