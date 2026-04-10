# Bug Hunt 2 — 2026-04-10

Systematic codebase review + dogfood testing against a live Notion workspace.
All bugs below are **new** — not duplicates of the 24 bugs from the first hunt.

---

## BH2-1: Unknown code block language crashes with API error (MEDIUM)

**File:** `src/markdown/write.ts:577-578`
**Trigger:** Any markdown with a fenced code block using a language not in Notion's fixed set.

```sh
echo '```unknownlang
code
```' | notionctl page create --parent <id> --title "Test" --from -
# Exit code 8: API_ERROR — body.children[0].code.language should be "abap", "abc", ...
```

**Root cause:** `LANGUAGE_ALIASES[raw] ?? raw` falls through to the raw language string. Notion's API has ~90 valid values and rejects anything else.

**Fix:** Add a `VALID_LANGUAGES` set. If the resolved language is not in the set, fallback to `"plain text"` and optionally warn to stderr.

---

## BH2-2: Nested `<details>` toggles break parser (MEDIUM)

**File:** `src/markdown/write.ts:235-239`
**Trigger:** Markdown with nested `<details>` blocks.

```markdown
<details><summary>Outer</summary>
<details><summary>Inner</summary>
Inner content
</details>
After inner
</details>
```

**Actual result in Notion:**
- Outer toggle has: paragraph + inner toggle (correct)
- "After inner" becomes a **root-level paragraph** (wrong — should be inside outer toggle)
- Literal `</details>` becomes a paragraph with text `</details>`

**Root cause:** The parser scans for `</details>` but doesn't track depth. The inner toggle's `</details>` prematurely ends the outer toggle.

**Fix:** Track `<details>` nesting depth: increment on `<details>`, decrement on `</details>`, only stop when depth reaches 0.

---

## BH2-3: Blockquote without space after `>` becomes paragraph (MEDIUM)

**File:** `src/markdown/write.ts:125`
**Trigger:** Markdown blockquotes without a space after `>`.

```markdown
>This is a valid CommonMark quote
>Second line
```

**Actual result:** Paragraph block with literal text `>This is a quote...`
**Expected result:** Quote block.

**Root cause:** Regex `^>\s` requires whitespace after `>`. CommonMark spec allows `>text` without a space.

**Fix:** Change regex from `/^>\s/` to `/^>/` (with appropriate adjustments to strip the `>` prefix). Also update `isBlockStart()` at line 376.

---

## BH2-4: Callout custom color and icon lost on round-trip (LOW-MEDIUM)

**File:** `src/markdown/write.ts:151-152` and `src/markdown/read.ts:129-134`
**Trigger:** Read → write round-trip on a callout with non-standard emoji or color.

**Read path:** Emits sidecar HTML comments:
```markdown
> [!NOTE]
<!-- color: orange_background -->
<!-- icon: 🎨 -->
> Custom color callout
```

**Write path:** Skips the sidecar comments:
```typescript
if (iconMatch || colorMatch) { i++; continue; } // skipped!
```

**Result:** `orange_background` + `🎨` → `blue_background` + `💡` after round-trip.

**Fix:** Parse the sidecar comments and apply them to the callout block's `color` and `icon` fields.

---

## BH2-5: H4/H5/H6 headings become literal paragraph text (LOW-MEDIUM)

**File:** `src/markdown/write.ts:100-113`
**Trigger:** Markdown with headings deeper than H3.

```markdown
#### H4 heading
##### H5 heading
###### H6 heading
```

**Actual result:** A single paragraph block with literal text `#### H4 heading\n##### H5 heading\n###### H6 Fine detail` (the paragraph continuation parser joins them).

**Root cause:** Only `#`, `##`, `###` are matched. H4+ fall through to the paragraph parser. `isBlockStart()` also doesn't recognize them (regex `^#{1,3}\s` excludes H4+).

**Fix:** Map H4 → H3, H5 → H3, H6 → H3 (Notion only supports 3 heading levels). Add H4-H6 to `isBlockStart()` regex.

---

## BH2-6: `search --type` silently ignores invalid values (LOW)

**File:** `src/commands/meta.ts:55-56`
**Trigger:** `notionctl search "query" --type database` (or any value other than `page`/`db`).

**Actual result:** Returns all results (no type filter applied), no error.
**Expected result:** Error message listing valid values.

**Root cause:** Only `"page"` and `"db"` are checked. Any other value skips the filter silently.

**Fix:** Validate `typeFilter` and throw `USAGE` error for unsupported values.

---

## BH2-7: `--format csv`/`table` on `page get` silently falls back to markdown (LOW)

