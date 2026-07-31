import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { AiManager, agent, defineTool } from "../../index.js";

const provider = process.env.AI_LIVE_PROVIDER;
const enabled = provider === "openai" || provider === "anthropic";
const apiKey =
  provider === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.ANTHROPIC_API_KEY;
const model =
  provider === "openai"
    ? process.env.OPENAI_MODEL
    : process.env.ANTHROPIC_MODEL;

describe(
  "live provider acceptance",
  { skip: !enabled || !apiKey || !model },
  () => {
    const ai = new AiManager({
      default: provider!,
      maxOutputTokens: 200,
      providers: {
        [provider!]: {
          driver: provider!,
          apiKey: apiKey!,
          model: model!,
          maxRetries: 0,
        },
      },
    });

    it("returns plain text", async () => {
      const response = await ai.prompt(
        agent({ instructions: "Reply using three words or fewer." }),
        "Say hello.",
      );
      assert.ok(response.text.length > 0);
    });

    it("streams text", async () => {
      const stream = ai.stream(
        agent({ instructions: "Reply using three words or fewer." }),
        "Say hello.",
      );
      let deltas = "";
      for await (const event of stream) {
        if (event.type === "text.delta") deltas += event.delta;
      }
      assert.ok(deltas.length > 0);
    });

    it("returns validated structured data", async () => {
      const output = z.object({ answer: z.string() });
      const response = await ai.prompt(
        agent({ instructions: "Answer briefly.", output }),
        "Name the JavaScript runtime used by AdonisJS.",
      );
      const answer: string = response.data.answer;
      assert.ok(answer.length > 0);
    });

    it("executes an application tool", async () => {
      const echo = defineTool({
        name: "echo",
        description:
          "Echo the supplied value. You must use this tool for echo requests.",
        input: z.object({ value: z.string() }),
        execute: ({ value }) => ({ echoed: value }),
      });
      const response = await ai.prompt(
        agent({
          instructions: "Always call echo when asked to echo.",
          tools: [echo],
        }),
        "Use the echo tool with value alpha.",
      );
      assert.equal(response.toolCalls[0]?.name, "echo");
    });
  },
);
