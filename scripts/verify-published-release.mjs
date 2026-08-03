import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedDistTag } from "./release-utils.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(workspaceRoot, "packages", "adonis-ai", "package.json")),
);
const version = process.argv[2] ?? manifest.version;
const expectedTag = process.argv[3] ?? expectedDistTag(version);
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}`;
const response = await fetch(registryUrl, {
  headers: { accept: "application/vnd.npm.install-v1+json" },
});

if (!response.ok) {
  throw new Error(
    `npm registry returned ${response.status} for ${manifest.name}`,
  );
}

const metadata = await response.json();
const published = metadata.versions?.[version];

if (!published) {
  throw new Error(`${manifest.name}@${version} is not published on npm`);
}
if (metadata["dist-tags"]?.[expectedTag] !== version) {
  throw new Error(
    `Expected npm dist-tag ${expectedTag} to reference ${version}, received ${metadata["dist-tags"]?.[expectedTag] ?? "nothing"}`,
  );
}
if (!published.dist?.integrity || !published.dist?.shasum) {
  throw new Error(
    `Published metadata for ${manifest.name}@${version} is missing integrity data`,
  );
}
if (!published.dist?.attestations?.url) {
  throw new Error(
    `Published metadata for ${manifest.name}@${version} is missing npm provenance`,
  );
}

console.log(
  `Verified ${manifest.name}@${version}: ${expectedTag} dist-tag, integrity, and npm provenance`,
);
