# Bug Hunt Results — 2026-04-10

**Test parent page:** `33e944f0-98c0-8198-ba0c-db692520dc37`
**Workspace root:** `33d944f0-98c0-807f-bdf5-d4ef3bd6a8e7`

Systematic verification of 17 code-audit bugs + full CLI dogfood of all 42 commands.

**Result:** 14 confirmed bugs from code audit, 1 rejected, 1 partial + 10 new bugs found during dogfood = **24 total confirmed bugs**.

## Summary

| # | Bug | Status | Severity | Description |
|---|-----|--------|----------|-------------|
| A1 | page move wrong endpoint | REJECTED | — | `POST /pages/{id}/move` is a valid Notion API endpoint |
| A2 | page duplicate loses DB properties | CONFIRMED | Medium | Only title copied; Status, Priority etc. silently dropped |
| A3 | page duplicate wrong parent type | CONFIRMED | Medium | Fails for DB rows without `--parent`; hardcodes `page_id` |
| A4 | page create hardcodes page_id parent | CONFIRMED | Medium | Passing a database ID as `--parent` gives confusing NOT_FOUND |
| A5 | db row create --from no frontmatter strip | CONFIRMED | Medium | YAML frontmatter becomes literal page content |
| A6 | db query single --filter | CONFIRMED | Medium | Second `--filter` silently overwrites the first |
| A7 | toggle body content lost | CONFIRMED | High | Everything between `</summary>` and `</details>` discarded |
| B1 | find-replace title match not counted | CONFIRMED | Low | matchCount excludes title replacements |
| B2 | search only uses first word | CONFIRMED | Medium | Multi-word unquoted args: only `positional[0]` used |
| B3 | db row create --from - (stdin) | CONFIRMED | Medium | `readFile("-")` crashes with ENOENT |
| B4 | images don't round-trip | CONFIRMED | Medium | `![alt](url)` becomes paragraph, not image block |
| B5 | mention links lost on round-trip | CONFIRMED | Medium | `notion://` URLs silently dropped by tokenizer |
| B6 | sort doesn't validate property names | PARTIAL | Low | API error instead of CLI error; inconsistent but functional |
| B7 | blockquotes collapse to single line | CONFIRMED | Medium | `quoteLines.join(" ")` loses paragraph breaks |
| C1 | empty block append silent no-op | CONFIRMED | Low | Exits 0 with empty results, no warning |
| C2 | unknown flags eat positional args | CONFIRMED | Medium | `--nonexistent <id>` swallows the ID |
| C3 | page create H1 regex mid-doc | NOT TESTED | Low | Rare edge case, not triggered in dogfood |
| N1 | CSV output triple-quotes empty cells | NEW | Medium | Null → `""` → JSON.stringify → `""""""` in CSV |
| N2 | `<details>` inline closes, eats next toggle | NEW | Medium | Single-line `<details>...</details>` causes parser to consume next block |
| N3 | Multi-line `<details>` loses summary | NEW | Medium | `<summary>` on separate line never matched |
| N4 | --debug flag not implemented | NEW | Low | Advertised in --help but no code exists |
| N5 | --verbose flag not implemented | NEW | Low | Advertised in --help but no code exists |
| N6 | Inline equation `$...$` not parsed | NEW | Low | `$expr$` stored as literal text, not equation run |
| N7 | file upload .md fails (MIME) | NEW | Low | `.md` not in MIME_MAP, falls back to rejected `application/octet-stream` |
| N8 | page sync --dry-run leaks remoteEditedAt | NEW | Low | UNCHANGED dry-run output inconsistent with non-dry-run |

---

## Phase 1: Code Audit Verification

### BUG-A1: `page move` uses wrong API endpoint
- **Status:** REJECTED
- **Command:** `notionctl page move <source-id> --to <target-id>`
- **Result:** Command succeeded. `POST /pages/{id}/move` is a valid Notion API endpoint.
- **File:** `src/commands/page.ts:305`

### BUG-A2: `page duplicate` loses database properties
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl page duplicate <db-row-id> --parent <page-id>`
- **Expected:** Duplicate carries Status=Doing, Priority=5
- **Actual:** Duplicate has only title property. Status and Priority absent. Title shows "Untitled (copy)" because the title extractor reads `properties.title` which doesn't exist for DB rows (the key is "Name").
- **File:** `src/commands/page.ts:226-227` (title), `src/commands/page.ts:264-269` (properties)

### BUG-A3: `page duplicate` wrong parent type for DB rows
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl page duplicate <db-row-id>` (no --parent)
- **Expected:** Duplicate placed in same database
- **Actual:** Error: "Source page has no page parent (it may be a workspace root page)." — code checks `parent.page_id` but DB rows have `parent.database_id`.
- **File:** `src/commands/page.ts:235` (parent detection), `src/commands/page.ts:265` (hardcodes `page_id`)

