# Test Plan

Comprehensive test scenarios for notionctl. Use this for manual dogfooding, regression testing, and as the source of truth for automation coverage.

**Legend:** [A] = automated, [M] = manual only

---

## 1. Authentication

### 1.1 Token via Environment Variable
- [A] `NOTION_TOKEN` env var is loaded and used for API calls
- [A] Env var takes precedence over config file when both exist
- [M] Unsetting `NOTION_TOKEN` falls back to config file seamlessly

### 1.2 Token via `auth set`
- [A] Token read from stdin is saved to `~/.config/notion-cli/config.json`
- [A] Config file created with mode 0600 (owner read/write only)
- [A] Config directory created with mode 0700
- [M] Interactive prompt appears when stdin is a TTY
- [M] Piped token (`echo "ntn_..." | notionctl auth set`) works without prompt
- [M] Empty input produces a clear error, not a silent write

### 1.3 OAuth Login (`auth login`)
- [A] Missing `--client-id` or `--client-secret` produces USAGE error with setup instructions
- [A] Token exchange sends correct Basic auth header (`base64(client_id:client_secret)`)
- [A] HTTP error from Notion during token exchange surfaces the error message
- [A] Missing `access_token` in exchange response produces clear error
- [M] Browser opens to Notion authorization page automatically
- [M] Authorize URL printed to stderr as fallback if browser doesn't open
- [M] Selecting pages and clicking "Allow access" redirects to localhost callback
- [M] Token is saved and `auth status` confirms it works
- [M] CSRF: callback with mismatched `state` parameter is rejected
- [M] User clicking "Cancel" on Notion auth page returns an error
- [M] Timeout after 5 minutes if no callback received
- [M] `--port` flag overrides the default port 9876
- [A] Port already in use produces a clear error (not a crash)
- [M] Redirect URI in integration settings must match `http://localhost:<port>/callback` exactly

### 1.4 Profiles
- [M] `auth set --profile staging` saves to `config-staging.json`
- [M] `--profile staging` on any command uses the staging token
- [M] `NOTION_PROFILE=staging` env var selects profile
- [M] `auth list` shows all configured profiles
- [M] `auth clear --yes` removes the active profile's config file
- [M] `auth clear` without `--yes` is refused

### 1.5 Auth Doctor
- [M] Reports token source (env var vs config file)
- [M] Reports config file permissions (pass/fail for 0600)
- [M] Reports API connectivity and integration name
- [M] Reports workspace name
- [M] Reports page access (at least one page accessible)
- [M] Warns when integration has no page connections
- [M] Fails gracefully when token is invalid (shows which checks failed)
- [A] Exits 3 when any check fails, 0 when all pass; the full report prints either way
- [A] Warnings alone do not fail the command
- [A] `auth status` exits 3 on an invalid token and 0 on a valid one, keeping its JSON shape

### 1.6 Security Invariants
- [A] Config file with permissive mode (e.g., 0644) is refused
- [A] `XDG_CONFIG_HOME` is respected for config location
- [A] Token never appears in error messages or stdout
- [M] Token is not visible in `--debug` output (scrubbed)

---

## 2. Pages

### 2.1 page get
- [M] Returns Markdown with YAML front-matter for database pages
- [M] Returns `# Title` heading for non-database pages
- [M] Nested lists render with 2-space indentation
- [M] Code blocks include language annotation
- [M] Tables render as GFM tables
- [M] Toggle blocks render as `<details>` with nested children
- [M] Callout blocks render children as continuation `>` lines
- [M] Quote blocks render children as continuation `>` lines
- [M] `--format json` returns raw Notion API response
- [M] Notion URL accepted as ID (auto-resolved)
- [A] 404 for non-existent page with "Connections" hint

