import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
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

function copyTrackedPlayground() {
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "--", "apps/playground"],
    { cwd: workspaceRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

  for (const trackedPath of tracked) {
    const source = join(workspaceRoot, trackedPath);
    const destination = join(consumerRoot, relative(playgroundRoot, source));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
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

  copyTrackedPlayground();

  const consumerManifestPath = join(consumerRoot, "package.json");
  const consumerManifest = JSON.parse(
    readFileSync(consumerManifestPath, "utf8"),
  );
  consumerManifest.dependencies[packageManifest.name] =
    `file:../${basename(tarballPath)}`;
  writeFileSync(
    consumerManifestPath,
    `${JSON.stringify(consumerManifest, null, 2)}\n`,
  );

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

  console.log(
    `Verified ${packageManifest.name}@${packageManifest.version} from ${tarballName}`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
