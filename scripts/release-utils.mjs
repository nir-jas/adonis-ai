export function prereleaseTag(version) {
  const match = version.match(
    /^\d+\.\d+\.\d+-([0-9A-Za-z][0-9A-Za-z-]*)(?:\.[0-9A-Za-z-]+)*$/,
  );

  return match?.[1];
}

export function publishArguments(version) {
  const tag = prereleaseTag(version);
  return tag ? ["publish", "--tag", tag] : ["publish"];
}

export function expectedDistTag(version) {
  return prereleaseTag(version) ?? "latest";
}
