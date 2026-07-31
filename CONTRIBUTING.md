# Contributing

Adonis AI targets Node.js 24 or newer.

1. Install dependencies with `npm install`.
2. Run `npm run check` before opening a pull request.
3. Add a Changeset for changes that affect the published package.
4. Keep provider behavior normalized and add cases to the shared provider
   contract suite.

Default tests must never call a live AI API. Live tests must be opt-in and
cost-bounded.
