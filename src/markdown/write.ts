/**
 * Markdown → block tree conversion (write path).
 *
 * Line-based parser. Groups lines into block-level units:
 *   - fenced code blocks
 *   - HTML details (toggles)
 *   - HTML comment markers (pass-through)
 *   - GFM tables (table rows separated by header separator row)
 *   - GFM alerts (callouts via > [!NOTE] prefix)
 *   - blockquotes, lists, to_dos, headings, paragraphs
 *
 * Inline formatting within each line is delegated to markdownToRichText.
 *
 * Split across Tasks 19 (basic) and 20 (complex + pass-through).
 */

import { markdownToRichText } from "./tokenizer.js";
import type { Block, RichText } from "./types.js";

const ALERT_TYPE_TO_EMOJI: Record<string, string> = {
  NOTE: "💡",
  TIP: "🔥",
  WARNING: "⚠️",
  IMPORTANT: "❗",
  CAUTION: "🛑",
};

const ALERT_TYPE_TO_COLOR: Record<string, string> = {
  NOTE: "blue_background",
  TIP: "green_background",
  WARNING: "yellow_background",
  IMPORTANT: "red_background",
  CAUTION: "red_background",
};

// The sidecar comment supports an optional trailing suffix (e.g. `name="foo"
// hosted=notion`) that the read path uses to convey extra info for
// Notion-hosted media blocks. The write path only cares about `type` and
// `id`, so the trailing portion is matched non-greedily and discarded.
const PASS_THROUGH_RE = /^<!--\s*notion-block:\s*(\w+)\s+id=([\w-]+)(?:\s[^>]*)?\s*-->$/;

const MEDIA_SIDECAR_TYPES = new Set(["image", "video", "file", "pdf"]);
const LINK_SIDECAR_TYPES = new Set(["bookmark", "link_preview", "embed"]);

function peekSidecar(lines: string[], startIdx: number): { type: string; nextIdx: number } | null {
  let i = startIdx;
  while (i < lines.length && lines[i]!.trim().length === 0) i++;
  if (i >= lines.length) return null;
  const m = PASS_THROUGH_RE.exec(lines[i]!.trim());
  if (!m) return null;
  return { type: m[1]!, nextIdx: i + 1 };
}

function parseBareLinkLine(line: string): { label: string; url: string } | null {
  if (!line.startsWith("[")) return null;
  let i = 1;
  let depth = 1;
  while (i < line.length && depth > 0) {
    if (line[i] === "\\") { i += 2; continue; }
    if (line[i] === "[") depth++;
    else if (line[i] === "]") { depth--; if (depth === 0) break; }
    i++;
  }
  if (depth !== 0) return null;
  const labelEnd = i;
  if (line[i + 1] !== "(") return null;
  let parenDepth = 1;
  let j = i + 2;
  while (j < line.length && parenDepth > 0) {
    if (line[j] === "\\") { j += 2; continue; }
    if (line[j] === "(") parenDepth++;
    else if (line[j] === ")") { parenDepth--; if (parenDepth === 0) break; }
    j++;
  }
  if (parenDepth !== 0) return null;
  if (j !== line.length - 1) return null;
  const label = line.slice(1, labelEnd);
  const url = line.slice(labelEnd + 2, j);
  if (url.length === 0) return null;
  return { label, url };
}

export function markdownToBlocks(md: string): Block[] {
  // Normalize CRLF and stray CR to LF so paragraph runs don't carry trailing
  // carriage returns that would bleed into Notion rich_text content.
  const normalized = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const ctx: ParseContext = { warnedHeadingDowngrade: false };
  return markdownToBlocksInternal(normalized, ctx);
}

interface ParseContext {
  warnedHeadingDowngrade: boolean;
}

