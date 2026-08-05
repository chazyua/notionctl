/**
 * Block tree → Markdown conversion (read path).
 *
 * Walks a Notion block array and emits GitHub Flavored Markdown with our
 * three extensions: YAML front-matter (handled elsewhere), GFM alerts for
 * callouts, and HTML <details> for toggles. Blocks we can't natively
 * express become HTML comments with block IDs so the write path can
 * preserve them on update.
 *
 * Split across Tasks 17 (basic) and 18 (complex). Both tasks modify
 * this file in sequence.
 */

import { escapeMarkdownContent, richTextToMarkdown } from "./tokenizer.js";
import { isBlockStart } from "./write.js";
import type { Block, CalloutIcon, RichText } from "./types.js";
import { HOSTED_ICON } from "./types.js";

const EMOJI_TO_ALERT_TYPE: Record<string, string> = {
  "💡": "NOTE",
  "🔥": "TIP",
  "⚠️": "WARNING",
  "❗": "IMPORTANT",
  "🛑": "CAUTION",
};

/**
 * The alert type already carries the icon when it is one of the five emoji GFM
 * alerts map to; every other icon needs a sidecar or a default replaces it on
 * the way back. Notion-hosted and custom-emoji icons cannot be rebuilt — the
 * first is a signed URL that expires, the second is workspace-local — so they
 * are marked as such and the write path warns instead of inventing one.
 */
function calloutIconSidecar(icon: CalloutIcon | null | undefined): string | null {
  if (!icon) return null;
  const value = icon.type === "emoji"
    ? (EMOJI_TO_ALERT_TYPE[icon.emoji] ? null : icon.emoji)
    : icon.type === "external"
      ? icon.external.url
      : icon.type === "icon"
        ? `notion:${icon.icon.name}:${icon.icon.color}`
        : HOSTED_ICON;
  // The sidecar occupies exactly one line. A line break in a value coming back
  // from the API would otherwise splice whatever followed it into the callout.
  return value === null ? null : value.replace(/[\r\n]+/g, " ");
}

function colorToAlertType(color: string | undefined): string | null {
  if (!color) return null;
  if (color.startsWith("blue")) return "NOTE";
  if (color.startsWith("green")) return "TIP";
  if (color.startsWith("yellow")) return "WARNING";
  if (color.startsWith("red")) return "IMPORTANT";
  return null;
}

/** Colour each alert type implies on the way back, so we only note a difference. */
const ALERT_TYPE_TO_COLOR_BY_NAME: Record<string, string> = {
  NOTE: "blue_background",
  TIP: "green_background",
  WARNING: "yellow_background",
  IMPORTANT: "red_background",
  CAUTION: "red_background",
};

const LIST_ITEM_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);

export interface RenderOptions {
  depth?: number;
}

export function blocksToMarkdown(blocks: Block[], opts: RenderOptions = {}): string {
  const depth = opts.depth ?? 0;
  const lines: string[] = [];
  let lastType: string | null = null;
  let numberedIndex = 0;

  for (const block of blocks) {
    const isListItem = LIST_ITEM_TYPES.has(block.type);
    const isSameList = lastType === block.type && isListItem;

    if (!isSameList) numberedIndex = 0;

    const rendered = renderBlock(block, depth, numberedIndex);
    if (block.type === "numbered_list_item") numberedIndex++;

    // Only a block that actually renders gets a separator, and only once
    // something precedes it. A block that renders to nothing used to
    // contribute blank lines anyway — at the top of the file those were
    // stripped when it was read back, so the content no longer matched its own
    // hash and every sync of an untouched file reported a change.
    if (rendered !== null && rendered.length > 0) {
      if (!isSameList && lines.length > 0) lines.push("");
      lines.push(rendered);
    }
    lastType = block.type;
  }

  return lines.join("\n");
}

/**
 * Append a paragraph's `_children` as nested block content after the block's
 * own line. Notion lets paragraphs carry children; leaving them out silently
 * drops content from `page get`. Toggleable headings do not come through here —
 * they render as `<details>`, which nests its own children. Child
 * blocks render at the same top-level indent (not as list indentation),
 * separated by a blank line so downstream block detection still works.
 */
function appendChildBlocks(headLine: string, block: Block): string {
  const children = (block as { _children?: Block[] })._children;
  if (!children || children.length === 0) return headLine;
  const rendered = blocksToMarkdown(children);
  if (rendered.length === 0) return headLine;
  return `${headLine}\n\n${rendered}`;
}

