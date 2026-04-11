# Bug Report v2 — 2026-04-10

Second systematic bug hunt: codebase inspection + dogfood testing against real Notion workspace.

All bugs below are **verified against a live Notion account** with reproduction steps.

---

## BUG-8: Asterisk (`*`) and plus (`+`) list markers not recognized (HIGH)

**File:** `src/markdown/write.ts:430-432`

**Description:** The list parser only recognizes `-` (dash) as a bullet marker. CommonMark specifies three valid bullet markers: `-`, `*`, and `+`. When `*` is used, the tokenizer interprets it as italic formatting, **corrupting the content**. When `+` is used, the items become a paragraph.

**Reproduction:**
```sh
echo '* Item one
* Item two
* Item three' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id>
```

**Expected:** Three bulleted list items.

**Actual (*):** A single paragraph with garbled italic formatting: `_ Star item 1\n_ Star item 2\n_ Star item 3_`

**Actual (+):** A single paragraph with literal `+ Item one\n+ Item two\n+ Item three`

**Root cause:** `isListLine()` regex only matches `^\s*-\s+` and `^\s*\d+\.\s+`. Missing `^\s*[*+]\s+`.

**Fix:** Extend `isListLine` and `classifyListLine`:
```typescript
function isListLine(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

// In classifyListLine, the bulletMatch regex:
const bulletMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
```

Also update `isBlockStart()` to include `*` and `+` list patterns (currently only catches `- `).

---

## BUG-9: Tilde (`~~~`) code fences not recognized (HIGH)

**File:** `src/markdown/write.ts:51`

