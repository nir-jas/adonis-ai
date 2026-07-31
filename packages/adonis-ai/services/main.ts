import app from "@adonisjs/core/services/app";
import { AiManager } from "../src/manager.js";

const ai = await app.container.make(AiManager);

export { ai as default };
