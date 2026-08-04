# Changelog

All notable changes to `notionctl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

**Content loss**
- `page update` and `page sync` deleted a page's existing blocks before writing
  the replacement, so a failure during the write (a block Notion rejected, a
  dropped connection, exhausted retries) left the page with its original
  content gone and nothing in its place. The new content is now written first.
- `page get` followed by `page sync` could delete and recreate every block on a
  page the user had not touched, permanently losing uploaded images and files.
  The written file carried one more trailing newline than the content that was
  hashed, so an unchanged file was misread as edited. This affected any page
  ending in a blank paragraph, and any page with a title and no content.
- `page update` and `page sync` now warn when the blocks being replaced contain
  nested children. The previous warning only inspected top-level blocks, so an
  image inside a toggle or callout was deleted with no warning at all.
- `db row create --from` failed outright for files producing more than 100
  blocks, creating no row. Content beyond the first 100 blocks is now written
  in a follow-up request.
- Number properties could not be cleared: `--prop Points=` wrote `0` over the
  existing value. An empty value now clears the property, matching `select`,
  `status`, and `date`.
- Prose that began with a Markdown marker was rewritten into that block on the
  next sync. A paragraph reading `---` came back as a divider with its text
  gone; `# note` became a heading, `- note` a bullet, `> note` a quote; quote
  and callout bodies beginning with a marker lost their text entirely. This
  fired on any `page sync` of a page containing such text, even one nobody had
  edited. Those lines now carry a backslash in the Markdown, removed again on
  the way back, so both the text and the block type survive. In a hand-written
  file, a line such as `\---` is now read as the text `---` rather than as a
  literal backslash followed by three dashes.
- Text containing a literal `$$` was rewritten into a rendered equation: `a $$x$$ b`
  became `a $` + an inline equation + `$ b`. The second `$` of a `$$` pair no
  longer opens an inline equation. Genuine `$x$` equations and currency amounts
  such as `$5 and $10` are unaffected.

**Write-safety flags**
- `--profile` with no value consumed the following flag as its value, so
  `page delete <id> --profile --dry-run --yes` performed a real delete. A value
  that looks like a flag is now rejected.
- `api POST|PATCH|DELETE` ignored `--dry-run` and performed the request.
- `page restore` ignored `--dry-run` and performed the request.
- `db update` removed database properties without any confirmation. Removing a
  property deletes its data in every row and cannot be undone, yet it was the
  only destructive operation with no `--yes` gate. It now requires `--yes`,
  whether the removal comes from `--remove-prop` or from a `null` value inside
  `--schema-json`. **Breaking:** scripts calling `db update --remove-prop`
  without `--yes` now exit with a usage error instead of deleting the column.

**Silent or misleading output**
- Output larger than 64 KB was truncated when piped, while still reporting
  success. Every exit path now flushes before exiting, and a reader that closes
  early (`| head`) ends the pipeline cleanly.
- Paginated reads past roughly 10,000 items reported the result as complete.
  The response now carries the real cursor and a warning is printed.
- `--filter` was silently ignored when `--filter-json` was also given. Passing
  both is now a usage error, raised before any request.
- `--filter Count=` on a number property queried for `Count == 0` instead of
  reporting an error, so an unset shell variable returned the wrong rows.
- A quoted comma in a select or multi-select option list silently produced
  malformed options: `--prop 'Severity=select:"Bug, Regression",Feature'` split
  into fragments carrying stray quote characters and created them. Option lists
  now honour quoting, so the value reaches Notion intact and is rejected with a
  clear message — Notion does not permit commas in option names — instead of
  corrupting the schema.
- `block get --format md` returned nothing for a table and other blocks whose
  content lives in their children. Children are now fetched when present.
- A response with a non-JSON body — an intercepting proxy or captive portal —
  surfaced as an internal error rather than a description of the problem.
- Retry backoff produced no output, so the CLI appeared frozen for up to a
  minute per attempt. Waits are now reported.
