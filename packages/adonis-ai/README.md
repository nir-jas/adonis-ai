<p align="center">
  <img src="https://raw.githubusercontent.com/nir-jas/adonis-ai/main/.github/assets/adonis-ai-logo.svg" width="520" alt="Adonis AI">
</p>

<div align="center">

[![Tests][tests-image]][tests-url] [![npm][npm-image]][npm-url] ![TypeScript][typescript-image] [![License][license-image]][license-url]

</div>

A typed, agent-oriented AI SDK for AdonisJS 7, built on Vercel AI SDK Core with AI Gateway and any compatible language-model provider.

> Status: `0.1.0-alpha.0`. The public API may change before `0.1.0`.

## Install

```bash
npm install adonis-ai zod
node ace configure adonis-ai
```

Configure at least one explicit provider model.

```dotenv
AI_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=

AI_GATEWAY_API_KEY=
AI_GATEWAY_MODEL=openai/gpt-5
```

## Create an agent

```bash
node ace make:ai-agent Assistant
```

```ts
import { BaseAgent } from "adonis-ai";

export default class AssistantAgent extends BaseAgent {
  instructions() {
    return "Be concise.";
  }
}

const response = await new AssistantAgent().prompt("Hello");
console.log(response.text);
```

## Included

- Reusable typed agents and an anonymous agent factory
- Vercel AI Gateway access to its full language-model catalog
- A public adapter for any AI SDK-compatible language model
- Built-in direct OpenAI Responses and Anthropic Messages drivers
- Async-iterable streaming and Adonis-friendly SSE conversion
- Zod 4 structured output and validated application tools
- Provider-neutral image/PDF input and application-owned conversations
- Normalized usage, steps, request IDs, errors, and events
- IoC integration, Ace generators, cancellation, and testing fakes

See the [full documentation and playground](https://github.com/nir-jas/adonis-ai#readme). Ask questions in [Discussions](https://github.com/nir-jas/adonis-ai/discussions), report bugs through [Issues](https://github.com/nir-jas/adonis-ai/issues), and report vulnerabilities through [private security advisories](https://github.com/nir-jas/adonis-ai/security/advisories/new).

The 0.2 message model keeps string prompts compatible while adding typed text/file parts, opt-in `ConversationStore` persistence, capability preflight, and redacted attachment observability. See the [conversations and files guide](https://github.com/nir-jas/adonis-ai/blob/main/docs/conversations-and-files.md).

[tests-image]: https://img.shields.io/github/actions/workflow/status/nir-jas/adonis-ai/ci.yml?branch=main&label=Tests&style=for-the-badge&colorA=15122e&colorB=8b7cff&logo=githubactions&logoColor=white
[tests-url]: https://github.com/nir-jas/adonis-ai/actions/workflows/ci.yml
[npm-image]: https://img.shields.io/npm/v/adonis-ai/latest.svg?style=for-the-badge&colorA=15122e&colorB=ff5a4f&logo=npm&logoColor=white
[npm-url]: https://www.npmjs.com/package/adonis-ai/v/latest
[typescript-image]: https://img.shields.io/badge/TypeScript-3178c6.svg?style=for-the-badge&labelColor=15122e&logo=typescript&logoColor=white
[license-image]: https://img.shields.io/github/license/nir-jas/adonis-ai?style=for-the-badge&colorA=15122e&colorB=43d9c2
[license-url]: https://github.com/nir-jas/adonis-ai/blob/main/LICENSE.md
