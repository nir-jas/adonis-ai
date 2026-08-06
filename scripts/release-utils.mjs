export function prereleaseTag(version) {
  const match = version.match(
    /^\d+\.\d+\.\d+-([0-9A-Za-z][0-9A-Za-z-]*)(?:\.[0-9A-Za-z-]+)*$/,
  );

  return match?.[1];
}

export function expectedDistTag(version) {
  return prereleaseTag(version) ?? "latest";
}
