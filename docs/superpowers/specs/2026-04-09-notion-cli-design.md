# notionctl — Design Specification

**Status:** Draft for review
**Date:** 2026-04-09
**Author:** Artem Yerep (with Claude Opus 4.6)

## 1. Purpose

Build a security-auditable command-line interface for Notion that any AI coding agent (Claude Code, GitHub Copilot, Cursor, etc.) can invoke via shell commands to read and write Notion content. The CLI is the primary bridge between AI-assisted development workflows and a team's knowledge base in Notion — pulling PRDs and documentation into the agent's context, and writing back notes, specs, and status updates without leaving the editor.

The target audience for code review and adoption is a security-conscious engineering team that currently disallows MCP servers and restricts ad-hoc API calls. The CLI must be defensible in a formal review by a CTO, security team, DevOps, and peer developers.

## 2. Core principles

In priority order:

1. **Reliability** — deterministic behavior, predictable retries, idempotent writes, no undefined states
2. **Security** — zero runtime dependencies, single file for network, single file for secrets, no telemetry, full audit trail
3. **Simplicity** — zero dep tree, readable top-to-bottom in a day, one command per operation
4. **Functionality (Reach)** — full read and write coverage of Notion's API via typed commands plus an explicit escape hatch
5. **Preciseness** — never guess, never approximate, never silently normalize; schema-driven parsing, hand-written tokenizers, content hashing for idempotency

Every design decision in this document traces back to these principles.

## 3. Non-goals

- Not an MCP server replacement for every MCP feature — only the Notion read/write capability
- Not a task manager, not a personal database viewer, not a workspace migration tool
- Not a GUI, not a TUI (beyond pretty terminal output)
- No offline mode, no local caching across invocations, no sync daemon
- No proxy support in V1 (deferred to V2 if demand materializes)
- No file upload in V1 (URLs only; local file upload deferred to V2)
- No OAuth flow in V1 (integration tokens only)

## 4. Stack and distribution

- **Language:** TypeScript, compiled with `tsc` to ES2022 targeting Node.js 18+
- **Runtime dependencies:** **zero.** Uses Node built-ins: `fetch`, `fs/promises`, `path`, `os`, `crypto`, `process`, `readline`
- **Dev dependencies:** `typescript` only
- **Build:** `tsc`, no bundler
- **Distribution:** npm, `npm install -g notionctl`
- **Binary name:** `notionctl`
- **License:** MIT
- **Repo:** public GitHub repository, `main` branch protected

## 5. Architecture

### Module layout

```
notionctl/
├── package.json              # 0 runtime deps, 1 dev dep
├── tsconfig.json
├── README.md                 # install, quick start, security pitch
├── LICENSE                   # MIT
├── SECURITY.md               # private disclosure instructions
├── CHANGELOG.md
├── src/
│   ├── index.ts              # CLI entry, arg dispatch
│   ├── http.ts               # ONLY network I/O: fetch, retry, rate limit, pagination
│   ├── auth.ts               # ONLY secrets: env → config file → error
│   ├── errors.ts             # typed error codes, suggestions, exit codes
│   ├── output.ts             # format switching, TTY detection, color
│   ├── markdown/
│   │   ├── index.ts          # public API
│   │   ├── tokenizer.ts      # rich-text tokenizer with annotation stack
│   │   ├── read.ts           # blocks → markdown
│   │   ├── write.ts          # markdown → blocks
│   │   └── types.ts
│   ├── properties/
│   │   ├── parse.ts          # "Status=Done" → Notion API shape (all ~20 types)
│   │   └── render.ts         # inverse
│   ├── sync/
│   │   ├── frontmatter.ts    # YAML front-matter read/write (minimal subset)
│   │   └── sync.ts           # page sync state machine: ID + content hash + drift
│   └── commands/
│       ├── page.ts
│       ├── db.ts
│       ├── block.ts
│       ├── comment.ts
│       ├── user.ts
│       ├── search.ts
│       └── meta.ts           # whoami, resolve, api
└── test/
    ├── markdown/             # ~50 golden-file round-trip fixtures
    ├── properties/
    ├── sync/
    ├── integration/          # live API against a disposable test workspace
    └── security/             # grep-based assertions (no token leakage)
```