function markdownToBlocksInternal(md: string, ctx: ParseContext): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let tableNoHeader = false;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i++;
      continue;
    }

    // Fenced code block — match closing fence with same or more backticks/tildes
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1]![0]!;
      const fenceLen = fenceMatch[1]!.length;
      const lang = fenceMatch[2]!.trim();
      const closePat = fenceChar === "`"
        ? new RegExp(`^\`{${fenceLen},}\\s*$`)
        : new RegExp(`^~{${fenceLen},}\\s*$`);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !closePat.test(lines[i]!.replace(/^ {0,3}/, ""))) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++;  // consume closing fence
      blocks.push(makeCodeBlock(codeLines.join("\n"), lang));
      continue;
    }

    // Divider (---, ***, ___)
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      blocks.push(makeDividerBlock());
      i++;
      continue;
    }

    // Image: ![alt](url) — only when it's the entire line. Parses the URL
    // with balanced parentheses so links like Wikipedia's Foo_(bar).png work.
    const parsedImage = parseImageLine(trimmed);
    if (parsedImage) {
      const { alt, url } = parsedImage;
      if (!/^https?:\/\//i.test(url)) {
        // Skip non-HTTP image URLs (javascript:, data:, file://, etc.)
        i++;
        continue;
      }
      // If the next non-blank line is a round-trip sidecar comment naming a
      // media type (video/file/pdf), upgrade the block's type so the original
      // Notion block type survives round-tripping from read → write.
      let blockType: "image" | "video" | "file" | "pdf" = "image";
      const sidecar = peekSidecar(lines, i + 1);
      if (sidecar && MEDIA_SIDECAR_TYPES.has(sidecar.type)) {
        blockType = sidecar.type as typeof blockType;
        i = sidecar.nextIdx;
      } else {
        i++;
      }
      const caption = alt ? [{ type: "text", text: { content: alt, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }, plain_text: alt, href: null }] : [];
      blocks.push({
        object: "block",
        id: "",
        type: blockType,
        has_children: false,
        [blockType]: {
          type: "external",
          external: { url },
          caption,
        },
      } as unknown as Block);
      continue;
    }

    // Bare link line: [caption](url) alone on a line. On its own this would
    // become a paragraph with a link, but when followed by a bookmark/
    // link_preview sidecar from the read path we upgrade it to that block type
    // so the round-trip preserves the original Notion block shape.
    if (trimmed.startsWith("[")) {
      const parsedLink = parseBareLinkLine(trimmed);
      if (parsedLink) {
        const sidecar = peekSidecar(lines, i + 1);
        if (sidecar && LINK_SIDECAR_TYPES.has(sidecar.type)) {
          if (sidecar.type === "embed") {
            blocks.push({
              object: "block",
              id: "",
              type: "embed",
              has_children: false,
              embed: { url: parsedLink.url },
            } as unknown as Block);
          } else {
            const blockType = sidecar.type as "bookmark" | "link_preview";
            const captionRuns = parsedLink.label && parsedLink.label !== parsedLink.url
              ? [{ type: "text", text: { content: parsedLink.label, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }, plain_text: parsedLink.label, href: null }]
              : [];
            blocks.push({
              object: "block",
              id: "",
              type: blockType,
              has_children: false,
              [blockType]: { url: parsedLink.url, caption: captionRuns },
            } as unknown as Block);
          }
          i = sidecar.nextIdx;
          continue;
        }
      }
    }

    // Headings
    if (/^#\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(1, trimmed.replace(/^#\s+/, "")));
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(2, trimmed.replace(/^##\s+/, "")));
      i++;
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(3, trimmed.replace(/^###\s+/, "")));
      i++;
      continue;
    }
    if (/^#{4,6}\s+/.test(trimmed)) {
      const text = trimmed.replace(/^#{4,6}\s+/, "");
      if (!ctx.warnedHeadingDowngrade) {
        process.stderr.write(
          "warning: Notion only supports H1-H3; H4/H5/H6 headings will be written as H3.\n",
        );
        ctx.warnedHeadingDowngrade = true;
      }
      blocks.push(makeHeadingBlock(3, text));
      i++;
      continue;
    }

    // Lists: bulleted, numbered, to-do — all indentation levels
    if (isListLine(line)) {
      const { blocks: listBlocks, nextIdx } = parseListSection(lines, i);
      blocks.push(...listBlocks);
      // Defense in depth: if parseListSection made no progress, force-advance
      // to avoid an infinite loop on a line that isListLine recognizes but
      // classifyListLine rejects. The main parser must always consume at
      // least one line per iteration or hang.
      i = nextIdx > i ? nextIdx : i + 1;
      continue;
    }

    // Quote (plain, no alert prefix — alerts handled below)
    if (/^>(?!\s*\[!)/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const ql = lines[i]!.trim();
        if (!/^>/.test(ql) || /^>\s*\[!/.test(ql)) break; // stop at non-quote or alert
        // Strip one or more levels of > prefix; flatten nested > > to single level
        const raw = ql.replace(/^>(\s?>)*\s?/, "");
        quoteLines.push(raw);
        i++;
      }
      // Recurse into the quote body so block-level constructs (lists, nested
      // code, headings) become structured children of the quote instead of
      // being collapsed into a flat rich_text run.
      //
      // Plain prose: when every inner block is a paragraph we keep the
      // legacy behavior of joining them into a single rich_text run with
      // double-newline separators — that matches how the read path renders
      // multi-paragraph blockquotes and round-trips cleanly.
      //
      // Mixed content (lists, code, etc.): emit non-paragraph blocks as
      // children. Any leading paragraph still becomes the quote's
      // rich_text body so the visual ordering is preserved.
      const innerMd = quoteLines.join("\n");
      const innerBlocks = innerMd.length > 0 ? markdownToBlocks(innerMd) : [];
      const allParagraphs = innerBlocks.length > 0
        && innerBlocks.every((b) => b.type === "paragraph");
      let quoteRichText: RichText[] = [];
      let quoteChildren: Block[] = [];
      if (allParagraphs) {
        // Concatenate each paragraph's rich_text runs directly, separating
        // paragraphs with a literal "\n\n" text run. Building a flat runs
        // array preserves inline annotations (bold, italic, links) that
        // would be stripped if we re-serialized to plain text and re-parsed.
        const sep: RichText = {
          type: "text",
          text: { content: "\n\n", link: null },
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
          plain_text: "\n\n",
          href: null,
        } as unknown as RichText;
        for (let bi = 0; bi < innerBlocks.length; bi++) {
          if (bi > 0) quoteRichText.push(sep);
          const runs = (innerBlocks[bi] as { paragraph: { rich_text: RichText[] } }).paragraph.rich_text;
          quoteRichText.push(...runs);
        }
      } else if (innerBlocks.length > 0 && innerBlocks[0]!.type === "paragraph") {
        quoteRichText = (innerBlocks[0]!.paragraph as { rich_text: RichText[] }).rich_text;
        quoteChildren = innerBlocks.slice(1);
      } else {
        quoteChildren = innerBlocks;
      }
      const quoteData: any = { rich_text: quoteRichText, color: "default" };
      if (quoteChildren.length > 0) quoteData.children = quoteChildren;
      blocks.push({
        object: "block",
        id: "",
        type: "quote",
        has_children: quoteChildren.length > 0,
        quote: quoteData,
      } as unknown as Block);
      continue;
    }

    // GFM alert (callout)
    if (/^>\s+\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.test(trimmed)) {
      const alertMatch = /^>\s+\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i.exec(trimmed);
      const alertType = (alertMatch?.[1] ?? "NOTE").toUpperCase();
      const firstLine = alertMatch?.[2] ?? "";
      i++;
      // Collect continuation lines (> text or bare >), stripping the > prefix
      const continuationLines: string[] = [];
      if (firstLine) continuationLines.push(firstLine);
      let overrideIcon: string | undefined;
      let overrideColor: string | undefined;
      while (i < lines.length) {
        const next = lines[i]!.trim();
        const iconComment = /^<!--\s*icon:\s*(\S+)\s*-->$/.exec(next);
        const colorComment = /^<!--\s*color:\s*(\S+)\s*-->$/.exec(next);
        if (iconComment) { overrideIcon = iconComment[1]!; i++; continue; }
        if (colorComment) { overrideColor = colorComment[1]!; i++; continue; }
        if (/^>\s/.test(next)) {
          continuationLines.push(next.slice(2));
          i++;
          continue;
        }
        if (/^>[^\s]/.test(next)) {
          // No space after > — still a valid continuation line
          continuationLines.push(next.slice(1));
          i++;
          continue;
        }
        if (next === ">") {
          // Bare > is a blank continuation line (paragraph break within callout)
          continuationLines.push("");
          i++;
          continue;
        }
        break;
      }
      // Parse continuation as markdown to detect child block structure
      const innerMd = continuationLines.join("\n").trim();
      const childBlocks = innerMd.length > 0 ? markdownToBlocksInternal(innerMd, ctx) : [];
      // First child paragraph becomes the callout's rich_text; rest become children
      let calloutRichText: RichText[] = [];
      let calloutChildren: Block[] = [];
      if (childBlocks.length > 0 && childBlocks[0]!.type === "paragraph") {
        calloutRichText = (childBlocks[0]!.paragraph as { rich_text: RichText[] }).rich_text;
        calloutChildren = childBlocks.slice(1);
      } else if (childBlocks.length > 0) {
        // No leading paragraph — put everything in children, use empty rich_text
        calloutChildren = childBlocks;
      } else {
        calloutRichText = markdownToRichText(innerMd);
      }
      const calloutData: any = {
        rich_text: calloutRichText,
        icon: { type: "emoji", emoji: overrideIcon ?? ALERT_TYPE_TO_EMOJI[alertType] ?? "💡" },
        color: overrideColor ?? ALERT_TYPE_TO_COLOR[alertType] ?? "default",
      };
      if (calloutChildren.length > 0) calloutData.children = calloutChildren;
      blocks.push({
        object: "block",
        id: "",
        type: "callout",
        has_children: calloutChildren.length > 0,
        callout: calloutData,
      } as unknown as Block);
      continue;
    }

    // HTML toggle: <details><summary>...</summary>...</details>
    if (/^<details>/i.test(trimmed)) {
      // Check if </details> is on the same line (inline form)
      const inlineCloseMatch = /^<details>(?:<summary>(.*?)<\/summary>)?(.*?)<\/details>/i.exec(trimmed);
      if (inlineCloseMatch) {
        const summary = inlineCloseMatch[1] ?? "";
        const bodyText = (inlineCloseMatch[2] ?? "").trim();
        const childBlocks = bodyText.length > 0 ? markdownToBlocksInternal(bodyText, ctx) : [];
        i++;
        const toggleData: any = { rich_text: markdownToRichText(summary), color: "default" };
        if (childBlocks.length > 0) toggleData.children = childBlocks;
        blocks.push({
          object: "block",
          id: "",
          type: "toggle",
          has_children: childBlocks.length > 0,
          toggle: toggleData,
        } as unknown as Block);
        continue;
      }

      // Multi-line form: scan for summary (may be on this line or next)
      let summary = "";
      const sameLine = /<summary>(.*?)<\/summary>/i.exec(trimmed);
      if (sameLine) {
        summary = sameLine[1] ?? "";
      }
      i++;
      // If summary not found on first line, check subsequent lines
      if (!summary && i < lines.length) {
        const nextSummary = /<summary>(.*?)<\/summary>/i.exec(lines[i]!);
        if (nextSummary) {
          summary = nextSummary[1] ?? "";
          i++;
        }
      }
      // Collect body lines until matching </details>, tracking nested depth
      const bodyLines: string[] = [];
      let detailsDepth = 0;
      while (i < lines.length) {
        const bodyLine = lines[i]!;
        if (/<details[\s>]/i.test(bodyLine)) detailsDepth++;
        if (/<\/details>/i.test(bodyLine)) {
          if (detailsDepth === 0) break;
          detailsDepth--;
        }
        bodyLines.push(bodyLine);
        i++;
      }
      i++; // consume </details>

      const bodyMd = bodyLines.join("\n").trim();
      const childBlocks = bodyMd.length > 0 ? markdownToBlocksInternal(bodyMd, ctx) : [];

      const toggleData: any = {
        rich_text: markdownToRichText(summary),
        color: "default",
      };
      if (childBlocks.length > 0) {
        toggleData.children = childBlocks;
      }

      blocks.push({
        object: "block",
        id: "",
        type: "toggle",
        has_children: childBlocks.length > 0,
        toggle: toggleData,
      } as unknown as Block);
      continue;
    }

    // Equation block — single-line $$expr$$ or multi-line $$ ... $$
    if (/^\$\$/.test(trimmed)) {
      if (/^\$\$.+\$\$$/.test(trimmed)) {
        // Single-line: $$expr$$
        const expr = trimmed.slice(2, -2);
        blocks.push({
          object: "block",
          id: "",
          type: "equation",
          has_children: false,
          equation: { expression: expr },
        } as unknown as Block);
        i++;
      } else {
        // Multi-line: opening $$ on its own line
        const eqLines: string[] = [];
        if (trimmed.length > 2) eqLines.push(trimmed.slice(2)); // text after opening $$
        i++;
        while (i < lines.length && !/^\$\$\s*$/.test(lines[i]!.trim())) {
          eqLines.push(lines[i]!);
          i++;
        }
        i++; // consume closing $$
        blocks.push({
          object: "block",
          id: "",
          type: "equation",
          has_children: false,
          equation: { expression: eqLines.join("\n") },
        } as unknown as Block);
      }
      continue;
    }

    // Round-trip sidecar comment with no preceding media line. These are
    // emitted by the read path for block types we can't reconstruct from
    // markdown — structural blocks (synced_block, column_list, etc.)
    // and Notion-hosted media (uploaded files/images/videos/pdfs whose URLs
    // are short-lived signed links Notion's own API can't re-ingest).
    // Creating a stub block here would fail Notion's API or silently store
    // an empty block, so we drop it and warn.
    const passMatch = PASS_THROUGH_RE.exec(trimmed);
    if (passMatch) {
      if (warnHandler) {
        const droppedType = passMatch[1]!;
        const isMedia = droppedType === "image" || droppedType === "video"
          || droppedType === "file" || droppedType === "pdf";
        const reason = isMedia
          ? `Notion-hosted media (uploaded files/images) cannot round-trip through markdown — the signed S3 URL is ephemeral. Re-upload with 'notionctl file upload' or use 'page append' for additive edits.`
          : `structural blocks (synced_block, column_list, etc.) cannot be expressed in markdown and are preserved only in the original Notion workspace.`;
        warnHandler(`notionctl: dropped '${droppedType}' block on write — ${reason}`);
      }
      i++;
      continue;
    }

    // Sidecar comment for tables without a column header (emitted by read path).
    // Consume it and let the following table inherit has_column_header=false.
    if (/^<!--\s*notion-table:\s*has_column_header=false\s*-->$/.test(trimmed)) {
      tableNoHeader = true;
      i++;
      continue;
    }

    // GFM table — separator row may have alignment colons: | :--- | ---: | :---: |
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|\s*:?---/.test(lines[i + 1]!.trim())) {
      const noHeader = tableNoHeader;
      tableNoHeader = false;
      const headerCells = parseTableRow(trimmed);
      i += 2;  // skip header + separator
      const rowBlocks: Block[] = [];
      // When has_column_header=false, the header row is a synthetic empty
      // row emitted by the read path — skip it from the block list.
      if (!noHeader) {
        rowBlocks.push({
          object: "block",
          id: "",
          type: "table_row",
          has_children: false,
          table_row: { cells: headerCells.map((c) => markdownToRichText(c)) },
        } as unknown as Block);
      }
      while (i < lines.length && /^\|.*\|$/.test(lines[i]!.trim())) {
        let rowCells = parseTableRow(lines[i]!.trim());
        // Normalize cell count to match header width (Notion API requires uniform width)
        if (rowCells.length > headerCells.length) rowCells = rowCells.slice(0, headerCells.length);
        while (rowCells.length < headerCells.length) rowCells.push("");
        rowBlocks.push({
          object: "block",
          id: "",
          type: "table_row",
          has_children: false,
          table_row: { cells: rowCells.map((c) => markdownToRichText(c)) },
        } as unknown as Block);
        i++;
      }
      blocks.push({
        object: "block",
        id: "",
        type: "table",
        has_children: true,
        table: {
          table_width: headerCells.length,
          has_column_header: !noHeader,
          has_row_header: false,
          children: rowBlocks,
        },
      } as unknown as Block);
      continue;
    }

    // Default: paragraph (may span multiple lines until blank line)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim().length > 0 && !isBlockStart(lines[i]!)) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push(makeParagraphBlock(paraLines.join("\n")));
  }

  // Strip empty id fields — Notion API rejects id:"" on new blocks.
  // Must recurse into type-specific children (e.g. table.children).
  stripEmptyIds(blocks);
  return blocks;
}

/**
 * Parse a standalone image line `![alt](url)` where the URL may contain
 * balanced parentheses (Wikipedia-style links) and optional title text.
 * Returns null if the line does not match the full `![...](...)` shape end-to-end.
 */
function parseImageLine(line: string): { alt: string; url: string } | null {
  if (!line.startsWith("![")) return null;
  let i = 2;
  let bracketDepth = 1;
  while (i < line.length) {
    if (line[i] === "\\") { i += 2; continue; }
    if (line[i] === "[") bracketDepth++;
    else if (line[i] === "]") {
      bracketDepth--;
      if (bracketDepth === 0) break;
    }
    i++;
  }
  if (bracketDepth !== 0) return null;
  const alt = line.slice(2, i);
  if (line[i + 1] !== "(") return null;
  let j = i + 2;
  const urlStart = j;
  let parenDepth = 1;
  while (j < line.length) {
    if (line[j] === "\\") { j += 2; continue; }
    if (line[j] === "(") parenDepth++;
    else if (line[j] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
    j++;
  }
  if (parenDepth !== 0) return null;
  if (j !== line.length - 1) return null;
  const inner = line.slice(urlStart, j);
  // Strip optional title: "<url> \"title\"" or "<url> 'title'"
  const titleMatch = /^(\S+)\s+(["']).*\2$/.exec(inner);
  const url = titleMatch ? titleMatch[1]! : inner.trim();
  return { alt, url };
}

/**
 * True when a line would be parsed as the start of a block rather than prose.
 * Exported so the read path can shield paragraph text that happens to look like
 * a marker — the two sides must agree on this set or round-trips silently
 * change block types.
 */
export function isBlockStart(line: string): boolean {
  const t = line.trim();
  return (
    /^#{1,6}\s/.test(t) ||
    /^[-*+]\s/.test(t) ||
    /^\d+\.\s/.test(t) ||
    /^>/.test(t) ||
    /^```/.test(t) ||
    /^[-*_]{3,}\s*$/.test(t) ||
    /^\|.*\|$/.test(t) ||
    /^\$\$/.test(t) ||
    /^!\[/.test(t) ||
    /^<details>/i.test(t) ||
    /^<!--\s*notion-block:/.test(t)
  );
}

/**
 * Undo the line-start shielding the read path applies (see `escapeBlockStarts`
 * in read.ts). Only a backslash that actually shields a marker is removed, so
 * text legitimately beginning with a backslash survives — `\\# foo` keeps its
 * backslash because `\# foo` is not itself a block start.
 */
function unescapeBlockStarts(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.startsWith("\\") && isBlockStart(l.slice(1)) ? l.slice(1) : l))
    .join("\n");
}

function makeParagraphBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "paragraph",
    has_children: false,
    paragraph: { rich_text: markdownToRichText(unescapeBlockStarts(text)), color: "default" },
  } as Block;
}

function makeHeadingBlock(level: 1 | 2 | 3, text: string): Block {
  const key = `heading_${level}` as const;
  return {
    object: "block",
    id: "",
    type: key,
    has_children: false,
    [key]: { rich_text: markdownToRichText(text), color: "default", is_toggleable: false },
  } as Block;
}

interface ListItem {
  type: "bulleted" | "numbered" | "todo";
  text: string;
  checked: boolean;
  indent: number;
  children: ListItem[];
  trailingBlocks: Block[];
}

function isListLine(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

function parseListSection(lines: string[], startIdx: number): { blocks: Block[]; nextIdx: number } {
  const rawItems: Omit<ListItem, "children" | "trailingBlocks">[] = [];
  const trailingBlocksMap = new Map<number, Block[]>();
  let i = startIdx;
  while (i < lines.length && isListLine(lines[i]!)) {
    const parsed = classifyListLine(lines[i]!);
    if (parsed === null) break;
    rawItems.push(parsed);
    const itemIdx = rawItems.length - 1;
    i++;
    // Peek for indented code fences belonging to this list item. A code fence
    // is considered part of the list item when it is indented at least as far
    // as the item's content start (indent + marker width, approximated as
    // indent + 2 so "- " items pick up 2-space-indented fences).
    const contentIndent = parsed.indent + 2;
    while (i < lines.length) {
      // Skip blank lines between the list item and a potential code fence
      let peek = i;
      while (peek < lines.length && lines[peek]!.trim().length === 0) peek++;
      if (peek >= lines.length) break;
      const peekLine = lines[peek]!;
      const peekLineIndent = (peekLine.match(/^(\s*)/) ?? ["", ""])[1]!.length;
      const peekTrimmed = peekLine.trim();
      const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(peekTrimmed);
      if (!fenceMatch || peekLineIndent < contentIndent) break;
      // Consume the indented code fence
      const fenceChar = fenceMatch[1]![0]!;
      const fenceLen = fenceMatch[1]!.length;
      const lang = fenceMatch[2]!.trim();
      const closePat = fenceChar === "`"
        ? new RegExp(`^\`{${fenceLen},}\\s*$`)
        : new RegExp(`^~{${fenceLen},}\\s*$`);
      const codeLines: string[] = [];
      i = peek + 1;
      while (i < lines.length && !closePat.test(lines[i]!.trim())) {
        // Strip up to contentIndent spaces of leading indentation from code body
        const codeLine = lines[i]!;
        const stripped = codeLine.length > contentIndent && /^\s+/.test(codeLine)
          ? codeLine.slice(Math.min(contentIndent, (codeLine.match(/^(\s*)/)![1]!.length)))
          : codeLine;
        codeLines.push(stripped);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      const blocks = trailingBlocksMap.get(itemIdx) ?? [];
      blocks.push(makeCodeBlock(codeLines.join("\n"), lang));
      trailingBlocksMap.set(itemIdx, blocks);
    }
  }
  const { items: tree, flattened } = capListDepth(buildListTree(rawItems, trailingBlocksMap));
  if (flattened > 0 && warnHandler) {
    warnHandler(
      `notionctl: ${flattened} list item${flattened === 1 ? "" : "s"} deeper than 2 levels were promoted to the maximum allowed depth. Notion's API supports at most 2 levels of nested children.`,
    );
  }
  return { blocks: tree.map(listItemToBlock), nextIdx: i };
}

function classifyListLine(line: string): Omit<ListItem, "children" | "trailingBlocks"> | null {
  const indent = (line.match(/^(\s*)/) ?? ["", ""])[1]!.length;
  const trimmed = line.trim();
  // Allow empty to-do bodies (`- [ ]` with no trailing text). The previous
  // regex required at least one whitespace + content, which silently
  // demoted bare checkboxes to bulleted list items containing "[x]".
  const todoMatch = /^-\s+\[([ xX])\](?:\s+(.*))?$/.exec(trimmed);
  if (todoMatch) {
    return { indent, type: "todo", text: todoMatch[2] ?? "", checked: todoMatch[1]!.toLowerCase() === "x" };
  }
  // Empty-body bullet (`- `, `*\t`, `+  `) — isListLine() on the untrimmed
  // line already confirmed it looks like a bullet, so accept it as an empty
  // item instead of returning null. Returning null used to leave the main
  // loop stuck at the same index because isListLine kept matching, producing
  // an infinite loop on innocuous input like "- \n- real".
  const emptyBulletMatch = /^[-*+]$/.exec(trimmed);
  if (emptyBulletMatch) {
    return { indent, type: "bulleted", text: "", checked: false };
  }
  const bulletMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
  if (bulletMatch) {
    return { indent, type: "bulleted", text: bulletMatch[1]!, checked: false };
  }
  // Same guard for numbered lists: `1.` with no body needs to be accepted as
  // an empty item rather than dropped to null.
  const emptyNumMatch = /^\d+\.$/.exec(trimmed);
  if (emptyNumMatch) {
    return { indent, type: "numbered", text: "", checked: false };
  }
  const numMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
  if (numMatch) {
    return { indent, type: "numbered", text: numMatch[1]!, checked: false };
  }
  return null;
}

function buildListTree(flat: Omit<ListItem, "children" | "trailingBlocks">[], trailingBlocksMap?: Map<number, Block[]>): ListItem[] {
  const roots: ListItem[] = [];
  const stack: ListItem[] = [];
  for (let idx = 0; idx < flat.length; idx++) {
    const raw = flat[idx]!;
    const item: ListItem = { ...raw, children: [], trailingBlocks: trailingBlocksMap?.get(idx) ?? [] };
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= item.indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(item);
    } else {
      stack[stack.length - 1]!.children.push(item);
    }
    stack.push(item);
  }
  return roots;
}

/**
 * Notion API allows max 2 levels of nested children (block → child → grandchild).
 * Items deeper than that are promoted up to the deepest allowed parent so
 * content is never silently dropped.
 */
const MAX_CHILD_DEPTH = 2;

/**
 * Set by the CLI entry so write.ts can warn about list depth flattening
 * without importing process.stderr directly. Tests leave it unset so test
 * output stays clean.
 */
let warnHandler: ((msg: string) => void) | null = null;
export function setMarkdownWarnHandler(fn: ((msg: string) => void) | null): void {
  warnHandler = fn;
}

function capListDepth(items: ListItem[], depth: number = 0): { items: ListItem[]; flattened: number } {
  const result: ListItem[] = [];
  let flattened = 0;
  for (const item of items) {
    if (depth + 1 >= MAX_CHILD_DEPTH) {
      result.push({ ...item, children: [] });
      const descendants = collectDescendants(item.children);
      if (descendants.length > 0) flattened += descendants.length;
      result.push(...descendants.map((c) => ({ ...c, children: [] })));
    } else {
      const capped = capListDepth(item.children, depth + 1);
      flattened += capped.flattened;
      result.push({ ...item, children: capped.items });
    }
  }
  return { items: result, flattened };
}

function collectDescendants(items: ListItem[]): ListItem[] {
  const result: ListItem[] = [];
  for (const item of items) {
    result.push(item);
    result.push(...collectDescendants(item.children));
  }
  return result;
}

function listItemToBlock(item: ListItem): Block {
  const childBlocks = [...item.children.map(listItemToBlock), ...item.trailingBlocks];
  if (item.type === "todo") {
    const body: any = {
      rich_text: markdownToRichText(item.text),
      checked: item.checked,
      color: "default",
    };
    if (childBlocks.length > 0) body.children = childBlocks;
    return {
      object: "block",
      type: "to_do",
      has_children: childBlocks.length > 0,
      to_do: body,
    } as unknown as Block;
  }
  if (item.type === "bulleted") {
    const body: any = {
      rich_text: markdownToRichText(item.text),
      color: "default",
    };
    if (childBlocks.length > 0) body.children = childBlocks;
    return {
      object: "block",
      type: "bulleted_list_item",
      has_children: childBlocks.length > 0,
      bulleted_list_item: body,
    } as unknown as Block;
  }
  const body: any = {
    rich_text: markdownToRichText(item.text),
    color: "default",
  };
  if (childBlocks.length > 0) body.children = childBlocks;
  return {
    object: "block",
    type: "numbered_list_item",
    has_children: childBlocks.length > 0,
    numbered_list_item: body,
  } as unknown as Block;
}

const VALID_LANGUAGES = new Set([
  "abap", "abc", "agda", "arduino", "ascii art", "assembly", "bash", "basic",
  "bnf", "c", "c#", "c++", "clojure", "coffeescript", "coq", "css", "dart",
  "dhall", "diff", "docker", "ebnf", "elixir", "elm", "erlang", "f#", "flow",
  "fortran", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "hcl",
  "html", "idris", "java", "javascript", "json", "julia", "kotlin", "latex",
  "less", "lisp", "livescript", "llvm ir", "lua", "makefile", "markdown",
  "markup", "matlab", "mathematica", "mermaid", "nix", "notion formula",
  "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell",
  "prolog", "protobuf", "purescript", "python", "r", "racket", "reason",
  "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "smalltalk",
  "solidity", "sql", "swift", "toml", "typescript", "vb.net", "verilog",
  "vhdl", "visual basic", "webassembly", "xml", "yaml", "java/c/c++/c#",
]);

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: "shell",
  zsh: "shell",
  fish: "shell",
  yml: "yaml",
  ts: "typescript",
  js: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cs: "c#",
  cpp: "c++",
  objc: "objective-c",
  kt: "kotlin",
  hs: "haskell",
  ex: "elixir",
  erl: "erlang",
  fs: "f#",
  vb: "visual basic",
  asm: "assembly",
  tf: "hcl",
  dockerfile: "docker",
  proto: "protobuf",
  tex: "latex",
  md: "markdown",
};

function makeCodeBlock(content: string, language: string): Block {
  const raw = language.toLowerCase() || "plain text";
  const resolved = LANGUAGE_ALIASES[raw] ?? raw;
  const lang = VALID_LANGUAGES.has(resolved) ? resolved : "plain text";
  const richText: RichText[] = [
    {
      type: "text",
      text: { content, link: null },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
      plain_text: content,
      href: null,
    },
  ];
  return {
    object: "block",
    id: "",
    type: "code",
    has_children: false,
    code: { rich_text: richText, caption: [], language: lang },
  } as Block;
}

function makeDividerBlock(): Block {
  return {
    object: "block",
    id: "",
    type: "divider",
    has_children: false,
    divider: {},
  } as Block;
}

function stripEmptyIds(blocks: unknown[]): void {
  for (const b of blocks as any[]) {
    if (b.id === "") delete b.id;
    // Recurse into type-specific children (e.g. table.children, list .children)
    const typeData = b[b.type];
    if (typeData?.children && Array.isArray(typeData.children)) {
      stripEmptyIds(typeData.children);
    }
    if (Array.isArray(b.children)) {
      stripEmptyIds(b.children);
    }
  }
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  // Split on unescaped | only (not \| and not inside backticks)
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "`") {
      inCode = !inCode;
      current += "`";
      continue;
    }
    if (inCode) {
      current += trimmed[i];
      continue;
    }
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++; // skip the escaped pipe
    } else if (trimmed[i] === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}
