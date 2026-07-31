import type Configure from "@adonisjs/core/commands/configure";
import { stubsRoot } from "./stubs/main.js";

export async function configure(command: Configure): Promise<void> {
  const codemods = await command.createCodemods();

  await codemods.updateRcFile((rcFile) => {
    rcFile
      .addProvider("adonis-ai/ai_provider")
      .addCommand("adonis-ai/commands");
  });

  await codemods.defineEnvVariables({
    AI_DEFAULT_PROVIDER: "openai",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: "",
  });

  await codemods.defineEnvValidations({
    leadingComment: "AI providers",
    variables: {
      AI_DEFAULT_PROVIDER:
        "Env.schema.enum.optional(['openai', 'anthropic'] as const)",
      OPENAI_API_KEY: "Env.schema.string.optional()",
      OPENAI_MODEL: "Env.schema.string.optional()",
      ANTHROPIC_API_KEY: "Env.schema.string.optional()",
      ANTHROPIC_MODEL: "Env.schema.string.optional()",
    },
  });

  await codemods.makeUsingStub(stubsRoot, "config/ai.stub", {});
}
