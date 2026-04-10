# notionctl

A security-auditable, zero-dependency command-line interface for Notion,
designed to be driven by AI coding agents (Claude Code, GitHub Copilot,
Cursor) via shell invocations.

## Install

    npm install -g notionctl

Requires Node 18+.

## Quick start

    export NOTION_TOKEN=ntn_...         # or: notionctl auth set
    notionctl whoami                    # verify the token
    notionctl search "PRD"              # find pages
    notionctl page get <url-or-id>      # read a page as markdown
    notionctl page sync ./prd.md \
      --parent <parent-page-id>         # push a local file to Notion

## Why this exists

AI coding agents work best when they can read the team's knowledge base
(PRDs, specs, docs in Notion) and write back updates. MCP servers are one
way to bridge this, but they require a persistent process with broader
privileges and a larger attack surface, which many enterprise security
teams disallow.

`notionctl` is the alternative: a discrete shell command per operation,
shell-logged, `--dry-run`-able, and auditable line-by-line. Every action
an agent takes is a visible terminal invocation.

## Security posture

- **Zero runtime dependencies.** The entire source tree is hand-audited
  TypeScript. No transitive supply chain.
- **Single file for network I/O** (`src/http.ts`). Hardcoded to
  `https://api.notion.com/v1`. No `--api-base` flag.
- **Single file for secrets** (`src/auth.ts`). Token lives in
  `$NOTION_TOKEN` or a mode-0600 config file, never in logs or errors.
- **Dry-run universal.** Every write supports `--dry-run`.
- **Content-hashed sync.** `page sync` is a provable no-op if nothing
  changed locally (SHA-256 front-matter hash).
- **No telemetry.** The CLI's only outbound traffic is
  `api.notion.com`. Provable by `grep -r "https://" src/`.
- **Automated security tests.** `npm run test:security` runs grep-based
  assertions that encode the above rules and fails the build on drift.

## Command surface

### Reading

    notionctl whoami                     Show integration info
    notionctl search <query>             Search by title or content
    notionctl resolve <url>              Notion URL → ID
    notionctl page get <id>              Page as Markdown + front-matter
    notionctl db query <id> [flags]      Query a database
    notionctl db schema <id>             Show property types
    notionctl db row get <id>            Single row as Markdown
    notionctl block children <id>        List child blocks

### Writing

    notionctl page create --parent <id> --title "X" [--from file.md]
    notionctl page append <id> [--from file.md]
    notionctl page update <id> [--from file.md]
    notionctl page sync <file.md>
    notionctl db create --parent <page-id> --title "X" [--prop Name=type[:options] ...]
    notionctl db row create <db-id> [--prop Key=value ...]
    notionctl db row update <page-id> [--prop Key=value ...]
    notionctl comment add <page-id> --text "..."

Nested Markdown lists (2-space indentation) are preserved on both the
read and write paths — `page get` renders children with indentation and
`page create/update/sync` creates the corresponding nested block tree.

### Escape hatch

    notionctl api GET /users/me
    notionctl api POST /databases/<id>/query --body @filter.json

Any Notion REST endpoint is reachable via `notionctl api`.

## Inspired by

`notionctl` was written from scratch, but the design drew on patterns from:

- [4ier/notion-cli](https://github.com/4ier/notion-cli) — command taxonomy, filter DSL, `api` escape hatch
- [Coastal-Programs/notion-cli](https://github.com/Coastal-Programs/notion-cli) — structured error model
- [lox/notion-cli](https://github.com/lox/notion-cli) — `page sync` with frontmatter ID

## License

MIT. See `LICENSE`.

## Security disclosure

See `SECURITY.md` for the responsible disclosure process.