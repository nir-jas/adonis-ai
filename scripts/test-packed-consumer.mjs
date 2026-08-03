import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(workspaceRoot, "packages", "adonis-ai");
const playgroundRoot = join(workspaceRoot, "apps", "playground");
const temporaryRoot = mkdtempSync(join(tmpdir(), "adonis-ai-consumer-"));
const consumerRoot = join(temporaryRoot, "playground");
const configureRoot = join(temporaryRoot, "configure-fixture");
const npmCache = join(temporaryRoot, "npm-cache");

function run(command, args, cwd = workspaceRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      AI_LIVE_PROVIDER: "",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      APP_KEY: "package-consumer-key-0123456789abcdef",
      APP_URL: "http://127.0.0.1:3333",
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
      PORT: "3333",
      SESSION_DRIVER: "memory",
      npm_config_cache: npmCache,
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status}`,
    );
  }
}

function copyTrackedPlayground(destinationRoot) {
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "--", "apps/playground"],
    { cwd: workspaceRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

  for (const trackedPath of tracked) {
    const source = join(workspaceRoot, trackedPath);
    const destination = join(destinationRoot, relative(playgroundRoot, source));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function usePackedPackage(root, tarballPath, packageName) {
  const consumerManifestPath = join(root, "package.json");
  const consumerManifest = JSON.parse(
    readFileSync(consumerManifestPath, "utf8"),
  );
  consumerManifest.dependencies[packageName] =
    `file:../${basename(tarballPath)}`;
  writeFileSync(
    consumerManifestPath,
    `${JSON.stringify(consumerManifest, null, 2)}\n`,
  );
}

function prepareUnconfiguredFixture() {
  rmSync(join(configureRoot, "config", "ai.ts"), { force: true });

  const adonisrcPath = join(configureRoot, "adonisrc.ts");
  const adonisrc = readFileSync(adonisrcPath, "utf8")
    .replace(/^\s*\(\) => import\('adonis-ai\/commands'\),\n/m, "")
    .replace(/^\s*\(\) => import\('adonis-ai\/ai_provider'\),\n/m, "");
  writeFileSync(adonisrcPath, adonisrc);

  const envPath = join(configureRoot, "start", "env.ts");
  const envSource = readFileSync(envPath, "utf8").replace(
    /\n  \/\*\n  \|----------------------------------------------------------\n  \| AI providers[\s\S]*?AI_GATEWAY_MODEL: Env\.schema\.string\.optional\(\),\n/,
    "",
  );
  writeFileSync(envPath, envSource);

  const envExamplePath = join(configureRoot, ".env.example");
  const envExample = readFileSync(envExamplePath, "utf8")
    .split("\n")
    .filter(
      (line) =>
        !/^(AI_DEFAULT_PROVIDER|OPENAI_|ANTHROPIC_|AI_GATEWAY_)/.test(line),
    )
    .join("\n");
  writeFileSync(envExamplePath, envExample);
}

try {
  mkdirSync(npmCache, { recursive: true });
  run("npm", [
    "pack",
    "--workspace",
    "adonis-ai",
    "--pack-destination",
    temporaryRoot,
  ]);

  const packageManifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  const tarballName = `${packageManifest.name}-${packageManifest.version}.tgz`;
  const tarballPath = join(temporaryRoot, tarballName);

  copyTrackedPlayground(consumerRoot);
  usePackedPackage(consumerRoot, tarballPath, packageManifest.name);

  run("npm", ["install", "--no-audit", "--no-fund"], consumerRoot);

  const installedPackage = realpathSync(
    join(consumerRoot, "node_modules", packageManifest.name),
  );
  const localPackage = realpathSync(packageRoot);
  const temporaryPrefix = `${realpathSync(temporaryRoot)}${sep}`;

  if (installedPackage === localPackage) {
    throw new Error(
      "Packed consumer unexpectedly resolved the local workspace package",
    );
  }
  if (!installedPackage.startsWith(temporaryPrefix)) {
    throw new Error(
      `Packed package resolved outside the temporary consumer: ${installedPackage}`,
    );
  }

  run("npm", ["run", "typecheck"], consumerRoot);
  run("npm", ["test"], consumerRoot);
  run("npm", ["run", "build"], consumerRoot);

  copyTrackedPlayground(configureRoot);
  prepareUnconfiguredFixture();
  usePackedPackage(configureRoot, tarballPath, packageManifest.name);
  run("npm", ["install", "--no-audit", "--no-fund"], configureRoot);
  run(
    "node",
    ["ace", "configure", "adonis-ai", "--no-interaction"],
    configureRoot,
  );
  run(
    "node",
    ["ace", "configure", "adonis-ai", "--no-interaction"],
    configureRoot,
  );
  run("node", ["ace", "make:ai-agent", "Fixture"], configureRoot);
  run(
    "node",
    ["ace", "make:ai-agent", "StructuredFixture", "--structured"],
    configureRoot,
  );
  run("node", ["ace", "make:ai-tool", "Fixture"], configureRoot);

  for (const generatedPath of [
    "config/ai.ts",
    "app/ai/agents/fixture_agent.ts",
    "app/ai/agents/structured_fixture_agent.ts",
    "app/ai/tools/fixture_tool.ts",
  ]) {
    if (!existsSync(join(configureRoot, generatedPath))) {
      throw new Error(`Configure fixture did not generate ${generatedPath}`);
    }
  }

  run("npm", ["run", "typecheck"], configureRoot);
  run("npm", ["run", "build"], configureRoot);

  console.log(
    `Verified ${packageManifest.name}@${packageManifest.version} from ${tarballName}, including configure and generators`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