- Error messages could carry terminal control sequences from remote content.

**Misleading success**
- `auth clear --yes` reported success while `NOTION_TOKEN` remained set and
  still authenticated the user. It now says so.
- `--profile default` wrote a profile that no unflagged command could see,
  while `auth list` displayed it identically to the real default profile.
  `default` is now reserved.
- Interactive `auth set` appeared to hang: it waited for end-of-input, so
  pressing Enter after pasting a token did nothing. It now accepts the line.
- `file upload` discarded the upload identifier when attaching the file to a
  page failed, leaving no way to reference the uploaded file. It is now
  reported with the error.
- `file upload --dry-run` made a network request before printing its preview,
  which could stall for minutes on an unresponsive connection.
- An upload rejected by notionctl's own 20 MiB limit was reported as exceeding
  the workspace limit.
- `page create` reported success without indicating that no content was
  supplied, unlike `page append`.
- When writing content beyond the first 100 blocks failed, `page create` and
  `db row create` gave no way to find the partially-written page. `page sync`
  additionally created a duplicate page on every retry.
- `block append` omitted the guidance about connecting the integration that
  other commands show for the same error.
- A write that failed after Notion had already received it — a 5xx, a dropped
  connection, or a client-side timeout — was retried up to five times, so
  `page create`, `comment add`, `db row create` and block appends could create
  the same page, comment or blocks repeatedly while reporting a single success.
  Notion offers no way to deduplicate a repeated write, so these are no longer
  retried automatically, and the error now states that the request may already
  have been applied. `page move` is treated the same way, since Notion documents
  no retry guarantee for it. Rate-limit (429) retries are unchanged, as are
  retries for reads, property and schema updates, and deletes.

### Added
- Test coverage for each fix above, alongside the module it exercises.



## [0.1.4] — 2026-04-24

### Security
- **Confused-deputy via property-name collision in sync metadata** (high): a
  Notion DB column named `notion_id`, `notion_hash`, or `notion_synced_at`
  could overwrite the corresponding sync-metadata frontmatter key emitted by
  `page get` / `db row get`. A subsequent `page sync` would then push the
  local body to whichever page id the attacker placed in the column,
  enabling cross-workspace exfiltration or drift-check bypass between
  collaborators with shared write access. Fix: `RESERVED_FRONTMATTER_KEYS`
  is now applied when projecting Notion properties into frontmatter, so a
  colliding property is dropped instead of overwriting sync state.
- **Symlink-follow in `notionctl auth set`** (low): `saveToken` used
  `writeFile`, which follows symlinks. A same-UID local process that
  pre-planted a symlink at `~/.config/notion-cli/config.json` pointing at,
  e.g., `~/.ssh/authorized_keys` would have that file overwritten with the
  token JSON. Fix: atomic write-then-rename using `open(..., "wx", 0o600)`
  on a temp file and `rename` into place. Refuses to write through an
  existing symlink at the destination.

### Added
- 5 regression tests covering the reserved-keys guard and the symlink case
  (731 → 736).

## [0.1.3] — 2026-04-12

### Fixed
- **Column content silently dropped** (BUG-13): `page get`, `page update`,
  `page sync`, and `page find-replace` now recurse into `column_list`/`column`
  blocks. Column content is rendered as sequential paragraphs with a sidecar
  comment preserving the column_list ID. Previously, all content inside columns
  was silently lost.
- **Embed block URLs lost** (BUG-14): embed blocks now preserve their URL as a
  `[url](url)` link with a sidecar comment (same pattern as bookmarks and
  link_previews). The write path round-trips embeds back to the correct block
  type. Previously, only the block ID was kept in an HTML comment and the URL
  was dropped entirely.
- **`page get` output triggers unnecessary sync re-push** (BUG-15): `page get`
  now includes `notion_hash` and `notion_synced_at` in YAML frontmatter so
  `page get > f.md && page sync f.md` correctly detects UNCHANGED state instead
  of re-pushing all blocks.
