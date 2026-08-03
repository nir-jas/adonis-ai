import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishArguments } from "./release-utils.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(workspaceRoot, "packages", "adonis-ai", "package.json")),
);
const args = publishArguments(manifest.version);

console.log(
  `Publishing ${manifest.name}@${manifest.version} with npm dist-tag ${args[2] ?? "latest"}`,
);

const result = spawnSync("changeset", args, {
  cwd: workspaceRoot,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
