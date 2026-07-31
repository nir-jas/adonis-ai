import { args, BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { stubsRoot } from "../stubs/main.js";

export default class MakeAiTool extends BaseCommand {
  static commandName = "make:ai-tool";
  static description = "Create an application tool for AI agents";
  static options: CommandOptions = { allowUnknownFlags: false };

  @args.string({ description: "Name of the tool" })
  declare name: string;

  @flags.boolean({
    description: "Forcefully overwrite an existing tool",
    alias: "f",
  })
  declare force: boolean;

  async run(): Promise<void> {
    const codemods = await this.createCodemods();
    codemods.overwriteExisting = this.force === true;
    await codemods.makeUsingStub(stubsRoot, "make/tool/main.stub", {
      entity: this.app.generators.createEntity(this.name),
    });
  }
}