**Description:** The code fence regex only matches backtick fences (`` ` ``). Tilde fences (`~~~`) are valid GFM/CommonMark but not parsed as code blocks. The `~~` is consumed as strikethrough by the inline tokenizer, corrupting the content.

**Reproduction:**
```sh
echo '~~~ python
print("hello")
~~~' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id>
```

**Expected:** A code block with language "python" containing `print("hello")`.

**Actual:** A paragraph containing `~ python\nprint("hello")\n~` with strikethrough applied via `~~`.

**Root cause:** Line 51 regex `/^(\`{3,})(.*)$/` only matches backticks. Missing tilde fence pattern.

**Fix:**
```typescript
const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
if (fenceMatch) {
  const fenceChar = fenceMatch[1]![0];  // ` or ~
  const fenceLen = fenceMatch[1]!.length;
  const lang = fenceMatch[2]!.trim();
  const closePat = fenceChar === '`'
    ? new RegExp(`^\`{${fenceLen},}\\s*$`)
    : new RegExp(`^~{${fenceLen},}\\s*$`);
  // ...
}
```

---

## BUG-10: Callout write path loses all inline formatting (MEDIUM-HIGH)

**File:** `src/markdown/write.ts:182-183`

**Description:** When creating a callout from GFM alert markdown, the callout's `rich_text` is built by extracting `plain_text` from parsed blocks, discarding all bold, italic, strikethrough, code, and link formatting.

**Reproduction:**
```sh
echo '> [!NOTE]
> **Bold text** and _italic text_ here' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id> --format json | jq '.children[0].callout.rich_text[0].annotations'
```

**Expected:** Callout with bold and italic annotations on the text.

**Actual:** Callout with plain text "Bold text and italic text here" — `bold: false, italic: false`.

**Root cause:** Lines 182-183 extract `.plain_text` from parsed rich_text runs, stripping all annotations. Then `markdownToRichText(calloutText)` re-parses the now-plain string:
```typescript
calloutText = (childBlocks[0]!.paragraph as { rich_text: RichText[] }).rich_text
  .map((r) => r.plain_text).join("");
```

**Fix:** Use the original rich_text runs directly instead of re-parsing:
```typescript
if (childBlocks.length > 0 && childBlocks[0]!.type === "paragraph") {
  const firstPara = childBlocks[0]!.paragraph as { rich_text: RichText[] };
  calloutRichText = firstPara.rich_text;  // preserve formatting
  calloutChildren = childBlocks.slice(1);
}
```

---

## BUG-11: Callout read path loses `>` prefix on multiline rich_text (MEDIUM)

**File:** `src/markdown/read.ts:127`

**Description:** When a Notion callout has multiline content in its `rich_text` (containing `\n`), only the first line gets the `>` prefix. This is the same bug as BUG-1 (fixed for blockquotes) but it was not applied to callouts.

**Reproduction:**
```sh
# Create callout with multiline text via API
notionctl api PATCH /blocks/<parent-id>/children --body '{"children":[{"type":"callout","callout":{"rich_text":[{"type":"text","text":{"content":"Line one\nLine two\nLine three"}}],"icon":{"type":"emoji","emoji":"💡"},"color":"blue_background"}}]}'
notionctl block get <created-id> --format md
```

**Expected:**
```
> [!NOTE]
> Line one
> Line two
> Line three
```

**Actual:**
```
> [!NOTE]
> Line one
Line two
Line three
```

**Root cause:** Line 127 does `> ${text}` without splitting on newlines. The fix applied to quotes (line 107) was not replicated here.

**Fix:**
```typescript
const textPrefixed = text.split("\n").map((l) => `> ${l}`).join("\n");
const lines: string[] = [`> [!${alertType}]`, textPrefixed];
```

---

## BUG-12: Callout continuation lines without space after `>` silently dropped (MEDIUM)

**File:** `src/markdown/write.ts:162`

**Description:** Callout continuation lines like `>text` (no space after `>`) are not recognized. The content is dropped from the callout and falls through to the blockquote parser. This is inconsistent with the blockquote parser which handles both `> text` and `>text`.

**Reproduction:**
```sh
echo '> [!WARNING]
>No space after angle bracket
>Another no-space line' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id> --format json
```

**Expected:** Warning callout containing "No space after angle bracket" and "Another no-space line".

**Actual:** Empty callout (rich_text: []) + separate quote block with the dropped text.

**Root cause:** Line 162 regex `/^>\s/` requires a space after `>`. `>text` trimmed is `>text` which doesn't match.

**Fix:**
```typescript
if (/^>\s/.test(next) || /^>[^\s]/.test(next)) {
  const content = next.startsWith("> ") ? next.slice(2) : next.slice(1);
  continuationLines.push(content);
  i++;
  continue;
}
```

---

## BUG-13: Table row parser doesn't handle pipe inside inline code (MEDIUM)

**File:** `src/markdown/write.ts:654-672`

**Description:** The `parseTableRow` function splits on `|` characters but doesn't track inline code spans (backticks). A pipe inside backtick-quoted content is treated as a cell separator, corrupting the table.

**Reproduction:**
```sh
echo '| Name | Command |
| --- | --- |
| Test | `echo "a | b"` |' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id>
```

**Expected:** Table with row: `["Test", "`echo \"a | b\"`"]`

**Actual:** Table with row: `["Test", "`echo \"a"]` — content after the pipe inside backticks is lost.

**Root cause:** `parseTableRow` only handles `\|` escapes. It doesn't track backtick state.

**Fix:** Add backtick tracking to the parser:
```typescript
function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "`") { inCode = !inCode; current += "`"; continue; }
    if (inCode) { current += trimmed[i]; continue; }
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|"; i++; continue;
    }
    if (trimmed[i] === "|") { cells.push(current.trim()); current = ""; continue; }
    current += trimmed[i];
  }
  cells.push(current.trim());
  return cells;
}
```

---

## BUG-14: Rich text content >2000 chars crashes with raw API error (MEDIUM)

**File:** `src/markdown/write.ts` (makeRun in tokenizer.ts)

**Description:** Notion's API enforces a 2000-character limit per `rich_text[].text.content`. When a paragraph or any block has >2000 characters of text, the API rejects with a validation error. The CLI should split long text into multiple runs.

**Reproduction:**
```sh
python3 -c "print('A' * 2001)" | notionctl page create --parent <id> --title "test" --from -
```

**Expected:** Page created with text split across multiple runs.

**Actual:** `API_ERROR: body.children[0].paragraph.rich_text[0].text.content.length should be ≤ 2000, instead was 2001`

**Root cause:** `markdownToRichText` and `makeRun` create a single run per text segment with no length limit.

**Fix:** Add a `splitLongRuns` post-processing step that splits any run with `text.content.length > 2000` into chunks, preserving annotations and links.

---

## BUG-15: Heading text preserves extra whitespace after `#` (LOW-MEDIUM)

**File:** `src/markdown/write.ts:101,106,111`

**Description:** When a heading has extra spaces after `#` (e.g., `#  Hello`), the heading text includes leading whitespace because `trimmed.slice(N)` doesn't trim the result. CommonMark allows optional spaces after `#`.

**Reproduction:**
```sh
echo '#  Extra Spaces' | notionctl page create --parent <id> --title "test" --from -
notionctl page get <created-id> --format json | jq '.children[0].heading_1.rich_text[0].plain_text'
```

**Expected:** `"Extra Spaces"`

**Actual:** `" Extra Spaces"` (leading space)

**Root cause:** `trimmed.slice(2)` for H1 only removes `# ` (2 chars). With `#  ` (3 chars) the extra space remains.

