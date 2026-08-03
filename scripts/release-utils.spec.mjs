import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedDistTag,
  prereleaseTag,
  publishArguments,
} from "./release-utils.mjs";

test("derives npm tags from prerelease identifiers", () => {
  assert.equal(prereleaseTag("0.1.0-alpha.2"), "alpha");
  assert.equal(prereleaseTag("0.1.0-rc.0"), "rc");
  assert.equal(prereleaseTag("0.1.0"), undefined);
});

test("publishes prereleases to their channel and stable releases to latest", () => {
  assert.deepEqual(publishArguments("0.1.0-alpha.2"), [
    "publish",
    "--tag",
    "alpha",
  ]);
  assert.deepEqual(publishArguments("0.1.0"), ["publish"]);
  assert.equal(expectedDistTag("0.1.0-alpha.2"), "alpha");
  assert.equal(expectedDistTag("0.1.0"), "latest");
});
