# Adonis AI 0.1 guide

This document defines the supported public surface for the first stable release. Import application APIs from `adonis-ai`; use documented subpaths only for provider extension, events, Adonis integration, and testing.

## Supported entrypoints

| Entrypoint                      | Purpose                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `adonis-ai`                     | Agents, manager, tools, configuration, responses, streams, errors, and event types |
| `adonis-ai/provider`            | Provider adapter, request, response, factory, and capability contracts             |
| `adonis-ai/providers/ai-sdk`    | Shared adapter for an AI SDK-compatible language model                             |
| `adonis-ai/providers/openai`    | Direct OpenAI Responses adapter                                                    |
| `adonis-ai/providers/anthropic` | Direct Anthropic Messages adapter                                                  |
| `adonis-ai/providers/gateway`   | Vercel AI Gateway adapter                                                          |
| `adonis-ai/events`              | Typed application-event contracts                                                  |
| `adonis-ai/testing`             | Fakes and prompt matchers                                                          |
| `adonis-ai/services/main`       | AdonisJS IoC singleton                                                             |
| `adonis-ai/configure`           | AdonisJS configure hook                                                            |
| `adonis-ai/commands`            | Ace command loader                                                                 |

The root `configure` export is retained because the AdonisJS configure command resolves it from the package root. Other tooling helpers are intentionally absent from the root API. Deep imports into `build/` or `src/` are unsupported.

## Configuration and security

Configure explicit models for every enabled provider. API keys are optional at boot so applications may enable only the providers they use, but a direct provider fails before its first request when its key is absent. Gateway, OpenAI, and Anthropic can all be selected through `AI_DEFAULT_PROVIDER`.

Prompt content is omitted from application events by default. Raw provider payloads are omitted unless `includeRaw` is enabled globally or for one run. Tool failures sent back to the model contain the normalized error message, not the original exception. Applications remain responsible for authorization, prompt-data classification, rate limits, and safe tool behavior.

## Provider behavior

All built-in language providers implement the same completion, streaming, structured-output, tool, usage, cancellation, timeout, request-ID, and normalized-error contracts. Model-specific features are passed through `providerOptions`. A custom provider may use `AiSdkProvider` for any AI SDK-compatible `LanguageModel`, or implement `ProviderAdapter` for another transport.

Provider-specific capabilities can still differ by model. The 0.1 contract covers text messages and application-executed tools; multimodal input, provider-executed tools, stored conversations, embeddings, media generation, MCP, and approvals are not part of 0.1.

## Testing

Use `ai.fake([...]).preventStrayRequests()` for queued responses, or pass a factory to inspect each normalized provider request. `assertPrompted`, `assertNotPrompted`, and `assertNothingPrompted` inspect recorded prompts without network access. Always restore a fake during teardown when a singleton manager is shared between tests.

The repository validates source tests, browser behavior, the production build, and the packed npm tarball installed into an isolated AdonisJS consumer. Live provider acceptance remains opt-in and cost bounded.

## Troubleshooting

- **Provider is not configured:** add the provider to `config/ai.ts` and select its registered name.
- **Model is empty:** set the provider model in configuration or pass `RunOptions.model`.
- **Missing API key:** set the direct provider key or use a custom/Gateway configuration that supplies credentials another way.
- **Structured output fails:** verify that the selected model supports structured output and that its completed JSON satisfies the Zod schema.
- **A stream stops early:** consume `finalResponse()` to receive the normalized failure; destroying the SSE readable intentionally aborts upstream work.
- **A fake makes an unexpected call:** use `preventStrayRequests()` and inspect `fake.prompts()` to find the unmatched prompt.

## Compatibility and upgrades

0.1 supports AdonisJS 7, Node.js 24 or newer, Zod 4, and AI SDK 7-compatible language models. During 0.x, breaking changes are released only in a new minor version with a Changeset and migration notes. Deprecations receive at least one minor-release transition when practical.

The alpha-to-stable migration removes `stubsRoot` from the root import while retaining `configure` for AdonisJS compatibility. Application code should not import `stubsRoot`. All other documented 0.1 string-prompt, message, agent, tool, stream, and fake APIs remain supported.
