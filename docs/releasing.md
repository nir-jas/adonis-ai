# Release qualification and publication

This checklist covers prerelease and stable publication. It complements the automated source, playground, browser, and packed-consumer tests.

## Qualify the candidate

1. Start from a clean checkout of `main` on Node.js 24 and npm 11.
2. Run `npm ci`, `npm run check`, and `npm run test:package-consumer`.
3. Run the cost-bounded live suites for OpenAI, Anthropic, and Gateway. Verify ordinary generation, streaming, structured output, application tools, and cancellation.
4. Exercise one supported image and PDF request against each applicable direct provider.
5. Exercise a durable `ConversationStore`, including successful replay and intentional load/append failures.
6. Review the generated changelog, migration notes, package exports, and `npm pack --workspace adonis-ai --dry-run` output.

## Publish

The release workflow runs `npm run release`. The publish wrapper derives the npm dist-tag from the package version: `alpha` versions publish to `alpha`, `rc` versions publish to `rc`, and stable versions publish to `latest`. This avoids prereleases moving the default installation channel before the first stable release.

To promote the current prerelease tag once after adopting this wrapper, run:

```bash
npm dist-tag add adonis-ai@0.1.0-alpha.2 alpha
```

For the stable release, exit Changesets prerelease mode, review the generated `0.1.0` release PR, and merge only after every qualification step passes.

## Verify the registry

After npm publication completes, verify the expected dist-tag, integrity metadata, and provenance attestation:

```bash
npm run release:verify -- 0.1.0-alpha.2
npm run release:verify -- 0.1.0
```

The command defaults to the version in `packages/adonis-ai/package.json`. An optional second argument overrides the expected tag when auditing historical metadata.

Finally, install the exact published version in a clean AdonisJS 7 application, run configure and both generators, and verify the documentation badge, npm package page, GitHub tag, and release notes.
