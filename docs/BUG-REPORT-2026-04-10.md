# Bug Report — 2026-04-10

Systematic bug hunt via codebase inspection + dogfooding against real Notion workspace.

---

## BUG-1: Multi-line blockquote loses `>` on continuation lines (MEDIUM)

**File:** `src/markdown/read.ts:104-113`

**Description:** When a Notion quote block's `rich_text` contains newline characters (which happens when multi-line quotes are written), the read path only prefixes the first line with `> `. All subsequent lines lose their `>` prefix, breaking the markdown structure.

**Reproduction:**
```sh
echo '> Line one
> Line two
> Line three' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id>
```

**Expected:**
```
> Line one
> Line two
> Line three
```

**Actual:**
```
> Line one
Line two
Line three
```

**Root cause:** Line 112: `return \`> ${quoteText}\`` — `quoteText` can contain `\n` from `richTextToMarkdown()` but only the first line gets the `> ` prefix.

**Fix:** Split quoteText on newlines and prefix each line:
```typescript
case "quote": {
  const quoteText = richTextToMarkdown(block.quote.rich_text);
  const quoteChildren = (block as any)._children as Block[] | undefined;
  const quotePrefixed = quoteText.split("\n").map(l => `> ${l}`).join("\n");
  if (quoteChildren && quoteChildren.length > 0) {
    const childMd = blocksToMarkdown(quoteChildren);
    const childLines = childMd.split("\n").map((l) => `> ${l}`).join("\n");
    return `${quotePrefixed}\n${childLines}`;
  }
  return quotePrefixed;
}
```

---

## BUG-2: Inline `<details>` body content silently discarded (MEDIUM)

**File:** `src/markdown/write.ts:174-186`

**Description:** When `<details><summary>Title</summary>Body content</details>` appears on a single line, the body content between `</summary>` and `</details>` is captured in the regex (`inlineCloseMatch[2]`) but never used. The toggle block is created with no children.

**Reproduction:**
```sh
echo '<details><summary>Toggle</summary>This body is lost</details>' | \
  notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id>
```

**Expected:** Toggle block with "This body is lost" as child content.

**Actual:** Empty toggle block — body content discarded.

**Root cause:** Lines 176-186 create the toggle with `has_children: false` and no children array. The captured `inlineCloseMatch[2]` is never parsed into blocks.

**Fix:** Parse the body content and add as children:
```typescript
if (inlineCloseMatch) {
  const summary = inlineCloseMatch[1] ?? "";
  const bodyText = inlineCloseMatch[2] ?? "";
  const childBlocks = bodyText.trim().length > 0 ? markdownToBlocks(bodyText.trim()) : [];
  i++;
  const toggleData: any = { rich_text: markdownToRichText(summary), color: "default" };
  if (childBlocks.length > 0) toggleData.children = childBlocks;
  blocks.push({
    object: "block", id: "", type: "toggle",
    has_children: childBlocks.length > 0,
    toggle: toggleData,
  } as unknown as Block);
  continue;
}
```

---

## BUG-3: Drift detection fails for edits within the same minute (LOW-MEDIUM)

**File:** `src/sync/sync.ts:54-61`

**Description:** Drift detection compares Notion's `last_edited_time` (minute precision, e.g., `2026-04-10T21:19:00.000Z`) against `notion_synced_at` (millisecond precision, e.g., `2026-04-10T21:19:15.105Z`). Since a sync always updates the page (setting `last_edited_time` to the current minute), and `notion_synced_at` is recorded seconds AFTER, the page's `last_edited_time` is always ≤ `notion_synced_at` within the same minute. Any remote edit in that remaining window (up to ~59 seconds) goes undetected.

**Reproduction:**
```sh
# 1. Sync a file (creates page)
notionctl page sync test.md --parent <id>
# 2. Immediately append content to the page remotely
echo "Remote edit" | notionctl block append <page-id>
# 3. Edit local file and sync again
echo "Local change" >> test.md
notionctl page sync test.md
# Expected: DRIFT error
# Actual: CHANGED (silently overwrites remote edit)
```

**Root cause:** Line 58: `remoteTime > syncTime` — due to minute truncation, this is false when both timestamps fall in the same minute.

**Fix options:**
1. Round `syncTime` DOWN to minute precision before comparing: `if (remoteTime > Math.floor(syncTime / 60000) * 60000)`
2. Add content-hash comparison of remote page as a secondary drift signal
3. Store `notion_synced_at` rounded down to the minute (consistent precision)

---

## BUG-4: Tables with irregular column counts crash with raw API error (LOW)

**File:** `src/markdown/write.ts:280-316`

**Description:** When a markdown table has rows with more cells than the header, the write path sends all cells to Notion without validation. The Notion API then rejects the request with: `"Number of cells in table row must match the table width of the parent table"`. Users see a raw API error instead of a helpful USAGE error.

