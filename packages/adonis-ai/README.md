# adonis-ai

Agent-oriented AI primitives for AdonisJS 7, with OpenAI and Anthropic adapters.

```bash
npm install adonis-ai zod
node ace configure adonis-ai
```

```ts
import { BaseAgent } from "adonis-ai";

class Assistant extends BaseAgent {
  instructions() {
    return "Be concise.";
  }
}

const response = await new Assistant().prompt("Hello");
console.log(response.text);
```

The package includes typed agents, async-iterable and SSE streaming, Zod structured output, application tools, normalized usage/errors/events, Adonis IoC integration, Ace generators, and network-free testing fakes.

See the [full documentation and playground](https://github.com/nir-jas/adonis-ai#readme).