### 2.2 page create
- [M] Creates page with `--title` under `--parent` (detects database vs page parent)
- [M] Database ID as `--parent` creates a database row with correct parent key
- [M] `--from file.md` creates page with Markdown body
- [M] Frontmatter in input is stripped (doesn't become page content)
- [M] Stdin pipe works: `echo "content" | notionctl page create --parent <id> --title "X"`
- [M] Duplicate H1 matching `--title` is stripped from body
- [M] `--dry-run` shows payload without creating
- [M] Missing `--parent` or `--title` produces USAGE error

### 2.3 page append
- [M] Appends Markdown blocks to existing page
- [M] `--from file.md` reads content from file
- [M] `--from -` reads from stdin explicitly
- [M] Piped stdin read automatically without `--from` when stdin is not a TTY
- [M] Frontmatter in input is stripped (doesn't become page content)
- [M] Empty input returns warning instead of silent no-op
- [M] `--dry-run` shows blocks without appending

### 2.4 page update
- [M] `--from file.md` replaces all body blocks
- [M] `--title "New"` updates only the title
- [M] Both `--title` and `--from` together updates both
- [M] All existing blocks are replaced with new content
- [M] H1 in file used as title when `--title` not provided
- [M] `--dry-run` shows block count without modifying
- [M] No flags produces USAGE error

### 2.5 page sync
- [M] First sync with `--parent` creates page and writes `notion_id` to frontmatter (detects database vs page parent)
- [M] Second sync with no local changes is a no-op (UNCHANGED)
- [M] Local edit triggers update (CHANGED)
- [M] Remote edit in Notion after last sync triggers DRIFT error
- [M] `--force` overrides drift protection
- [M] `notion_hash` in frontmatter is SHA-256 of content
- [M] `notion_synced_at` timestamp updated after each sync
- [M] First sync without `--parent` produces USAGE error
- [M] Trashed page produces clear error with recovery instructions
- [A] Front-matter that fails to parse is refused, not treated as a new file —
      no duplicate page is created and the original keeps its `notion_id`
- [A] `page create/append/update`, `db row create` and `block append` refuse a
      file whose front-matter will not parse, rather than writing the YAML onto
      the page as content; the error names the offending line
- [A] A file with no front-matter, or an unclosed `---` opener, still creates
- [A] A `notion_id` that is blank, `null`, `~` or a number is refused, not
      treated as a first sync
- [A] Front-matter behind a UTF-8 BOM is read normally, not ignored
- [M] A file opening with a `---` horizontal rule is refused; `***` works instead
- [M] `--dry-run` shows sync state without modifying

### 2.6 page find-replace
- [M] Replaces text in paragraphs, headings, lists, quotes, callouts, toggles
- [M] Replaces text in page title
- [M] Recurses into nested blocks
- [M] Reports match count and blocks modified (including title matches)
- [M] `--dry-run` shows what would change without modifying
- [M] Missing `--find` or `--replace` produces USAGE error
- [M] No matches reports 0 without error

### 2.7 page duplicate
- [M] Creates deep copy with all nested blocks
- [M] Default title is "Original (copy)"
- [M] `--title` overrides copy title
- [M] `--parent` places copy under a different parent
- [M] Without `--parent`, copies to same parent (including database rows)
- [M] Database row duplicate copies all writable properties (select, number, etc.)
- [M] Workspace root page without `--parent` produces USAGE error
- [M] `--dry-run` shows payload without creating

### 2.8 page move
- [M] Moves page to new parent
- [M] `--to` is required
- [M] `--dry-run` shows payload without moving

### 2.9 page open
- [M] Opens page URL in default browser (macOS: `open`, Linux: `xdg-open`)
- [M] Accepts Notion URL or UUID as input
- [M] 404 for non-existent page

### 2.10 page restore
- [M] Restores a previously archived/trashed page
- [M] Returns page ID and URL on success

### 2.11 page delete
- [M] Archives page (soft delete) with `--yes`
- [M] Refuses without `--yes`
- [A] `--yes false` is a usage error, not a confirmation — same for
      `block delete`, `api DELETE`, `db row delete`, `db update --remove-prop`
      and `auth clear`
- [A] Any unexpected extra argument is refused, not just boolean-looking ones
- [A] `--yes=false` declines; `--yes` alone still confirms
- [A] Free-text positionals after a boolean flag still work (`search --verbose n`)

---

## 3. Databases

### 3.1 db create
- [M] Creates database with title column (Name) by default
- [M] `--prop Status=select:Todo,Doing,Done` adds select column with options
- [M] Supports: text, number, checkbox, date, url, email, phone, people, files, select, multi_select
- [M] `--schema-json @file.json` for complex schemas
- [M] `--dry-run` shows payload
- [M] Missing `--parent` or `--title` produces USAGE error

### 3.2 db update
- [M] `--title` renames the database
- [M] `--add-prop Name=type` adds a column
- [M] `--remove-prop Name --yes` removes a column
- [M] `--remove-prop Name` without `--yes` is refused, and the column survives
- [M] `--schema-json` containing a `null` without `--yes` is refused
- [M] `--dry-run` does not bypass the `--yes` requirement
- [M] `--rename-prop Old=New` renames a column
- [M] Multiple operations in one command
- [M] No flags produces USAGE error
- [M] `--dry-run` shows payload

### 3.3 db query
- [M] Returns all rows with no filter
- [M] `--filter "Status=Done"` filters by select
- [M] `--filter "Count>=10"` filters by number comparison
- [M] `--filter "Due>2026-04-01"` filters by date
- [M] `--filter "Tags=urgent,important"` AND filter on multi_select
- [A] Multiple `--filter` flags combined with AND
- [M] `--sort "Date:desc"` sorts descending
- [M] `--sort "Date:asc"` sorts ascending (default)
- [M] `--filter-json @file.json` for complex Notion filter objects
- [M] `--format table` renders aligned columns (default TTY)
- [M] `--format csv` renders comma-separated output
- [M] `--format json` returns raw API response
- [M] Unknown property in filter produces INVALID_PROPERTY error
- [M] Unknown property in sort produces INVALID_PROPERTY error
- [M] Invalid operator for type (e.g., `>` on select) produces USAGE error
- [A] All filter operators map to correct Notion API filter objects
- [A] Non-numeric value in number filter is rejected
- [A] Column spec parser handles all supported types

### 3.4 db schema
- [M] Shows property names and types
- [M] `--format json` returns raw schema

### 3.5 db row get
- [M] Returns row as Markdown with property front-matter
- [M] `--format json` returns raw API response

### 3.6 db row create
- [M] `--prop "Name=Ship v2" --prop "Status=Todo"` sets typed properties
- [M] `--from body.md` attaches Markdown content to the row (frontmatter stripped)
- [M] `--from -` reads body from stdin
- [M] `--dry-run` shows payload
- [M] Unknown property name in `--prop` produces error

### 3.7 db row update
- [M] `--prop "Status=Done"` updates a property
- [M] Multiple `--prop` flags in one command
- [A] `people` and `relation` accept several ids separated by commas, with or
      without square brackets, instead of collapsing them into one bad id
- [A] An empty value clears `people` and `relation`, as it does `multi_select`
- [A] A people/relation value missing its `user:`/`page:` prefix names the
      offending item and shows the accepted forms
- [M] `--prop "Assignee=user:<id>,user:<id>"` is accepted by the live API
- [M] `--dry-run` shows payload

### 3.8 db row delete
- [M] Archives row with `--yes`
- [M] Refuses without `--yes`

---

## 4. Blocks

### 4.1 block get
- [M] Returns block JSON by default
- [M] `--format md` returns Markdown rendering

### 4.2 block children
- [M] Lists direct children as Markdown
- [M] `--recursive` fetches full subtree
- [M] `--format json` returns raw block array
- [M] 404 with Connections hint for inaccessible blocks

### 4.3 block append
- [M] Appends Markdown blocks to a page or block
- [M] `--from file.md` reads from file
- [M] Stdin pipe works
- [M] `--after <block-id>` inserts at specific position
- [M] `--dry-run` shows blocks
- [M] Empty input returns warning instead of silent no-op

### 4.4 block update
- [M] `--prop-json` patches block with raw Notion JSON
- [M] Invalid JSON produces USAGE error
- [M] `--dry-run` shows payload

### 4.5 block delete
- [M] Deletes block with `--yes`
- [M] Refuses without `--yes`

---

## 5. Files

### 5.1 file upload
- [M] Uploads file and returns upload ID
- [M] `--parent <page-id>` creates image block for images (PNG, JPG, GIF, WebP, SVG)
- [M] `--parent <page-id>` creates file block for non-images (PDF, CSV, etc.)
- [M] File not found produces clear error
- [M] Empty file is rejected
- [M] `--dry-run` shows file info without uploading
- [M] Correct MIME type detected from extension
- [M] Unsupported extension (e.g. `.ts`, `.py`, `.go`) auto-renamed to `.ext.txt` with stderr warning
- [M] Supported extensions (see `NOTION_SUPPORTED_EXTENSIONS` in `file.ts`) upload unchanged
- [M] Files with no extension (e.g. `Dockerfile`) fall back to `.txt`
- [M] Output includes `originalName`, `uploadName`, and `fallback: true` when renamed

---

## 6. Comments

- [M] `comment list <page-id>` returns all comments as JSON
- [M] `comment add <page-id> --text "..."` creates a comment
- [M] Markdown formatting in comment text (bold, links) is converted to rich text
- [M] `--dry-run` shows payload without posting
- [M] Missing `--text` produces USAGE error

---

## 7. Users

- [M] `user list` returns all workspace members with ID, name, type
- [M] `user list --format csv` returns CSV output
- [M] `user me` returns the integration bot object as JSON

---

## 8. Meta Commands

### 8.1 whoami
- [M] Shows integration name and owner in table format
- [M] `--format json` returns full bot object

### 8.2 search
- [M] Returns matching pages and databases
- [M] Multi-word query joins all positional args (no quoting needed)
- [M] `--type page` filters to pages only
- [M] `--type db` filters to databases only
- [M] No results shows hint about Connections
- [M] `--format csv` returns CSV

### 8.3 resolve
- [M] Notion URL converts to hyphenated UUID
- [M] URL with slug (e.g., `My-Page-abc123...`) extracts ID correctly
- [A] Multi-segment URLs parsed correctly
- [A] Already-formatted UUIDs pass through unchanged
- [A] Compact hex (no dashes) normalized to UUID format
- [M] Invalid input produces USAGE error

### 8.4 api (escape hatch)
- [M] `api GET /users/me` returns raw API response
- [M] `api POST /search --body '{"query":"test"}'` sends body
- [M] `--body @file.json` reads body from file
- [M] Invalid JSON in `--body` produces USAGE error
- [M] Missing method or path produces USAGE error

---

## 9. Markdown Engine

### 9.1 Read: Notion to Markdown
- [A] Paragraphs, headings (H1-H3), bold, italic, strikethrough, inline code, links
- [A] Bullet lists, numbered lists, to-do lists (checked/unchecked)
- [A] Nested lists at 1, 2, and 3 levels with correct indentation
- [A] A list item's non-list children (paragraphs, code) are indented to the item's
      body column so they stay attached when written back
- [A] Code blocks with language annotation
- [A] GFM tables with header row
- [A] Blockquotes, callouts (with emoji and color), toggles — all with nested children
- [A] Dividers, images (with caption), equations
- [A] Synced blocks, column lists, unknown types pass through as HTML comments
- [A] Adjacent list items grouped without extra blank lines
- [A] Round-trip: blocks→markdown→blocks preserves types, annotations, nesting, and content
- [A] Prose beginning with a block marker (`---`, `# `, `- `, `> `, `1. `, `$$`,
      `<details>`) is shielded with a backslash and comes back as the same
      paragraph with the same text — including quote and callout bodies
- [A] Shielding is idempotent: repeated syncs do not accrete backslashes, and
      text that legitimately starts with a backslash keeps it
- [M] A page with a paragraph reading exactly `---` survives `page get` →
      `page sync` without becoming a divider

### 9.2 Write: Markdown to Notion
- [A] All block types above, reverse direction
- [A] Nested lists via 2-space indentation produce correct `children` arrays
- [A] `has_children` flag set correctly on parent vs leaf blocks
- [A] No `id` field on newly created blocks
- [A] GFM alert syntax (`> [!NOTE]`) becomes callout block
- [A] HTML `<details>` becomes toggle block with body content as children
- [A] Multi-line `<details>` with `<summary>` on separate line parsed correctly
- [A] Inline `<details>...<summary>...</summary>...</details>` does not consume next block
- [A] `![alt](url)` on its own line becomes Notion image block
- [A] Multi-paragraph blockquotes preserve line breaks (not collapsed to single line)
- [A] Setext headings: `Title`+`===` becomes H1, `Title`+`---` becomes H2, and the
      underline never appears in the text
- [A] `---` separated from prose by a blank line, and `***` in any position, stay
      dividers
- [A] Content indented under a list item (paragraph, quote, code fence) becomes a
      child of that item, including when a deeper nested item sits between them
- [A] A line wrapped without a blank line folds into the item's own text
- [A] Nesting depth is counted across toggles, quotes, callouts and lists together
      and never exceeds two levels below the top level; over-deep content is
      promoted, not dropped, and a single warning is emitted
- [A] A table is promoted one level earlier than other blocks, since its rows
      occupy a level
- [A] A list item's continuation keeps its position relative to the item's nested
      children
- [A] A heading whose `rich_text` contains a line break stays one heading, with the
      break collapsed to a space, and is stable on a second pass
- [A] A toggleable heading round-trips at every level with `is_toggleable` and its
      nested children intact; a `<details>` with no marker stays a plain toggle
- [A] A disclosure title containing `</summary>` or `</details>` survives intact
- [A] User, page and database mentions round-trip as mentions, not as links, and
      a person mention shows the name rather than a bare account id
- [A] A `notion://` URL that is not a valid id stays an ordinary link
- [A] Callout icons round-trip for emoji, external URL and built-in Notion icons;
      a Notion-hosted icon falls back to a default and warns
- [M] A page with mentions and custom callout icons survives `page get` →
      `page update` with both intact on the Notion side
- [A] Empty spacer paragraphs are dropped (documented limitation), the drop is
      stable across repeated syncs, and a blank paragraph carrying children keeps
      the children
- [A] A pathologically indented list (thousands of levels) does not exhaust the
      call stack
- [M] Large Markdown files (100+ blocks) convert without error
- [M] Markdown with mixed indentation (tabs vs spaces) handles gracefully
- [M] A page with three levels of mixed toggles/callouts/lists is accepted by the
      live API rather than rejected whole
- [M] `page get` → `page update` on a page with multi-paragraph list items is
      idempotent (re-reading returns identical Markdown)

### 9.3 Rich Text Tokenizer
- [A] All annotation types: bold, italic, code, strikethrough, links
- [A] Nested annotations (bold+italic, bold link, annotated link)
- [A] Round-trip: `rich_text` to Markdown to `rich_text` preserves annotations
- [A] `*asterisk italic*` and `***triple asterisk***` parsed correctly
- [A] `notion://` URLs preserved in links (not dropped)
- [A] Inline `$expr$` parsed as equation run
- [A] Empty input returns empty array
- [M] Very long rich text segments (1000+ characters) handled correctly

---

## 10. HTTP Layer

- [A] All requests go to `https://api.notion.com/v1` with Bearer token and Notion-Version header
- [A] 429 rate limiting retried with exponential backoff
- [A] 5xx server errors retried up to 5 times on reads and idempotent writes
- [A] 5xx, dropped connection, or client timeout on a creating endpoint
      (`page create`, `comment add`, block append, file send) is NOT retried,
      and the error says the request may already have been applied
- [A] 429 on a creating endpoint is still retried — it is rejected before
      Notion processes it
- [A] `POST /search` and `POST /{databases,data_sources}/{id}/query` keep
      retrying: they are reads despite the method
- [A] 4xx client errors (except 429) fail immediately
- [A] Retry-After header respected
- [A] Auto-pagination for list endpoints (`has_more` + `next_cursor`)
- [A] Absolute URLs rejected (prevents host override)
- [A] Token never leaked in error messages
- [M] `NOTION_TIMEOUT_MS` env var controls request timeout
- [M] Network offline produces NETWORK_ERROR with clear message
- [M] Very large responses (1000+ page results) paginate correctly

---

## 11. Output Formatting

- [A] TTY defaults to human-friendly format (table/markdown)
- [A] Piped output defaults to JSON
- [A] `--format` flag overrides defaults
- [A] JSON output is pretty-printed with 2-space indent
- [A] Table output aligns columns
- [M] `--no-color` disables ANSI codes
- [M] `--quiet` suppresses non-essential output
- [A] CSV output properly escapes commas, quotes, and newlines in values

---

## 12. Error Handling

- [A] Every error code maps to a distinct exit code (1-9)
- [A] JSON error envelope on non-TTY: `{"error":{"code":"...","message":"..."}}`
- [A] Human error format on TTY with colored prefix and suggestions
- [A] Token patterns (`ntn_...`, `secret_...`) scrubbed from all error output
- [M] `--debug` shows HTTP request/response details (token-scrubbed)
- [M] 404 errors include "Connections" hint for page/database/block commands
- [M] Network timeout shows duration and attempt count
- [M] Invalid Notion ID/URL produces clear USAGE error with examples

---

## 13. Global Flags

- [M] `--dry-run` works on every write command (create, update, append, delete, sync, move, duplicate, find-replace, upload, comment add)
- [M] `--profile <name>` selects auth profile for the command
- [M] `--verbose` shows request count (never bodies or tokens)
- [M] `--yes` required for all destructive operations (delete, clear)
- [M] `--help` / `-h` shows full usage
- [M] `--version` / `-v` shows version number
- [M] Unknown command produces USAGE error with suggestion

---

## 14. Security Audit

These automated checks run as part of the test suite and fail the build on violations:

- [A] Only `src/http.ts` contains `fetch()` calls
- [A] Only `src/auth.ts` reads from the config file path
- [A] No source file contains hardcoded token patterns
- [A] No source file imports non-Node-builtin packages (zero dependencies enforced)
- [A] Only `api.notion.com` URLs appear in source code
- [M] `grep -r "https://" src/` confirms no other outbound URLs
- [M] `npm ls` confirms zero runtime dependencies

---

## Running

```sh
# Automated test suite (731 tests)
npm test

# Security checks only
npm run test:security

# Manual dogfood: set up a test workspace and run through scenarios above
export NOTION_TOKEN=ntn_...
notionctl auth doctor        # Verify setup before dogfooding
```
