import type { ApplicationService } from "@adonisjs/core/types";
import type { AiConfig } from "../src/config.js";
import type { AiEventDispatcher } from "../src/events.js";
import { AiManager } from "../src/manager.js";
import type { AiEvents } from "../src/events.js";

declare module "@adonisjs/core/types" {
  interface EventsList extends AiEvents {}
}

export default class AiProvider {
  constructor(protected app: ApplicationService) {}

  register(): void {
    this.app.container.singleton(AiManager, async () => {
      const config = this.app.config.get<AiConfig>("ai");
      const { default: emitter } =
        await import("@adonisjs/core/services/emitter");
      const events: AiEventDispatcher = {
        emit: async (event, payload) => {
          await emitter.emit(event as never, payload as never);
        },
      };

      return new AiManager(config, {
        events,
        makeClass: async (constructor) => this.app.container.make(constructor),
      }).asDefault();
    });
  }
}