**File:** `src/commands/page.ts:46-52`
**Trigger:** `notionctl page get <id> --format csv` or `--format table`.

**Actual result:** Outputs markdown. No error, no warning.
**Expected result:** Either produce the requested format or error that it's unsupported.

**Root cause:** `pageGetCommand` only handles `format === "json"`. All other formats fall through to markdown.

**Fix:** Either throw a `USAGE` error for unsupported formats, or properly implement table/CSV for page metadata.

---

## BH2-8: `db row update` without `--prop` sends empty update silently (LOW)

**File:** `src/commands/db.ts:448-474`
**Trigger:** `notionctl db row update <id>` with no `--prop` flags.

**Actual result:** Sends `PATCH /pages/<id> { properties: {} }` to the API, returns full page object, exit code 0.
**Expected result:** Error or warning that no properties were specified.

**Root cause:** No validation that `properties` has at least one key before sending.

**Fix:** Check `Object.keys(properties).length === 0` and throw a `USAGE` error.

---

## BH2-9: `page get --depth N` flag documented but not implemented (LOW)

**File:** `src/commands/page.ts:25-76` and `src/index.ts:140`
**Trigger:** `notionctl page get <id> --depth 1`

**Actual result:** Flag is silently ignored. Full recursive fetch happens regardless.
**Expected result:** Limit recursion depth to N levels.

**Root cause:** Help text advertises `--depth N` but `pageGetCommand` never reads or uses this flag. `fetchBlockTree` accepts a depth parameter but it's never passed from the command.

**Fix:** Either implement `--depth` (read the flag, pass to `fetchBlockTree`) or remove it from the help text.

---

## BH2-10: Multi-paragraph blockquote loses internal paragraph breaks (LOW-MEDIUM)

**File:** `src/markdown/write.ts:135`
**Trigger:** Blockquote with blank `>` lines separating paragraphs.

```markdown
> First paragraph
>
> Second paragraph
>
> Third paragraph
```

**Actual result:** Single quote block with text `First paragraph\nSecond paragraph\nThird paragraph` — no paragraph breaks.

**Root cause:** Line 135: `quoteLines.filter(l => l.length > 0).join("\n")` strips all empty lines. Bare `>` lines (which become empty strings after prefix stripping) are removed.

**Fix:** Preserve empty lines in `quoteLines` or convert them to child paragraph blocks (Notion quote blocks support children).

---

## BH2-11: File upload step 2 (multipart send) has no retry or timeout (LOW)

**File:** `src/http.ts:322-346`
**Trigger:** Network glitch during the multipart file upload.

**Root cause:** `notionUploadFile` step 2 uses raw `fetch()` without:
- `AbortController` timeout
- Retry logic for 429/5xx responses

Step 1 (session creation) goes through `notionRequestSingle` which has both. Step 2 does not.

**Fix:** Either route through `notionRequestSingle` (would need multipart support) or replicate the retry/timeout logic for the upload call.

---

## BH2-12: `page move --to` always uses `page_id`, doesn't detect database parents (LOW)

**File:** `src/commands/page.ts:351`
**Trigger:** `notionctl page move <page-id> --to <database-id>`

**Root cause:** `pageMoveCommand` hardcodes `{ parent: { page_id: toId } }`. Other commands (`pageCreateCommand`, `pageDuplicateCommand`) detect whether the parent is a database by trying `GET /databases/{id}` first. `pageMoveCommand` skips this detection.

**Fix:** Add the same database detection logic used in `pageCreateCommand`.

---

## Summary

| Bug | Severity | Category |
|-----|----------|----------|
| BH2-1: Unknown code language crashes | MEDIUM | Markdown write |
| BH2-2: Nested toggles break parser | MEDIUM | Markdown write |
| BH2-3: Blockquote no-space after `>` | MEDIUM | Markdown write |
| BH2-4: Callout color/icon round-trip loss | LOW-MEDIUM | Markdown read+write |
| BH2-5: H4-H6 become literal text | LOW-MEDIUM | Markdown write |
| BH2-6: `search --type` ignores invalid | LOW | Command validation |
| BH2-7: `page get` ignores format flag | LOW | Output formatting |
| BH2-8: `db row update` empty no-op | LOW | Command validation |
| BH2-9: `--depth` not implemented | LOW | Feature gap |
| BH2-10: Multi-para quote loses breaks | LOW-MEDIUM | Markdown write |
| BH2-11: File upload no retry | LOW | HTTP resilience |
| BH2-12: `page move` no DB parent | LOW | Command logic |

**3 MEDIUM, 4 LOW-MEDIUM, 5 LOW** = 12 new bugs total.
