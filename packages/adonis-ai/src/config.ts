export interface CommonProviderConfig {
  driver: string;
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  [key: string]: unknown;
}

export interface OpenAiProviderConfig extends CommonProviderConfig {
  driver: "openai";
  store?: boolean;
  organization?: string;
  project?: string;
}

export interface AnthropicProviderConfig extends CommonProviderConfig {
  driver: "anthropic";
  defaultHeaders?: Record<string, string>;
}

export type ProviderConfig =
  OpenAiProviderConfig | AnthropicProviderConfig | CommonProviderConfig;

export interface AiConfig {
  default: string;
  maxSteps: number;
  maxOutputTokens: number;
  timeout: number;
  maxRetries: number;
  includeRaw: boolean;
  includeContentInEvents: boolean;
  providers: Record<string, ProviderConfig>;
}

export type AiConfigInput = Partial<Omit<AiConfig, "providers">> & {
  providers: Record<string, ProviderConfig>;
};

export function defineConfig(config: AiConfigInput): AiConfig {
  return {
    default: config.default ?? "openai",
    maxSteps: config.maxSteps ?? 8,
    maxOutputTokens: config.maxOutputTokens ?? 4096,
    timeout: config.timeout ?? 60_000,
    maxRetries: config.maxRetries ?? 2,
    includeRaw: config.includeRaw ?? false,
    includeContentInEvents: config.includeContentInEvents ?? false,
    providers: config.providers,
  };
}