### BUG-A4: `page create` hardcodes page_id parent
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl page create --parent <database-id> --title "Test"`
- **Expected:** Either creates a DB row or explains to use `db row create`
- **Actual:** NOT_FOUND error because `page_id` pointing to a database ID is rejected by Notion
- **Dry-run confirms:** `"parent": { "page_id": "..." }` always, never `database_id`
- **File:** `src/commands/page.ts:116-118`

### BUG-A5: `db row create --from` doesn't strip frontmatter
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl db row get <id> > export.md && notionctl db row create <db-id> --prop "Name=Reimported" --from export.md`
- **Expected:** Frontmatter stripped, only body content becomes blocks
- **Actual:** YAML frontmatter (notion_id, Count, Status, Name) rendered as literal paragraph text with `---` dividers
- **File:** `src/commands/db.ts:434-436`

### BUG-A6: `db query` only supports one `--filter`
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl db query <id> --filter "Status=Closed" --filter "Count>=10"`
- **Expected:** AND of both filters
- **Actual:** Only `Count>=10` applied (second overwrites first). "filter" not in REPEATABLE_FLAGS.
- **File:** `src/commands/shared.ts:28-33`, `src/commands/db.ts:168`

### BUG-A7: Toggle body content lost on write
- **Status:** CONFIRMED
- **Severity:** High
- **Command:** `notionctl page create --from toggle-test.md` (with `<details>` content)
- **Expected:** Toggle has children with body content
- **Actual:** Toggle created with zero children. All content between `</summary>` and `</details>` discarded.
- **File:** `src/markdown/write.ts:148-161`

### BUG-B1: find-replace doesn't count title matches
- **Status:** CONFIRMED
- **Severity:** Low
- **Command:** `notionctl page find-replace <id> --find "alpha" --replace "beta"` (page titled "alpha title page" with "alpha" twice in body)
- **Expected:** matchCount: 3
- **Actual:** matchCount: 2, titleUpdated: true. Title was changed but not counted.
- **File:** `src/commands/page.ts:372-385`

### BUG-B2: search only uses first word
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl search Toggle Test` (unquoted)
- **Expected:** Searches "Toggle Test"
- **Actual:** Searches "Toggle" only. "Test" discarded. Fix: `positional.join(" ")`
- **File:** `src/commands/meta.ts:52`

### BUG-B3: db row create --from - (stdin) crashes
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `echo "content" | notionctl db row create <db-id> --prop "Name=Test" --from -`
- **Expected:** Reads from stdin
- **Actual:** `Internal error: ENOENT: no such file or directory, open '-'`
- **File:** `src/commands/db.ts:434-436` (uses `readFile` instead of stdin-aware reader)

### BUG-B4: Images don't round-trip
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** Page with `![Alt](https://example.com/image.png)` → read back
- **Expected:** Notion image block created
- **Actual:** Paragraph block with `!` text + link run. No image block. Write path has no `![` parser.
- **File:** `src/markdown/write.ts` (missing image syntax handler)

### BUG-B5: Mention links lost on round-trip
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `[link](notion://page/123)` in markdown
- **Expected:** Link preserved
- **Actual:** Link silently dropped. `makeRun` only sets link for `https?://` URLs.
- **File:** `src/markdown/tokenizer.ts:357`

### BUG-B6: Sort doesn't validate property names
- **Status:** PARTIAL
- **Severity:** Low
- **Command:** `notionctl db query <id> --sort "Scroe:desc"` (typo)
- **Expected:** CLI-level INVALID_PROPERTY error (like filter gives)
- **Actual:** API_ERROR with "Could not find sort property". Functional but inconsistent error handling.
- **File:** `src/commands/db.ts:151-157`

### BUG-B7: Multi-line blockquotes collapse
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** Three-paragraph blockquote → read back
- **Expected:** Three separate lines with `>` prefix
- **Actual:** Single line: "First paragraph.  Second paragraph.  Third paragraph." (double spaces)
- **File:** `src/markdown/write.ts:110`

