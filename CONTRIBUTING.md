# Contributing

Thanks for helping improve Adonis AI. The project targets Node.js 24 or newer and uses npm workspaces.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm install`.
3. Make the change and add tests for user-visible behavior.
4. Run `npm run check`.
5. Add a Changeset for changes that should publish a new package version.
6. Open a pull request using the repository template.

Documentation-only repository changes do not need a Changeset. Changes to public APIs, runtime behavior, dependencies, or published package metadata do.

## Provider changes

- Keep agent and tool behavior provider-neutral.
- Limit adapters to request, response, error, usage, and stream translation.
- Add matching cases to the shared provider contract suite.
- Never include credentials, raw prompts, or sensitive provider payloads in fixtures.

## Tests

Default tests must never call a live AI API. Use the package fake or injected provider transports for deterministic coverage.

Live-provider tests must remain opt-in, cost-bounded, and excluded from ordinary CI. Never commit provider credentials.

## Getting help

Use [GitHub Discussions](https://github.com/nir-jas/adonis-ai/discussions) for contribution questions before opening speculative pull requests.