### Boundaries

- **`http.ts`** is the only file that makes network calls. Every command funnels through it.
- **`auth.ts`** is the only file that reads the token from disk or env.
- **`markdown/`** has no dependencies on `commands/` or `http.ts` — pure transformation, fully unit-testable.
- **`properties/`** depends on the schema fetched via `http.ts` but is otherwise pure.
- **`commands/`** files are thin: parse flags, call `http.ts`, pipe result through `markdown/` or `properties/`, print via `output.ts`.

### Line budget

Approximate hand-audited surface: **~3,500–4,000 lines of TypeScript**, zero runtime deps. Readable in a day.

## 6. Command surface

All commands support global flags: `--format md|json|table|csv`, `--dry-run`, `--verbose`, `--quiet`, `--no-color`, `--debug`, `--yes`.

### Meta and escape hatches
| Command | Purpose |
|---|---|
| `notionctl whoami` | Integration identity + shared resources (for verification) |
| `notionctl resolve <url>` | Notion URL → ID |
| `notionctl search <query> [--type page\|db]` | Search pages/DBs by title or content |
| `notionctl api <METHOD> <path> [--body @file.json]` | Raw REST escape hatch — any Notion API endpoint |

### Pages
| Command | Purpose |
|---|---|
| `notionctl page get <id> [--depth N] [--include-children]` | Full page as Markdown + YAML front-matter |
| `notionctl page create --parent <id> --title "X" [--from file.md]` | Create new page |
| `notionctl page append <id> [--from file.md \| stdin]` | Append blocks |
| `notionctl page update <id> [--from file.md]` | Replace body (preserves pass-through blocks) |
| `notionctl page sync <file.md>` | Round-trip with frontmatter ID + content hash |
| `notionctl page delete <id>` | Archive (not hard delete) |

### Databases
| Command | Purpose |
|---|---|
| `notionctl db query <id> [--filter "Status=Done"] [--sort "Date:desc"] [--filter-json @f.json]` | Query with filters/sorts |
| `notionctl db schema <id>` | Show property types (agent reads before writing) |
| `notionctl db row get <page-id>` | Single row (properties + body) |
| `notionctl db row create <db-id> [--prop "Name=X" ...] [--from file.md]` | New row |
| `notionctl db row update <page-id> [--prop "Status=Done"]` | Update properties |
| `notionctl db row delete <page-id>` | Archive row |

### Blocks (surgical edits)
| Command | Purpose |
|---|---|
| `notionctl block get <id>` | Single block |
| `notionctl block children <id>` | List children |
| `notionctl block append <id> [--from file.md]` | Append to block |
| `notionctl block update <id>` | Update single block |
| `notionctl block delete <id>` | Delete single block |

### Comments
| Command | Purpose |
|---|---|
| `notionctl comment list <page-id>` | All comments |
| `notionctl comment add <page-id> --text "..."` | New comment |

### Users
| Command | Purpose |
|---|---|
| `notionctl user list` | All users |
| `notionctl user me` | Integration user |

### Auth
| Command | Purpose |
|---|---|
| `notionctl auth set` | Write token to config (stdin, never echoes) |
| `notionctl auth status` | Verify token validity, never displays it |
| `notionctl auth clear` | Delete config file (requires `--yes`) |

Total: **~28 commands** across seven noun groups, plus the `api` escape hatch.

## 7. Markdown converter (the hardest piece)

### Flavor

