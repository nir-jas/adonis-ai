import type { AiManager } from "./manager.js";

let resolver: (() => Promise<AiManager>) | undefined;

export function setAiManagerResolver(
  managerResolver: () => Promise<AiManager>,
): void {
  resolver = managerResolver;
}

export async function resolveAiManager(): Promise<AiManager> {
  if (resolver) return resolver();
  const service = await import("../services/main.js");
  return service.default;
}
