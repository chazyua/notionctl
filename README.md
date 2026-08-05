# notionctl

[![CI](https://github.com/chazyua/notionctl/actions/workflows/ci.yml/badge.svg)](https://github.com/chazyua/notionctl/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/notionctl)](https://www.npmjs.com/package/notionctl)
[![license](https://img.shields.io/npm/l/notionctl)](LICENSE)
[![node](https://img.shields.io/node/v/notionctl)](package.json)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

**The security-first CLI for Notion.** Zero dependencies. Fully auditable. Built for AI agents and humans alike.

```sh
npm install -g notionctl
```

Requires Node 18+.

## Quick Start

```sh
# Option A: OAuth browser login (recommended)
notionctl auth login --client-id <id> --client-secret <secret>

# Option B: Paste an integration token
notionctl auth set

# Option C: Environment variable
export NOTION_TOKEN=ntn_...

# Verify
notionctl whoami

# Go
notionctl search "Q2 Roadmap"
notionctl page get <url-or-id>
notionctl page sync ./prd.md --parent <page-id>
```

## Why notionctl

AI coding agents (Claude Code, Copilot, Cursor) work best when they can read and write your team's Notion knowledge base. MCP servers bridge this gap, but require persistent processes with broad privileges and a larger attack surface.

notionctl is the alternative: **one shell command per operation**, shell-logged, `--dry-run`-able, and auditable line by line. Every action an agent takes is a visible terminal invocation.

### notionctl vs MCP

| | notionctl | Notion MCP server |
|---|---|---|
| **Token cost** | One shell command + one response per operation | Tool schemas, JSON-RPC framing, and capability negotiation all consume context tokens |
| **Latency** | Single process: spawn → HTTP call → exit | Persistent server + JSON-RPC round-trip per call |
| **Agent context** | Agent sees `notionctl page get <id>` — one line | Agent loads full tool schema list into context window on every session |
| **Setup** | `npm i -g notionctl` + one token | Server process, config file, client wiring |
| **Auditability** | Every call is a shell command in your terminal log | Operations happen inside an opaque server process |
| **Security surface** | Zero deps, single network file, auditable in an afternoon | Server framework, transitive deps, persistent token in memory |

## Security Model

notionctl was designed so that a security team can audit the entire tool in an afternoon.

- **Zero runtime dependencies.** The entire codebase is hand-written TypeScript compiled to ES modules. No `node_modules`. No transitive supply chain risk.
- **Single network file.** All outbound traffic goes through `src/http.ts`, hardcoded to `https://api.notion.com`. No `--api-base` flag, no proxy support, no way to redirect the token.
- **Single secrets file.** Token access is isolated to `src/auth.ts`. Tokens live in `NOTION_TOKEN` or a mode-0600 config file. Tokens never appear in logs, errors, or stdout.
- **Automated security tests.** `npm run test:security` runs grep-based source tree assertions that encode these invariants. They fail the build on drift:
  - Only `http.ts` calls `fetch()`
  - Only `auth.ts` reads the config path
  - No hardcoded token patterns in source
  - No non-Node-builtin imports
  - Only `api.notion.com` URLs in source
- **Dry-run everything.** Every write command supports `--dry-run` to preview the payload without sending.
- **Content-hashed sync.** `page sync` uses SHA-256 frontmatter hashing with drift detection to prevent accidental overwrites.
- **No telemetry.** Zero outbound traffic beyond `api.notion.com`. Provable: `grep -r "https://" src/`.

### What about sandboxing and approvals?

notionctl deliberately implements neither. Both already exist one layer up, and the CLI shape is what lets you use them.

**Approvals belong to the agent harness.** Every operation is a single shell command, so your harness's existing permission rules apply per operation. In Claude Code, allowlist the reads and let the writes prompt:

```json
{
  "permissions": {
    "allow": ["Bash(notionctl page get:*)", "Bash(notionctl db query:*)"]
  }
}
```

Anything not listed still prompts, so writes stay gated without an explicit rule.

With an MCP server you approve the tool once, not the operation.

**Sandboxing belongs to the OS.** notionctl is a short-lived subprocess with no listening port and no state between runs, so whatever you already confine your agents with (Seatbelt, a container, a restricted user) applies to it unchanged.

**Blast radius belongs to Notion.** An integration only sees the pages explicitly shared with it, so scope the integration and the token can't reach the rest of your workspace. Pair that with `--dry-run` before any write, and `page sync`'s content hashing to catch pages that changed underneath you.

## Command Surface

39 commands across 8 categories. Full reference: [docs/COMMANDS.md](docs/COMMANDS.md).

### Pages

```sh
notionctl page get <id>                              # Read as Markdown
notionctl page create --parent <id> --title "X"      # Create from Markdown
notionctl page sync ./doc.md --parent <id>            # Bidirectional sync
notionctl page find-replace <id> --find "v1" --replace "v2"
notionctl page duplicate <id>
notionctl page move <id> --to <parent-id>
notionctl page open <id>                              # Open in browser
notionctl page restore <id>                           # Undelete
notionctl page delete <id> --yes
```

### Databases

```sh
notionctl db create --parent <id> --title "Tasks" \
  --prop Status=select:Todo,Doing,Done --prop Due=date
notionctl db query <id> --filter "Status=Done" --sort "Due:desc"
notionctl db schema <id>
notionctl db row create <id> --prop "Name=Ship v2" --prop "Status=Todo"
notionctl db row update <id> --prop "Status=Done"
```

Filter DSL supports `=`, `>`, `<`, `>=`, `<=` across select, number, date, text, checkbox, and multi_select types. For complex filters: `--filter-json @filter.json`.

### Blocks, Files, Comments, Users

```sh
notionctl block children <id> --recursive     # Full page subtree
notionctl block append <id> --from patch.md --after <block-id>
notionctl file upload ./screenshot.png --parent <page-id>
notionctl comment add <page-id> --text "LGTM"
notionctl user list
```

### Auth

```sh
notionctl auth login --client-id <id> --client-secret <secret>  # OAuth
notionctl auth set [--profile staging]                           # Token from stdin
notionctl auth status                                            # Verify token
notionctl auth doctor                                            # Full diagnostics
```

### Escape Hatch

Any Notion REST endpoint, with the CLI's auth and retry behavior:

```sh
notionctl api GET /users/me
notionctl api POST /databases/<id>/query --body @filter.json
```

Reads and idempotent writes retry on transient failures. Endpoints that create
something are retried only on rate limits, since Notion cannot deduplicate a
repeated write — any other failure reports that the request may already have
been applied, rather than risking a duplicate.

## Markdown Engine

Bidirectional Markdown conversion with full fidelity:

**Read:** headings, paragraphs, bullet/numbered/to-do lists (nested), code blocks, tables (GFM), quotes, callouts, toggles, dividers, images, equations, bold, italic, strikethrough, inline code, links.

**Write:** all of the above. Nested lists use 2-space indentation and produce the corresponding nested block tree in Notion. Setext headings (`Title` underlined with `===` or `---`) are read as H1 and H2. Content indented under a list item — extra paragraphs, quotes, code blocks — stays inside that item. A toggleable heading round-trips as a `<details>` block preceded by a `<!-- notion-heading: N -->` marker; a line break inside a heading is collapsed to a space, since Markdown headings are one line.

Notion accepts at most two levels of nesting below the top level of a page, and
rejects the whole request when a write exceeds it. Blocks past that depth are
moved up beside their parent and a warning is printed, rather than the write
failing. This applies to every block type, so a toggle inside a callout inside a
quote counts toward the same budget as a three-level list. A table needs one
level for its rows, so it fits one level shallower than other blocks.

Blank paragraphs used as spacing in Notion are dropped, since a blank line is
already how Markdown separates blocks — syncing a page back removes its blank
spacing. Content is never affected, only spacing.

Notion text that begins with a Markdown marker is written out with a leading
backslash — a paragraph reading `---` becomes `\---` in the file. That shield is
removed when the file is read back, so the paragraph stays a paragraph instead of
turning into a divider. Leave the backslash in place when editing.

## Sync with Drift Detection

```sh
notionctl page sync ./prd.md --parent <id>   # Creates page, writes notion_id to frontmatter
# ...edit locally...
notionctl page sync ./prd.md                 # Updates only if local content changed
```

Each sync stores a SHA-256 content hash and timestamp in the file's YAML frontmatter. On subsequent syncs, if someone edited the page in Notion after your last sync, notionctl **refuses to overwrite** and tells you to fetch the remote version first. Override with `--force`.

## Output Formats

| Context | Default | Override |
|---------|---------|----------|
| TTY (interactive) | Human-friendly (table, Markdown) | `--format json` |
| Piped (scripts) | JSON | `--format table` |

All commands support `--format md|json|table|csv`.

## Testing

731 automated tests. Zero test framework dependencies (uses Node.js built-in `node:test`).

```sh
npm test                    # Full suite
npm run test:security       # Security invariant checks
```

Full test coverage breakdown: [docs/TESTING.md](docs/TESTING.md).

## Inspired By

notionctl was written from scratch, but drew on patterns from:

- [4ier/notion-cli](https://github.com/4ier/notion-cli) -- command taxonomy, filter DSL, `api` escape hatch
- [Coastal-Programs/notion-cli](https://github.com/Coastal-Programs/notion-cli) -- structured error model
- [lox/notion-cli](https://github.com/lox/notion-cli) -- `page sync` with frontmatter ID

## License

MIT. See [LICENSE](LICENSE).

## Security Disclosure

See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