**Reproduction:**
```sh
echo '| A | B |
| --- | --- |
| 1 | 2 | 3 |' | notionctl page create --parent <id> --title "test" --from -
```

**Expected:** USAGE error: "Table row 2 has 3 cells but header has 2. Extra cells will be truncated."

**Actual:** API_ERROR with raw Notion message.

**Fix:** After parsing each row, normalize cell count to match header:
```typescript
while (i < lines.length && /^\|.*\|$/.test(lines[i]!.trim())) {
  let rowCells = parseTableRow(lines[i]!.trim());
  // Normalize: truncate extra cells, pad missing cells
  if (rowCells.length > headerCells.length) rowCells = rowCells.slice(0, headerCells.length);
  while (rowCells.length < headerCells.length) rowCells.push("");
  // ...
}
```

---

## BUG-5: Callout write path collapses all continuation content to flat text (LOW-MEDIUM)

**File:** `src/markdown/write.ts:140-169`

**Description:** The callout/GFM alert parser joins ALL continuation lines (`> text`) with spaces into a single `rich_text` string. This means:
1. List items inside callouts (`> - item`) become literal text "- item"
2. Multi-paragraph callouts (separated by `> ` blank lines) terminate prematurely
3. Code blocks, headings, or other block elements inside callouts are lost

**Reproduction:**
```sh
echo '> [!NOTE]
> First line
> - A list item
> - Another item
>
> Second paragraph' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id>
```

**Expected:** Callout with rich_text "First line" and children: [list items, paragraph]

**Actual:** Callout with rich_text "First line - A list item - Another item" (flat), blank `> ` terminates parser, "Second paragraph" becomes separate blockquote.

**Root cause:** Line 152: `calloutText += (calloutText ? " " : "") + next.slice(2)` — blindly joins all continuation lines without recognizing block structure within the callout.

**Fix:** Collect the raw continuation lines (stripping `> ` prefix), then parse them with `markdownToBlocks()` to detect child block structure. Store the first paragraph as `rich_text` and remaining blocks as `children`.

---

## BUG-6: Callout blank continuation line (`> `) terminates parser (LOW)

**File:** `src/markdown/write.ts:151`

**Description:** A blank continuation line `> ` (just `>` followed by space, which trims to `>`) fails the regex `/^>\s/.test(next)` because the trimmed string has no space character after `>`. This causes the callout parser's while loop to break prematurely, splitting a single logical callout into multiple blocks.

**Root cause:** Trimming removes the trailing space, so `> ` becomes `>`, which doesn't match `/^>\s/`.

**Fix:** Change the break condition to also accept bare `>`:
```typescript
if (/^>\s/.test(next) || next === ">") {
  const content = next === ">" ? "" : next.slice(2);
  calloutText += (calloutText ? "\n" : "") + content;
  i++;
  continue;
}
```

---

## BUG-7: File upload crashes on unsupported extensions (LOW — FIXED)

**File:** `src/commands/file.ts`

**Description:** Uploading files with extensions not in Notion's File Upload API allowlist (e.g. `.ts`, `.py`, `.go`, `.java`) failed with a raw API error. Notion's API supports a specific set of extensions (documents, images, audio, video) that is narrower than what the Notion web UI accepts.

**Fix:** Added the full Notion-supported extension allowlist. Unsupported extensions are automatically renamed to `<name>.<ext>.txt` with a stderr warning. The original filename is preserved in the JSON output (`originalName` field).

**Limitation:** Notion blocks certain file content server-side (e.g. PHP code returns 403 regardless of extension). This cannot be worked around via the API.

---

## Summary

| # | Severity | Component | Status | Description |
|---|----------|-----------|--------|-------------|
| 1 | MEDIUM | read.ts | FIXED | Blockquote continuation lines lose `>` prefix |
| 2 | MEDIUM | write.ts | FIXED | Inline `<details>` body content silently dropped |
| 3 | LOW-MED | sync.ts | DOCUMENTED | Drift detection misses same-minute edits (Notion API limitation) |
| 4 | LOW | write.ts | FIXED | Irregular table columns → raw API error |
| 5 | LOW-MED | write.ts | FIXED | Callout children collapsed to flat text |
| 6 | LOW | write.ts | FIXED | Blank `> ` line terminates callout early |
| 7 | LOW | file.ts | FIXED | File upload crashes on unsupported extensions |

**Not bugs but noted:**
- Deep list nesting (>2 levels) flattened to 2 — documented `MAX_CHILD_DEPTH` limitation of Notion API
- `--verbose`/`--debug` flags declared but unimplemented (documented in help text)
- Comment commands require separate integration capability (correct permission error)
- Notion's File Upload API does not support code file extensions — the web UI uses a different upload path
