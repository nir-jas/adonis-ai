export type AiErrorCode =
  | "E_AI_CONFIGURATION"
  | "E_AI_AUTHENTICATION"
  | "E_AI_RATE_LIMIT"
  | "E_AI_TIMEOUT"
  | "E_AI_PROVIDER_OVERLOADED"
  | "E_AI_INVALID_REQUEST"
  | "E_AI_STRUCTURED_OUTPUT"
  | "E_AI_TOOL"
  | "E_AI_MAX_STEPS"
  | "E_AI_ABORTED"
  | "E_AI_UNSUPPORTED_CAPABILITY"
  | "E_AI_CONVERSATION"
  | "E_AI_PROVIDER";

export interface AiErrorOptions {
  code: AiErrorCode;
  provider?: string | undefined;
  status?: number | undefined;
  retryable?: boolean;
  cause?: unknown | undefined;
}

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly provider: string | undefined;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: AiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export class ConfigurationError extends AiError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "E_AI_CONFIGURATION", cause });
  }
}

export class AuthenticationError extends AiError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, {
      code: "E_AI_AUTHENTICATION",
      provider,
      status: 401,
      cause,
    });
  }
}

export class RateLimitError extends AiError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, {
      code: "E_AI_RATE_LIMIT",
      provider,
      status: 429,
      retryable: true,
      cause,
    });
  }
}

export class ProviderOverloadedError extends AiError {
  constructor(
    message: string,
    provider?: string,
    status?: number,
    cause?: unknown,
  ) {
    super(message, {
      code: "E_AI_PROVIDER_OVERLOADED",
      provider,
      status,
      retryable: true,
      cause,
    });
  }
}

export class TimeoutError extends AiError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, { code: "E_AI_TIMEOUT", provider, retryable: true, cause });
  }
}

export class AbortedRequestError extends AiError {
  constructor(
    message = "The AI request was aborted",
    provider?: string,
    cause?: unknown,
  ) {
    super(message, { code: "E_AI_ABORTED", provider, cause });
  }
}

export class InvalidRequestError extends AiError {
  constructor(
    message: string,
    provider?: string,
    status = 400,
    cause?: unknown,
  ) {
    super(message, { code: "E_AI_INVALID_REQUEST", provider, status, cause });
  }
}

export class UnsupportedCapabilityError extends AiError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, {
      code: "E_AI_UNSUPPORTED_CAPABILITY",
      provider,
      status: 400,
      cause,
    });
  }
}

export class ConversationPersistenceError extends AiError {
  readonly operation: "load" | "append";

  constructor(message: string, operation: "load" | "append", cause?: unknown) {
    super(message, { code: "E_AI_CONVERSATION", cause });
    this.operation = operation;
  }
}

export class StructuredOutputError extends AiError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, { code: "E_AI_STRUCTURED_OUTPUT", provider, cause });
  }
}

export class ToolExecutionError extends AiError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "E_AI_TOOL", cause });
  }
}

export class MaxStepsExceededError extends AiError {
  constructor(maxSteps: number) {
    super(`The agent exceeded the maximum of ${maxSteps} steps`, {
      code: "E_AI_MAX_STEPS",
    });
  }
}

export function normalizeProviderError(
  error: unknown,
  provider: string,
): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AbortedRequestError(undefined, provider, error);
  }

  const candidate = error as {
    status?: number;
    statusCode?: number;
    name?: string;
    message?: string;
    code?: string;
  };
  const message = candidate?.message ?? `The ${provider} request failed`;
  const status = candidate?.status ?? candidate?.statusCode;

  if (status === 401 || status === 403)
    return new AuthenticationError(message, provider, error);
  if (status === 429) return new RateLimitError(message, provider, error);
  if (status !== undefined && status >= 500) {
    return new ProviderOverloadedError(message, provider, status, error);
  }
  if (status !== undefined && status >= 400) {
    return new InvalidRequestError(message, provider, status, error);
  }
  if (candidate?.name === "AbortError")
    return new AbortedRequestError(undefined, provider, error);
  if (candidate?.name === "TimeoutError" || candidate?.code === "ETIMEDOUT") {
    return new TimeoutError(message, provider, error);
  }

  return new AiError(message, {
    code: "E_AI_PROVIDER",
    provider,
    cause: error,
  });
}
