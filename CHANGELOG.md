# Changelog

All notable changes to `notionctl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