function renderNestedList(blocks: Block[], depth: number): string {
  const lines: string[] = [];
  let numIdx = 0;
  for (const block of blocks) {
    const rendered = renderBlock(block, depth, numIdx);
    if (rendered !== null) {
      const isListItem = LIST_ITEM_TYPES.has(block.type);
      // A list item indents itself. Anything else — an extra paragraph, a
      // quote — has to be indented here and set off by a blank line, or the
      // write path reads it back as a top-level sibling of the list.
      lines.push(isListItem ? rendered : `\n${indentLines(rendered, depth)}`);
    }
    if (block.type === "numbered_list_item") numIdx++;
    else numIdx = 0;
  }
  return lines.join("\n");
}

function indentLines(text: string, depth: number): string {
  const pad = "  ".repeat(depth);
  return text.split("\n").map((l) => (l.length > 0 ? pad + l : l)).join("\n");
}

/**
 * Prose that happens to begin with a block marker would be re-read as that block
 * on the next write: a paragraph reading `---` came back as a divider with the
 * text gone, `# note` became a heading, `- note` became a bullet. Shield each
 * such line with a backslash; write.ts strips it back off.
 *
 * Applied to the already inline-escaped rendering, so markers the inline escaper
 * covers (`*`, `_`, backtick) are no longer block starts by the time we look and
 * never pick up a second, redundant backslash.
 */
function escapeBlockStarts(text: string): string {
  return text
    .split("\n")
    .map((l) => (isBlockStart(l) ? `\\${l}` : l))
    .join("\n");
}

const HEADING_LEVEL: Record<string, 1 | 2 | 3> = { heading_1: 1, heading_2: 2, heading_3: 3 };

/**
 * A Markdown heading is a single line by definition, so a soft line break
 * inside one has nowhere to go: written out literally it reads as a heading
 * followed by a separate paragraph, which is what used to come back. Collapse
 * the break to a space — a documented, stable normalisation — rather than
 * invent syntax no other Markdown tool would understand.
 */
function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ");
}

/**
 * A summary sits inside an HTML element, so a literal `</summary>` or
 * `</details>` in the title closes it early and everything after it is lost.
 * Escape those two sequences, and anything already looking escaped, so the
 * pair stays reversible; write.ts decodes it.
 */
function escapeSummary(text: string): string {
  return text
    .replace(/&(?=(?:amp;)*lt;\/(?:summary|details)>)/gi, "&amp;")
    .replace(/<(\/(?:summary|details)>)/gi, "&lt;$1");
}

/** `<details>` rendering, shared by toggles and toggleable headings. */
function renderDisclosure(summary: string, children: Block[] | undefined): string {
  const body = children && children.length > 0 ? "\n" + blocksToMarkdown(children) + "\n" : "\n";
  // A summary is one line by construction, so a line break inside it has to
  // collapse here — written out raw it ended the element early and the title
  // was lost entirely.
  return `<details><summary>${escapeSummary(singleLine(summary))}</summary>\n${body}</details>`;
}