- **`page get` DB row detection** adapted to 2025-09-03+ API: uses
  `database_id` field presence instead of `parent.type` string comparison.
- **`page update --title` in non-TTY** no longer auto-reads empty stdin,
  preventing accidental content deletion in scripts.
- **`page delete` guard ordering**: `--yes` check now runs before `--dry-run`
  so dry-run without confirmation is rejected.
- **`page sync` hosted-media warning**: CHANGED/DRIFT paths now warn before
  deleting Notion-hosted media blocks (matching `page update` behavior).
- **`page restore` / `page delete`** now show 404 hints about Connections
  instead of bare "not found" errors.
- **Indented code blocks in list items**: read path indents code fences for list
  children; write path re-associates indented fences with the parent list item.

### Added
- 7 new regression tests (706 → 713).

## [0.1.3a] — 2026-04-12

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

## [0.1.2] — 2026-04-11

### Fixed
- **Media block round-trip**: `page get → page update` no longer creates duplicate
  stub blocks for image/video/file/pdf/bookmark/link_preview. The write path
  absorbs the round-trip sidecar comment and preserves the original block type.
- **Multi-paragraph blockquote/callout formatting**: bold, italic, and links inside
  multi-paragraph blockquotes are no longer silently stripped on round-trip.
  Paragraph breaks between quote/callout children also survive round-tripping.
- **Infinite loop on whitespace-only list items**: `markdownToBlocks("- ")` no
  longer hangs. Empty-body bullets and numbered items are accepted as valid.
- **`page find-replace` now reaches all content**: previously missed text under
  toggleable headings, paragraphs with nested children, and table cells (table
  cells remain a documented limitation).
- **`page get` renders heading and paragraph children**: content nested under
  toggleable headings or deeply-appended paragraphs is no longer silently dropped.
- **`page update` H1 handling matches `page create`**: a leading H1 is only
  stripped from the body when it matches the explicit `--title` value, not
  unconditionally.
- **`page duplicate` skips Notion-hosted file blocks** with a clear warning instead
  of silently creating empty media blocks from expired signed URLs.
- **`page update` warns before deleting uploaded file attachments** that cannot be
  recreated from markdown, recommending `page append` for additive edits.
- **`page sync` warns on UNCHANGED when remote is inaccessible**: if `notion_id`
  points to a trashed page, stderr now explains instead of silently succeeding.
- **Symlink escape prevention in `page sync`**: resolves symlink targets via
  `realpath` so a symlink inside the working directory cannot redirect writes
  outside it.
- **`extractSyncTitle` fence tracking**: mixed-length fences (e.g. ```` inside a
  ````` block) no longer confuse the code-block state and promote an H1 inside
  code to the page title.
- **`replaceInRichText` skips equation and mention runs**: find-replace no longer
  rewrites equation expressions or mention references into plain-text runs.
- **CRLF normalization**: `markdownToBlocks` strips carriage returns so Windows
  line endings don't leak `\r` into Notion rich-text content.
- **Property parse for select/status/date**: empty values now send `null` (to clear
  the property) instead of `{name: ""}` which Notion rejects. Open-ended date
  ranges like `..2026-04-20` are rejected client-side with a clear message.
- **`parseColumnSpec` for select/multi_select**: trailing commas no longer create
  empty-name options; duplicate option names are rejected client-side.
- **`unique_id` render** includes the hyphen separator between prefix and number
  (TASK-42, not TASK42) matching Notion's UI.
- **Link title attributes** (`[label](url "title")`) are stripped so Notion doesn't
  reject the URL as invalid.
- **Notion-hosted media in `page get`**: uploaded files/images/videos/pdfs are now
  represented as sidecar-only markers instead of emitting ephemeral signed URLs
  that break on round-trip.

### Added
- **`--verbose` flag**: shows request count on stderr after command completion.
- **`--debug` flag**: logs HTTP method, path, and response status to stderr
  (token-scrubbed).
- 31 new regression tests (588 → 619).

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