**Fix:** Use regex capture group or trim:
```typescript
case "#":
  blocks.push(makeHeadingBlock(1, trimmed.replace(/^#\s+/, "")));
```

---

## BUG-16: `extractSyncTitle` matches H1 inside code fences (LOW-MEDIUM)

**File:** `src/commands/page.ts:541`

**Description:** The regex `/^# (.+)$/m` used to extract the page title from markdown body matches `# comment` lines inside fenced code blocks. This causes `page sync` to use a code comment as the page title and remove it from the code block, corrupting the content.

**Reproduction:**
```sh
cat > test.md << 'EOF'
```bash
# Install dependencies
npm install
```

Normal paragraph
EOF
notionctl page sync test.md --parent <id> --dry-run
# Title will be "Install dependencies" instead of "Untitled"
```

**Expected:** Title = "Untitled" (no H1 heading outside code blocks).

**Actual:** Title = "Install dependencies" (H1 from inside code block).

**Root cause:** Simple regex scan doesn't distinguish between markdown structure and code block content.

**Fix:** Skip lines inside fenced code blocks before searching for H1:
```typescript
function extractSyncTitle(frontmatter, body) {
  if (frontmatter.title) return { title: String(frontmatter.title), syncBody: body };
  // Find H1 outside code fences
  const lines = body.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^(`{3,}|~{3,})/.test(lines[i]!.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h1 = /^# (.+)$/.exec(lines[i]!);
    if (h1) {
      const title = h1[1]!.trim();
      const syncBody = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").trimStart();
      return { title, syncBody };
    }
  }
  return { title: "Untitled", syncBody: body };
}
```

---

## BUG-17: `parseFlags` silently drops non-boolean flag as last argument (LOW-MEDIUM)

**File:** `src/commands/shared.ts:90`

**Description:** When a non-boolean flag is the last argument (e.g., `--title` with no value), `args[i + 1]` is `undefined`. The flag is silently ignored, and the command fails with a misleading "missing required argument" error instead of a clear "flag missing value" error.

**Reproduction:**
```sh
notionctl page create --parent <id> --title
# Error: "Usage: notionctl page create --parent <id> --title <text> [--from file.md]"
# Expected: "Flag --title requires a value"
```

**Root cause:** Line 90: `value = args[i + 1]` without bounds check. When `i + 1 >= args.length`, value is `undefined`, and line 99 silently skips setting the flag.

**Fix:**
```typescript
} else {
  value = args[i + 1];
  if (value === undefined) {
    throw new NotionCliError(ErrorCode.USAGE, `Flag --${name} requires a value`);
  }
  i++;
}
```

---

## BUG-18: `clientSecret` precedence reversed vs `clientId` (LOW)

**File:** `src/commands/auth.ts:211-212`

**Description:** `clientId` prefers CLI flag over env var, but `clientSecret` prefers env var over CLI flag. This is inconsistent and can confuse users.

```typescript
const clientId = flags.get("client-id") ?? process.env.NOTION_CLIENT_ID;        // flag wins
const clientSecret = process.env.NOTION_CLIENT_SECRET ?? flags.get("client-secret"); // env wins
```

**Fix:** Make both consistent (flag takes precedence):
```typescript
const clientSecret = flags.get("client-secret") ?? process.env.NOTION_CLIENT_SECRET;
```

---

## Summary

| # | Severity | Component | Description |
|---|----------|-----------|-------------|
| 8 | HIGH | write.ts | `*` and `+` list markers not recognized — content corrupted |
| 9 | HIGH | write.ts | Tilde `~~~` code fences not recognized — content corrupted |
| 10 | MED-HIGH | write.ts | Callout write path drops all inline formatting (bold/italic/etc) |
| 11 | MEDIUM | read.ts | Callout multiline rich_text loses `>` prefix (same as fixed BUG-1) |
| 12 | MEDIUM | write.ts | Callout `>text` (no space) drops content |
| 13 | MEDIUM | write.ts | Table pipe inside backticks splits cell incorrectly |
| 14 | MEDIUM | tokenizer.ts | Rich text >2000 chars crashes with API validation error |
| 15 | LOW-MED | write.ts | Heading extra spaces after `#` preserved in text |
| 16 | LOW-MED | page.ts | `extractSyncTitle` matches H1 inside code blocks |
| 17 | LOW-MED | shared.ts | Non-boolean flag as last arg silently dropped |
| 18 | LOW | auth.ts | clientSecret precedence reversed vs clientId |

**Total: 11 new bugs (2 HIGH, 1 MED-HIGH, 3 MEDIUM, 3 LOW-MED, 2 LOW)**