GitHub Flavored Markdown plus three extensions:
- **YAML front-matter** for database properties and `sync` metadata (`notion_id`, `notion_hash`)
- **GFM Alerts** (`> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, etc.) for Notion callouts
- **HTML `<details>`** for toggles (round-trips cleanly, LLMs parse it)

Blocks we can't express natively become HTML comments with the block ID preserved: `<!-- notion-block: synced_block id=abc -->`. On write-back this is the **pass-through safety net** — blocks we don't touch cannot be destroyed.

### Block coverage matrix

| Block type | Markdown form | Round-trip |
|---|---|---|
| paragraph | plain text | **lossless** |
| heading_1/2/3 | `#`, `##`, `###` | **lossless** |
| bulleted_list_item | `- text` | **lossless** |
| numbered_list_item | `1. text` | **lossless** |
| to_do | `- [ ]` / `- [x]` | **lossless** |
| quote | `> text` | **lossless** |
| divider | `---` | **lossless** |
| code (with language) | ` ```lang ` fences | **lossless** |
| callout | `> [!NOTE]` body + `<!-- icon: 💡 -->` + `<!-- color: blue_background -->` sidecar comments | **lossless** (icon, body, color preserved via sidecars; default `NOTE` type maps to bare `[!NOTE]`) |
| toggle (with children) | `<details><summary>...</summary>...</details>` | **lossless** |
| table (GFM) | header + separator + rows | **lossless** |
| equation | `$$...$$` | **lossless** |
| rich-text mentions (user/page/date) | `@user`, `[page](notion://page/<id>)`, `<2026-04-15>` | **lossless** |
| bookmark / link_preview | `[title](url)` + caption line | near-lossless |
| image / video / file / pdf | `![caption](url)` + HTML comment with block type | near-lossless |
| child_page / child_database | `[title](notion://page/<id>)` | near-lossless |
| synced_block, column_list, column, embed | HTML comment with block ID | **pass-through** (preserved on update, not editable via MD) |
| any other / future block type | `<!-- notion-block: <type> id=... -->` | **pass-through** |

**Round-trip definitions:**
- **Lossless:** bytes→bytes identical after round-trip (modulo whitespace normalization)
- **Near-lossless:** semantic content preserved, cosmetic metadata may drift
- **Pass-through:** not edited via Markdown, but on `page update` their HTML-comment markers match against existing blocks by ID and are left untouched — they cannot be destroyed by a local edit

### Rich-text tokenizer

Notion's `rich_text` is a flat array of annotated runs:
```json
[{"text": "bold", "annotations": {"bold": true, "italic": false}, ...}]
```

Markdown's annotations nest: `**bold _italic_**`. Converting in either direction naively produces bugs like `**a**_b_**c**` instead of `**a _b_ c**`. All four prior-art repos have this bug.

**Read path (blocks → md):** walk the run array with a stack of open annotations. Open a new marker when an annotation first appears on the next run, close it when it drops off. Emit link markers innermost, because links can contain other annotations but not vice versa.

**Write path (md → blocks):** hand-written tokenizer, NOT regex. Walks the Markdown character by character with the same stack. Regex approaches fail on edge cases like backticks inside links or nested `**bold _italic_ [link](url)**`.

**Test density:** ~30 golden-file fixtures covering every annotation combination, including degenerate cases (`_italic_**bold**`, `**[link](url)**`, `` `code with **stars**` ``, `**bold _italic **bold**_**`).

### Database page properties as YAML front-matter

```markdown
---
notion_id: abcd1234-5678-90ab-cdef-123456789012
notion_hash: sha256:9f2b8e7d...
Title: "Implement user auth"
Status: In Progress
Priority: High
Tags: [backend, security]
Assignee: "@alice"
Due: 2026-04-15
Points: 8
---

# Body as normal markdown
```

- Read: property values come out as correctly-typed YAML
- Write: minimal YAML reader (our own) parses the subset we support (strings, numbers, booleans, ISO dates, flow sequences). No full YAML 1.2 — keeps the zero-dep promise.
- Unknown front-matter keys on update are preserved unchanged
- Read-only property types (`formula`, `rollup`, `created_time`, etc.) appear in front-matter on read but are silently dropped on write — the writer filters front-matter against the schema before PATCH

### `page sync` state machine

`notionctl page sync file.md`:
1. **First run:** create page, write `notion_id` and `notion_hash` (sha256 of body) into front-matter, save file
2. **Unchanged run:** compute local sha256, compare to `notion_hash` — if equal, **no-op** (idempotent, satisfies the preciseness + reliability principles)
3. **Changed run:** fetch remote block tree, diff against new block tree, POST minimum change set, preserve pass-through blocks by ID match, update `notion_hash`
4. **Drift (remote edited since last sync):** error by default. `--force` overwrites remote; `--merge` attempts a three-way merge (V2 — V1 errors with suggestion)

## 8. Property value DSL

### Core form

Repeatable `--prop "Key=value"` flag on `db row create` / `db row update`. Escape hatch: `--prop-json '<raw Notion API shape>'`.

Before parsing flags, the CLI fetches the DB schema (`GET /v1/databases/<id>`) and builds a `property name → type` map. Unknown property names fail fast with "did you mean…" suggestion.

### Value syntax per type

**Writable (14 types):**

| Type | Flag example | Notes |
|---|---|---|
| title / rich_text | `Title="Implement auth"` | Plain string; rich formatting via `--from file.md` |
| number | `Points=8` or `Points=8.5` | Parsed as number |
| select / status | `Status=Done` / `Status="In Progress"` | Quote for spaces |
| multi_select | `Tags=[backend,security]` / `Tags=["has, comma","other"]` | Brackets; quoted values for commas/spaces |
| date | `Due=2026-04-15` / `Due=2026-04-15..2026-04-30` / `Due=2026-04-15T10:00:00Z` | ISO 8601; `..` for ranges |
| checkbox | `Done=true` / `Done=false` | |
| url / email / phone | `Website="https://..."` | String |
| people | `Assignee=@alice` / `Assignees=[@alice,@bob]` / `Assignee=user:<uuid>` | `@name` resolved via user list; `user:` is canonical |
| files | `Attachment=url:"https://..."` | V1: URLs only. `file:./local.pdf` upload → V2 |
| relation | `Blocks=[page:<uuid>]` / `Blocks=[title:"Other page"]` | `page:` is canonical; `title:` does search-resolve |

**Read-only (7 types):** `formula`, `rollup`, `created_time`, `created_by`, `last_edited_time`, `last_edited_by`, `unique_id`. Appear in front-matter on read, silently dropped on write.

### Canonical forms vs shortcuts

- `user:<uuid>`, `page:<uuid>`, `url:"..."`, `file:...` are **canonical, deterministic, network-free** forms
- `@name`, title lookups, and bare values are **ergonomic shortcuts** that resolve to canonical form before the API call (with a network round-trip for `@name` and `title:`)
- Scripts and agents should prefer canonical forms for predictability

### Escape hatch

`--prop-json '<JSON>'` bypasses the DSL entirely and passes the raw Notion property shape. Use for property types Notion adds in the future or exotic edge cases the DSL doesn't express.

Between `notionctl api` (any REST endpoint) and `--prop-json` (any property shape), there is no Notion capability the CLI cannot reach.

## 9. HTTP layer

Single exported function in `src/http.ts`: `notion(method, path, body?) → Promise<response>`.

**Behavior:**
- Base URL **hardcoded** to `https://api.notion.com/v1`. No `--api-base` flag (token-exfiltration footgun).
- **HTTP refused.** Only `https://api.notion.com` allowed. Hardcoded check before each request.
- Headers: `Authorization: Bearer <token>`, `Notion-Version: 2022-06-28` (pinned), `Content-Type: application/json`, `User-Agent: notionctl/<version>`
- **Timeouts:** 30s per request. Configurable via `NOTION_TIMEOUT_MS` env var (not a flag — keeps CLI surface clean).
- **Retries:** exponential backoff (250ms, 500ms, 1s, 2s, 4s) for 429, 5xx, network errors. Max 5 attempts. Respects `Retry-After` header.
- **Pagination:** transparent auto-pagination for `databases/<id>/query` and `blocks/<id>/children`. `--max-pages N` flag caps expansion.

**Does NOT do:** caching (on-disk or otherwise), request logging to disk, proxy support (V1), environment-conditional behavior. Stateless, deterministic, zero incidental disk writes.

**Reliability guarantees:**
- Every call either returns parsed data or throws a typed error — no undefined states
- Retry sequence is deterministic given inputs
- Pagination is complete by default; partial results require an explicit flag

## 10. Authentication

**Token source priority:**
1. `NOTION_TOKEN` environment variable
2. `$XDG_CONFIG_HOME/notion-cli/config.json` (fallback `~/.config/notion-cli/config.json`), file mode 0600, dir mode 0700
3. Clear error with suggestion to set env var or run `notionctl auth set`

**Commands:**
- `notionctl auth set` — reads token from stdin (never echoes), writes config with 0600. Warns if file exists.
- `notionctl auth status` — calls `/v1/users/me`, shows integration name + workspace, **never shows the token**
- `notionctl auth clear` — deletes config file, requires `--yes` or interactive confirmation

**Non-negotiables:**
- Token is never logged, never in error messages, never in `--verbose` output, never in stack traces
- `http.ts` is the only file that reads the token and attaches it to the header
- `auth.ts` is the only file that touches disk for the token
- No other file or code path sees the token
- No temp files, no request logs, no crash dumps containing secrets
- No telemetry, no phone-home, no analytics, no crash reporting
- The CLI's only outbound traffic is to `api.notion.com`. Provable by grep.

## 11. Error model

Every error thrown in the system is typed:

```ts
type NotionCliError = {
  code: ErrorCode;          // enum
  message: string;          // templated, never contains secrets
  suggestions?: string[];   // actionable recovery steps
  exit_code: number;        // process exit code
  cause?: unknown;          // underlying error if relevant (scrubbed)
};
```

### Exit code taxonomy

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure (catch-all) |
| 2 | Usage error (wrong flags, bad arguments) |
| 3 | Auth error (missing or invalid token) |
| 4 | Not found (page/db/block doesn't exist or not shared with integration) |
| 5 | Permission denied (integration lacks capability) |
| 6 | Rate limited (after retry budget exhausted) |
| 7 | Network error (DNS, connect, TLS) |
| 8 | Notion API error (5xx, non-retryable 4xx) |
| 9 | Validation error (property parse, schema mismatch, bad Markdown) |

### Formats

- **TTY output:** colored human message on stderr, suggestions as a bulleted list below
- **Piped or `--format json`:** structured JSON on stderr: `{"error": {"code": "...", "message": "...", "suggestions": [...]}}`
- Exit code is always set regardless of format

Agents parse the JSON form for automated recovery; humans read the colored form during development.

## 12. Output formatting

### Defaults by command

| Command class | TTY default | Piped default |
|---|---|---|
| `page get` | md (front-matter + body) | md |
| `search`, `ls`, `db query`, lists | table | json |
| `page create/append/update/sync` | human status line | json result |
| `whoami`, `auth status` | human | json |

Auto-detected via `process.stdout.isTTY`. When piped, output is **always** machine-parseable. When TTY, it's pretty. No halfway.

### Flags

- `--format md|json|table|csv` — override default
- `--no-color` — force plain output
- `--quiet` — suppress non-essential output
- `--verbose` — request counts (never bodies, never tokens)
- `--debug` — full HTTP debug on stderr (scrubbed: `Authorization: Bearer ***`)

## 13. Security posture

| Area | Measure |
|---|---|
| Supply chain | Zero runtime dependencies. One dev dep (`typescript`). ~4,000 lines of hand-audited TypeScript |
| Network | `http.ts` is the only file with outbound I/O. Base URL hardcoded. HTTPS-only. No proxy. System cert store |
| Secrets | `auth.ts` is the only file that touches the token. Mode-0600 config. Env var priority. Never logged, never in errors |
| Input validation | Schema-driven property parsing. Hand-written tokenizers (no regex pitfalls). Strict ISO-8601 dates. Input never silently normalized |
| Output safety | Token never reflected into stdout/stderr/logs. Error messages templated, not format-stringed with user input |
| Destructive operations | `--dry-run` is universal. `page delete`, `db row delete`, `auth clear` require `--yes` or interactive confirmation |
| Idempotency | `page sync` with SHA-256 content hash. Re-running is a provable no-op if nothing changed |
| Auditability | Every command is a discrete shell invocation. `--verbose` shows request counts (not bodies) for replay confirmation |
| No phone-home | Zero outbound traffic except `api.notion.com`. Provable by grep across the source tree |
| Reproducible releases | Source SHA-256 published with each release; users verify against the GitHub tag |
| Preciseness | Never silently normalizes data. No auto-trim, no quote conversion, no newline munging beyond Notion requirements. Deterministic in, deterministic out |

## 14. Testing strategy

### Unit tests (no network)

Target 90%+ coverage on hot files (`markdown/`, `properties/`, `http.ts`, `auth.ts`).

- **Markdown round-trip golden files:** ~50 fixtures covering every block type, every annotation combination, every rich-text edge case
- **Property DSL parser:** every property type, every shortcut form, every escape hatch
- **Rich-text tokenizer:** nested annotations, backticks in links, links in callouts, equations
- **YAML front-matter:** all supported types, edge cases (empty values, special characters, multi-line strings)
- **Error message templates:** every error code produces a valid structured envelope

### Integration tests (live API)

- Disposable test workspace shared with a dedicated integration token
- Every command's happy path
- Rate-limit retry behavior (stress test)
- Pagination completeness (large databases)
- `page sync` state machine (create → unchanged → changed → drift)

### Security tests

- Grep-based assertions that no test output contains the token
- Runtime checks that no file is written outside the config dir and the sync target file
- Static check: only `http.ts` imports `fetch` (enforced in CI)
- Static check: only `auth.ts` reads from the config path (enforced in CI)

### CI

- **On every PR:** lint, type-check, unit tests, security tests
- **Nightly:** integration tests against the test workspace (token as GitHub Actions secret, never exposed in PR env)
- **On tag:** build, publish to npm, generate SHA-256 checksum, attach to GitHub release

## 15. Distribution

### Package

- **Name:** `notionctl` (kubectl-style). Fallback if taken on npm: scoped `@<npm-handle>/notionctl`. Verify availability in the first implementation task.
- **Binary:** `notionctl`
- **License:** MIT
- **Versioning:** SemVer. `0.x.y` during internal pitch phase (API may change). Promote to `1.0.0` after security team sign-off.
- **Notion-Version header:** pinned to `2022-06-28`. Bumping is an explicit minor release after re-testing.

### Repository

- Public GitHub, `main` branch protected, PRs required
- Files at root: `README.md`, `LICENSE`, `SECURITY.md`, `CHANGELOG.md`
- Issue templates: bug, feature, security (security routes to private disclosure)
- `CONTRIBUTING.md`: V2

### Prior art attribution

README has an "inspired by" section crediting:
- **4ier/notion-cli** — command taxonomy, filter DSL, `api` escape hatch pattern
- **Coastal-Programs/notion-cli** — structured error model, exit code taxonomy
- **lox/notion-cli** — `page sync` with frontmatter-ID round-trip

We write our own code; these repos influenced the shape.

### Channels

- **V1:** npm only (`npm install -g notionctl`)
- **V2:** Homebrew tap if demand materializes

## 16. Rollout

1. **Build V1 on personal computer** against personal Notion workspace
2. **Internal testing:** verify every command against the test workspace, run security tests, write the security pitch document
3. **Public release:** npm publish, GitHub release with SHA-256
4. **Pitch to work management:** present the CLI, the security posture, the audit surface. Ask for:
   - Permission to install on work dev machines
   - A workspace admin to create an integration token for the work Notion workspace
5. **Work integration:** install via npm, configure with work token, use in VS Code Copilot / Claude Code workflows

If work management declines, the V1 is still useful against personal Notion and is publicly available for anyone else in the same situation.

## 17. Open questions (to resolve during implementation)

- **Package name availability on npm.** If `notionctl` is taken, fall back to scoped `@<handle>/notionctl`. Check as the first implementation step.
- **YAML reader scope.** Minimal subset (strings, numbers, booleans, ISO dates, flow sequences) is the target. If implementation reveals more is needed (block scalars, anchors), decide whether to expand the subset or restrict front-matter input.
- **`page sync --merge` three-way merge.** V1 errors on drift. V2 may add a proper three-way merge. Design the error flow in V1 so V2 can extend it without breaking changes.

## 18. Success criteria

V1 is successful when:

- All 28 commands work against a real Notion workspace
- Markdown round-trip is lossless for all block types marked "lossless" in Section 7
- The security test suite passes with zero findings
- The codebase is under 4,500 lines of TypeScript (audit budget)
- Zero runtime dependencies in `package.json`
- `npm install -g notionctl` works on a clean machine
- A security-conscious reviewer can read the entire source tree in a day and produce a written assessment
