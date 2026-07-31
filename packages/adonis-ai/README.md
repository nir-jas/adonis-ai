# adonis-ai

[![CI](https://github.com/nir-jas/adonis-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/nir-jas/adonis-ai/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/adonis-ai.svg)](https://www.npmjs.com/package/adonis-ai)
[![Node.js version](https://img.shields.io/node/v/adonis-ai.svg)](https://www.npmjs.com/package/adonis-ai)
[![license](https://img.shields.io/npm/l/adonis-ai.svg)](https://github.com/nir-jas/adonis-ai/blob/main/LICENSE.md)

A typed, agent-oriented AI SDK for AdonisJS 7 with OpenAI and Anthropic support.

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
- OpenAI Responses API and Anthropic Messages API adapters
- Async-iterable streaming and Adonis-friendly SSE conversion
- Zod 4 structured output and validated application tools
- Normalized usage, steps, request IDs, errors, and events
- IoC integration, Ace generators, cancellation, and testing fakes

See the [full documentation and playground](https://github.com/nir-jas/adonis-ai#readme). Ask questions in [Discussions](https://github.com/nir-jas/adonis-ai/discussions), report bugs through [Issues](https://github.com/nir-jas/adonis-ai/issues), and report vulnerabilities through [private security advisories](https://github.com/nir-jas/adonis-ai/security/advisories/new).
