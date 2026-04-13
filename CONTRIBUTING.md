# Contributing to notionctl

Thanks for your interest in contributing. This guide covers what you need to get started.

## Setup

```sh
git clone https://github.com/chazyua/notionctl.git
cd notionctl
npm install
npm run build
```

## Development

notionctl is written in TypeScript, compiled to ES modules, and has **zero runtime dependencies**. Keep it that way — any PR that adds a runtime dependency will be declined.

### Build & test

```sh
npm run build          # Compile TypeScript
npm test               # Full test suite (731 tests)
npm run test:security  # Security invariant checks
npm run typecheck      # Type-check without emitting
```

Tests use Node.js built-in `node:test` — no test framework needed.

### Project structure

```
src/
  index.ts            # CLI entry point and argument routing
  http.ts             # Single network file — all fetch() calls
  auth.ts             # Single secrets file — all token access
  markdown/           # Bidirectional Markdown <-> Notion blocks
  commands/           # One file per command category
  properties/         # Database property parsing and rendering
  sync/               # Content-hashed sync with drift detection
test/
  security/           # Source-tree invariant assertions
```

### Key constraints

- **`http.ts` is the only file that calls `fetch()`** — security tests enforce this.
- **`auth.ts` is the only file that reads credentials** — security tests enforce this.
- **All outbound traffic goes to `api.notion.com`** — no configurable base URL.
- Tests must pass on Node 18, 20, and 22.

## Submitting changes

1. Fork and create a feature branch from `main`.
2. Make your changes. Add tests for new behavior.
3. Run `npm test` and `npm run test:security` — both must pass.
4. Open a pull request against `main` with a clear description of what and why.

## Reporting bugs

Open an issue at [github.com/chazyua/notionctl/issues](https://github.com/chazyua/notionctl/issues). Include:

- notionctl version (`notionctl --version`)
- Node.js version (`node --version`)
- The command you ran and the output you got

## Security issues

See [SECURITY.md](SECURITY.md) for the responsible disclosure process. Do not open public issues for security vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
