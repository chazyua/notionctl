# notionctl

A security-auditable, zero-dependency command-line interface for Notion, designed to be driven by AI coding agents (Claude Code, GitHub Copilot, Cursor, and others) via shell invocations.

## Status

**Package name reserved. Active development in progress. First working release coming soon.**

## What it will do

- **Full read/write coverage** of Notion pages, databases, blocks, and comments
- **Round-trip Markdown ↔ Notion blocks** conversion with metadata preserved via sidecar comments, so blocks the converter doesn't natively understand are never destroyed on update
- **Schema-driven property value DSL** covering all Notion property types, with a typed escape hatch for exotic cases
- **Content-hashed `page sync`** for idempotent writes — re-running is a provable no-op if nothing changed
- **Structured error model** with typed error codes, actionable suggestions, and distinct exit codes for programmatic consumers
- **Raw REST escape hatch** (`notionctl api <METHOD> <path>`) so any Notion API endpoint is reachable even when no typed command wraps it
- **Zero runtime dependencies**, fully auditable TypeScript source
- **`npm install -g notionctl`**

## Why a CLI and not an MCP server

CLI invocations are discrete, shell-logged, `--dry-run`-able, and sandboxable by an organization's existing tooling. Every action the agent takes is visible in terminal history and can be audited after the fact. An MCP server is a persistent process with broader privileges and a larger attack surface. For security-conscious teams, the CLI model is defensible in a formal review in a way the MCP model is not.

## License

MIT