function renderBlock(block: Block, depth: number, numberedIndex: number): string | null {
  const indent = "  ".repeat(depth);
  switch (block.type) {
    case "paragraph": {
      const body = block.paragraph;
      const text = escapeBlockStarts(richTextToMarkdown(body.rich_text));
      return appendChildBlocks(text, block);
    }
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = HEADING_LEVEL[block.type]!;
      const data = (block as unknown as Record<string, { rich_text?: RichText[]; is_toggleable?: boolean }>)[block.type];
      const text = richTextToMarkdown(data?.rich_text ?? []);
      // A toggleable heading is a disclosure widget that happens to be styled
      // as a heading, so it round-trips through <details> with a sidecar
      // naming the level. Rendering it as `# text` would lose both the toggle
      // and, with it, any home for its children.
      if (data?.is_toggleable) {
        const kids = (block as { _children?: Block[] })._children
          ?? (data as { children?: Block[] }).children;
        return `<!-- notion-heading: ${level} -->\n${renderDisclosure(text, kids)}`;
      }
      return appendChildBlocks(`${"#".repeat(level)} ${singleLine(text)}`, block);
    }
    case "bulleted_list_item": {
      const text = `${indent}- ${singleLine(richTextToMarkdown(block.bulleted_list_item?.rich_text ?? []))}`;
      const nested = (block as any)._children as Block[] | undefined;
      return nested && nested.length > 0 ? `${text}\n${renderNestedList(nested, depth + 1)}` : text;
    }
    case "numbered_list_item": {
      const text = `${indent}${numberedIndex + 1}. ${singleLine(richTextToMarkdown(block.numbered_list_item?.rich_text ?? []))}`;
      const nested = (block as any)._children as Block[] | undefined;
      return nested && nested.length > 0 ? `${text}\n${renderNestedList(nested, depth + 1)}` : text;
    }
    case "to_do": {
      const checked = block.to_do.checked ? "x" : " ";
      const text = `${indent}- [${checked}] ${singleLine(richTextToMarkdown(block.to_do.rich_text))}`;
      const nested = (block as any)._children as Block[] | undefined;
      return nested && nested.length > 0 ? `${text}\n${renderNestedList(nested, depth + 1)}` : text;
    }
    case "quote": {
      const quoteText = escapeBlockStarts(richTextToMarkdown(block.quote.rich_text));
      const quoteChildren = (block as any)._children as Block[] | undefined;
      const quotePrefixed = quoteText.split("\n").map((l) => `> ${l}`).join("\n");
      if (quoteChildren && quoteChildren.length > 0) {
        // Emit a blank `>` line between the quote's own rich_text and its
        // child blocks so the write path sees an explicit paragraph break
        // on round-trip. Without this, a second paragraph stored as a child
        // collapses into the main rich_text on the next sync.
        const childMd = blocksToMarkdown(quoteChildren);
        const childLines = childMd.split("\n").map((l) => `> ${l}`).join("\n");
        const separator = quoteText.length > 0 ? "\n>\n" : "\n";
        return `${quotePrefixed}${separator}${childLines}`;
      }
      return quotePrefixed;
    }
    case "code": {
      const lang = block.code.language === "plain text" ? "" : block.code.language;
      const content = block.code.rich_text.map((r) => r.plain_text).join("");
      // Pick a fence longer than any backtick run inside the content so the
      // round-trip survives code blocks that themselves contain ``` markers.
      let longest = 0;
      const matches = content.match(/`+/g);
      if (matches) for (const m of matches) if (m.length > longest) longest = m.length;
      const fence = "`".repeat(Math.max(3, longest + 1));
      // Nesting under a list item is applied by renderNestedList, which owns
      // the indent for every non-list child.
      return `${fence}${lang}\n${content}\n${fence}`;
    }
    case "divider":
      // `***` rather than `---`, which is a thematic break in every Markdown
      // dialect but is also a front-matter delimiter and a setext underline.
      // A page whose first block is a divider used to read back as something
      // indistinguishable from front-matter, and its opening section was
      // dropped; emitting the unambiguous form removes the class entirely.
      return "***";
    case "callout": {
      const text = escapeBlockStarts(richTextToMarkdown(block.callout.rich_text));
      const icon = block.callout.icon;
      const emoji = icon?.type === "emoji" ? icon.emoji : "";
      const alertType = EMOJI_TO_ALERT_TYPE[emoji] ?? colorToAlertType(block.callout.color) ?? "NOTE";
      const textPrefixed = text.split("\n").map((l) => `> ${l}`).join("\n");
      const lines: string[] = [`> [!${alertType}]`, textPrefixed];
      // Preserve icon/color as sidecar comments only when they can't be inferred from alert type
      const iconSidecar = calloutIconSidecar(icon);
      if (iconSidecar !== null) {
        lines.splice(1, 0, `<!-- icon: ${iconSidecar} -->`);
      }
      if (block.callout.color && ALERT_TYPE_TO_COLOR_BY_NAME[alertType] !== block.callout.color) {
        lines.splice(1, 0, `<!-- color: ${block.callout.color} -->`);
      }
      // Render nested children as continuation lines. Insert a blank `>`
      // line between the main text and the first child so a child paragraph
      // stays a separate paragraph on round-trip rather than collapsing
      // into the callout's rich_text on the next write pass.
      const calloutChildren = (block as any)._children as Block[] | undefined;
      if (calloutChildren && calloutChildren.length > 0) {
        if (text.length > 0) lines.push(">");
        const childMd = blocksToMarkdown(calloutChildren);
        for (const cl of childMd.split("\n")) {
          lines.push(`> ${cl}`);
        }
      }
      return lines.join("\n");
    }
    case "toggle":
      return renderDisclosure(
        richTextToMarkdown(block.toggle.rich_text),
        (block as { _children?: Block[] })._children ?? block.toggle.children,
      );
    case "equation": {
      const expr = block.equation.expression;
      // A closing `$$` is only recognised alone on a line, so anything that is
      // not a simple one-liner has to use the fenced form. Written inline, a
      // multi-line or empty expression swallowed the rest of the page.
      if (expr.length > 0 && !expr.includes("\n")) return `$$${expr}$$`;
      // A line inside the expression that is itself `$$` would terminate the
      // fence early, truncating the equation and spilling the rest as prose.
      const shielded = expr.split("\n").map((l) => (/^\$\$\s*$/.test(l) ? `\\${l}` : l)).join("\n");
      return `$$\n${shielded}\n$$`;
    }
    case "table": {
      const tb = block as unknown as { table: { children?: unknown[]; has_column_header?: boolean }; _children?: unknown[] };
      const rows = (tb.table.children ?? tb._children ?? []) as Array<{
        type: "table_row";
        table_row: { cells: RichText[][] };
      }>;
      if (rows.length === 0) return "";
      const hasHeader = tb.table.has_column_header !== false;
      const lines: string[] = [];
      if (hasHeader) {
        rows.forEach((row, i) => {
          const cells = row.table_row.cells.map((cell) =>
            singleLine(richTextToMarkdown(cell)).replace(/\|/g, "\\|"),
          );
          lines.push(`| ${cells.join(" | ")} |`);
          if (i === 0) {
            lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
        });
      } else {
        // No column header: synthesize an empty header row so the output
        // is still a valid GFM table (write path needs the separator).
        // Round-trip back to Notion will recreate it as has_column_header=true,
        // but a comment marker preserves the intent for future versions.
        const width = rows[0]?.table_row.cells.length ?? 0;
        lines.push(`<!-- notion-table: has_column_header=false -->`);
        lines.push(`| ${Array.from({ length: width }, () => " ").join(" | ")} |`);
        lines.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
        for (const row of rows) {
          const cells = row.table_row.cells.map((cell) =>
            singleLine(richTextToMarkdown(cell)).replace(/\|/g, "\\|"),
          );
          lines.push(`| ${cells.join(" | ")} |`);
        }
      }
      return lines.join("\n");
    }
    case "image":
    case "video":
    case "file":
    case "pdf": {
      const media = (block as unknown as { [key: string]: { caption?: Array<{ plain_text: string }>; external?: { url: string }; file?: { url: string }; name?: string; type?: string } })[block.type];
      // External sources round-trip cleanly through markdown (the URL is a
      // stable public URL). Notion-hosted sources (`type: "file"` or a
      // file_upload id) cannot: their URLs are short-lived signed S3 links
      // that Notion's own API refuses to re-ingest, so round-tripping them
      // through page update creates an empty block. Emit only the sidecar
      // comment so the write path can silently drop them and warn.
      const isExternal = media?.type === "external" && !!media?.external?.url;
      const isHosted = !isExternal;
      if (isHosted) {
        const name = media?.name ?? "";
        const nameLabel = name ? ` name=${JSON.stringify(name)}` : "";
        return `<!-- notion-block: ${block.type} id=${block.id}${nameLabel} hosted=notion -->`;
      }
      const url = media?.external?.url ?? "";
      const caption = (media?.caption ?? []).map((r) => r.plain_text).join("");
      const label = escapeMarkdownContent(caption || block.type);
      return `![${label}](${url})\n<!-- notion-block: ${block.type} id=${block.id} -->`;
    }
    case "bookmark":
    case "link_preview": {
      const bm = (block as unknown as { [key: string]: { url?: string; caption?: Array<{ plain_text: string }> } })[block.type];
      const url = bm?.url ?? "";
      const caption = (bm?.caption ?? []).map((r) => r.plain_text).join("");
      return `[${escapeMarkdownContent(caption || url)}](${url})\n<!-- notion-block: ${block.type} id=${block.id} -->`;
    }
    case "child_page":
    case "child_database": {
      const body = (block as unknown as { [key: string]: { title?: string } })[block.type];
      const title = body?.title ?? "Untitled";
      const kind = block.type === "child_page" ? "page" : "database";
      return `[${escapeMarkdownContent(title)}](notion://${kind}/${block.id})`;
    }
    case "column_list": {
      const columns = (block as { _children?: Block[] })._children;
      if (!columns || columns.length === 0) {
        return `<!-- notion-block: column_list id=${block.id} -->`;
      }
      const parts: string[] = [`<!-- notion-block: column_list id=${block.id} -->`];
      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci]!;
        const colChildren = (col as { _children?: Block[] })._children;
        if (colChildren && colChildren.length > 0) {
          parts.push(blocksToMarkdown(colChildren));
        }
      }
      return parts.join("\n\n");
    }
    case "column":
      // Columns are rendered by the column_list parent.
      return null;
    case "embed": {
      const em = (block as unknown as { embed?: { url?: string; caption?: Array<{ plain_text: string }> } }).embed;
      const emUrl = em?.url ?? "";
      const emCaption = (em?.caption ?? []).map((r) => r.plain_text).join("");
      return `[${escapeMarkdownContent(emCaption || emUrl)}](${emUrl})\n<!-- notion-block: embed id=${block.id} -->`;
    }
    case "synced_block":
    case "table_of_contents":
    case "breadcrumb":
    default:
      return `<!-- notion-block: ${block.type} id=${block.id} -->`;
  }
}
