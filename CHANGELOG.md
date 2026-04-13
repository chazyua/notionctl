# Changelog

All notable changes to `notionctl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] — 2026-04-12

### Fixed
- **Over-escaped markdown output**: `richTextToMarkdown` no longer backslash-
  escapes intraword underscores (`multi_select` not `multi\_select`), asterisks
  between alphanumerics (`2*3` not `2\*3`), or content inside inline code runs
  (`` `**bold**` `` not `` `\*\*bold\*\*` ``). Uses all-or-nothing strategy per
  character type to avoid context-shift bugs from selective escaping.
- **`.m4b` MIME type**: audiobook uploads now send `audio/mp4` instead of
  `application/octet-stream`.

### Added
- 9 new regression tests (722 → 731).

## [0.1.3] — 2026-04-12

### Fixed
- 50+ bugs across markdown engine, commands, and property handling from
  systematic code audits and live Notion testing.
- **Column content silently dropped**: `page get`, `page update`, `page sync`,
  and `page find-replace` now recurse into `column_list`/`column` blocks.
- **Embed block URLs lost**: embed blocks now preserve their URL on round-trip.
- **`page get` output triggers unnecessary sync re-push**: frontmatter now
  includes `notion_hash` and `notion_synced_at`.
- **`page get` DB row detection** adapted to 2025-09-03+ API changes.
- **`page update --title` in non-TTY** no longer auto-reads empty stdin.
- **`page sync` hosted-media warning**: CHANGED/DRIFT paths now warn before
  deleting Notion-hosted media blocks.
- **Media block round-trip**: `page get → page update` no longer creates
  duplicate stub blocks for image/video/file/pdf/bookmark/link_preview.
- **Multi-paragraph blockquote/callout formatting** preserved on round-trip.
- **Infinite loop on whitespace-only list items**: `markdownToBlocks("- ")`
  no longer hangs.
- **`page find-replace` now reaches all content** including toggleable headings,
  paragraphs with nested children.
- **`page duplicate` skips Notion-hosted file blocks** with a clear warning.
- **`page update` warns before deleting uploaded file attachments**.
- **Symlink escape prevention in `page sync`**.
- **CRLF normalization** in `markdownToBlocks`.
- **Property parse for select/status/date**: empty values now send `null`.
- **`parseColumnSpec`**: trailing commas no longer create empty-name options.
- **`unique_id` render** includes the hyphen separator (TASK-42, not TASK42).
- **Link title attributes** stripped so Notion doesn't reject the URL.
- **DB title update** uses PATCH instead of full schema replacement.
- **TOCTOU race in file upload** resolved with single file descriptor.

### Added
- **`--verbose` flag**: shows request count on stderr after completion.
- **`--debug` flag**: logs HTTP method, path, and status to stderr.
- 250+ new regression tests (481 → 731).

## [0.1.1] — 2026-04-10

### Added
- **Nested list support** — both read and write paths preserve 2-space indentation.
  `page create`, `page update`, `page append`, and `page sync` emit correctly
  nested block trees; `page get` pre-fetches children and renders with
  indentation.
- **`db create` command** — create a database from the CLI with
  `--prop Name=type[:options]` for text/number/checkbox/date/url/email/phone/
  people/files/select/multi_select, plus `--schema-json` for unusual types.
- **`db update` command** — rename the database, add/remove/rename columns
  via `--add-prop`, `--remove-prop`, `--rename-prop`.
- **Richer `db query` filters** — number and date comparisons (`>`, `<`,
  `>=`, `<=`), plus multi_select `contains` (comma-separated values become
  AND-of-contains).
- **Sync drift detection** — `page sync` now fetches the remote page's
  `last_edited_time` and refuses to overwrite if it's newer than the local
  `notion_synced_at`. Override with `--force`.
- **`block children --recursive`** — fetches the full block subtree.
- **`page move` command** — move a page to a new parent with
  `page move <id> --to <parent-id>`. Uses Notion's dedicated move endpoint.
- **`page duplicate` command** — deep-copy a page with all its blocks
  (including nested children) to the same or a different parent.
- **Integration-not-connected hints** — NOT_FOUND errors from page/database
  fetches now suggest checking the Notion Connections menu.

### Fixed
- `page sync` on a trashed page now gives an actionable error pointing to
  removing `notion_id` from the frontmatter instead of a bare NOT_FOUND.
- `page create` / `page append` / `page update` with markdown containing
  YAML frontmatter no longer treat the frontmatter as content blocks.
- `page get` on non-database pages now prepends `# Title` so the
  `page get → page update` round-trip preserves the title.
- `resolve` no longer crashes on URLs that include `#block-anchor`
  fragments.
- `page create`'s body no longer double-prints the title when the body
  begins with an H1 that matches `--title`.
- `block update --prop-json` and `api --body` give clean error messages
  on malformed JSON instead of an unhandled exception.

### Changed
- `USER_AGENT` in `src/http.ts` now reads from `src/version.ts`, which is
  auto-generated from `package.json` on every build.
- `--version` flag reads from the same generated constant.

## [0.1.0] — 2026-04-09

### Added
- Initial implementation of 28 Notion CLI commands (`page`, `db`, `block`, `comment`, `user`, `auth`, and meta commands)
- Zero-runtime-dependency TypeScript codebase using Node 18+ built-ins
- Markdown ↔ Notion blocks round-trip converter with metadata sidecars
- Property value DSL covering all writable Notion property types
- Content-hashed `page sync` command for idempotent file-backed pages
- Raw REST escape hatch (`notionctl api <METHOD> <path>`)
- Structured error model with typed error codes and distinct exit codes
- `--dry-run` support on all write operations

## [0.0.1] — 2026-04-09

### Added
- Initial placeholder package to reserve the `notionctl` name on npm registry