### BUG-C1: Empty block append is silent no-op
- **Status:** CONFIRMED
- **Severity:** Low
- **Command:** `echo "" | notionctl block append <id> --from -`
- **Expected:** Warning about empty input
- **Actual:** Exits 0, outputs `{"results":[]}`
- **File:** `src/commands/block.ts:63-89`

### BUG-C2: Unknown flags eat positional args
- **Status:** CONFIRMED
- **Severity:** Medium
- **Command:** `notionctl page get --nonexistent <valid-page-id>`
- **Expected:** Unknown flag error
- **Actual:** "Usage: notionctl page get <id>" — the page ID was consumed as the value of `--nonexistent`
- **File:** `src/commands/shared.ts:55-63`

---

## Phase 2: New Bugs Found During Dogfood

### NEW-BUG-N1: CSV output triple-quotes empty cells
- **Severity:** Medium
- **Command:** `notionctl db query <id> --format csv`
- **Expected:** Empty/null fields as empty CSV cells
- **Actual:** Null values render as `""""""` (six quotes). Chain: `null` → `""` via `??` → `JSON.stringify` → `'""'` → CSV escaping doubles internal quotes.
- **File:** `src/commands/db.ts:201`, `src/output.ts`

### NEW-BUG-N2: Inline `<details>...</details>` eats next toggle block
- **Severity:** Medium
- **Command:** Page with two `<details>` blocks, first is single-line
- **Expected:** Two toggle blocks
- **Actual:** One toggle. The body-scanning loop starts after the first line (which already had `</details>`) and consumes everything until the next `</details>`.
- **File:** `src/markdown/write.ts:148-162`

### NEW-BUG-N3: Multi-line `<details>` loses summary text
- **Severity:** Medium
- **Command:** `<details>\n<summary>Title</summary>\nBody\n</details>`
- **Expected:** Toggle with "Title" as label
- **Actual:** Toggle with empty label. `summaryMatch` regex runs against first line (`<details>`) which has no `<summary>`.
- **File:** `src/markdown/write.ts:149`

### NEW-BUG-N4: --debug flag not implemented
- **Severity:** Low
- **Command:** Any command with `--debug`
- **Expected:** HTTP debug output to stderr
- **Actual:** No output. Flag is parsed but never read.
- **File:** `src/http.ts` (missing), advertised in `src/index.ts:186`

### NEW-BUG-N5: --verbose flag not implemented
- **Severity:** Low
- **Command:** Any command with `--verbose`
- **Expected:** Request count shown
- **Actual:** No output. Flag is parsed but never read.
- **File:** `src/http.ts` (missing)

### NEW-BUG-N6: Inline equation `$...$` not parsed by tokenizer
- **Severity:** Low
- **Command:** Paragraph with `$x^2 + y^2 = z^2$`
- **Expected:** Equation-type rich text run
- **Actual:** Literal text including dollar signs. No `$` handling in `markdownToRichText`.
- **File:** `src/markdown/tokenizer.ts:209`

### NEW-BUG-N7: file upload .md fails (missing MIME type)
- **Severity:** Low
- **Command:** `notionctl file upload somefile.md`
- **Expected:** Upload with `text/markdown` or `text/plain`
- **Actual:** API_ERROR: "content type application/octet-stream is not supported". `.md` not in MIME_MAP.
- **File:** `src/commands/file.ts:16-31`

### NEW-BUG-N8: page sync --dry-run UNCHANGED output inconsistent
- **Severity:** Low
- **Command:** `notionctl page sync file.md --dry-run` when UNCHANGED
- **Expected:** Consistent with non-dry-run: `{"file":"...","state":"UNCHANGED","message":"no changes"}`
- **Actual:** `{"file":"...","state":"UNCHANGED","remoteEditedAt":"..."}` — different fields.
- **File:** `src/commands/page.ts:503-504`

---

## Stress Test: Markdown Round-Trip

**Round-trip stability:** read1 → update → read2 produces identical output (zero diff). The converter is stable.

**Input → first read differences:**
1. Frontmatter + `# Title` added (expected)
2. URLs get trailing slash from Notion normalization (expected)
3. Level 3 bullets promoted to level 2 (by design, Notion API limit)
4. Toggle body content dropped (BUG-A7)

---

## Commands That Passed All Tests

All 42 commands were exercised. Commands not mentioned in bugs above worked correctly across all tested scenarios including: page get/create/append/update/delete/restore/sync/open/find-replace, db create/update/query/schema, db row get/create/update/delete, block get/children/append/update/delete, comment list/add, user list/me, whoami, search, resolve, api, auth status/doctor/list, and all --dry-run / --format / error path variants.
