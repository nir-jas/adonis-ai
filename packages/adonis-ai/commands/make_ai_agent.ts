import { args, BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { stubsRoot } from "../stubs/main.js";

export default class MakeAiAgent extends BaseCommand {
  static commandName = "make:ai-agent";
  static description = "Create a reusable AI agent";
  static options: CommandOptions = { allowUnknownFlags: false };

  @args.string({ description: "Name of the agent" })
  declare name: string;

  @flags.boolean({
    description: "Generate an agent with a Zod structured output schema",
  })
  declare structured: boolean;

  @flags.boolean({
    description: "Forcefully overwrite an existing agent",
    alias: "f",
  })
  declare force: boolean;

  async run(): Promise<void> {
    const codemods = await this.createCodemods();
    codemods.overwriteExisting = this.force === true;
    await codemods.makeUsingStub(
      stubsRoot,
      this.structured ? "make/agent/structured.stub" : "make/agent/main.stub",
      { entity: this.app.generators.createEntity(this.name) },
    );
  }
}
