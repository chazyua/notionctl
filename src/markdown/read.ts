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

import { richTextToMarkdown } from "./tokenizer.js";
import type { Block, RichText } from "./types.js";

const EMOJI_TO_ALERT_TYPE: Record<string, string> = {
  "💡": "NOTE",
  "🔥": "TIP",
  "⚠️": "WARNING",
  "❗": "IMPORTANT",
  "🛑": "CAUTION",
};

function colorToAlertType(color: string | undefined): string | null {
  if (!color) return null;
  if (color.startsWith("blue")) return "NOTE";
  if (color.startsWith("green")) return "TIP";
  if (color.startsWith("yellow")) return "WARNING";
  if (color.startsWith("red")) return "IMPORTANT";
  return null;
}

export interface RenderOptions {
  depth?: number;
}

export function blocksToMarkdown(blocks: Block[], opts: RenderOptions = {}): string {
  const depth = opts.depth ?? 0;
  const lines: string[] = [];
  let lastType: string | null = null;
  let numberedIndex = 0;

  for (const block of blocks) {
    const isListItem = block.type === "bulleted_list_item" || block.type === "numbered_list_item" || block.type === "to_do";
    const isSameList = lastType === block.type && isListItem;

    if (!isSameList && lastType !== null) {
      lines.push("");
    }
    if (!isSameList) numberedIndex = 0;

    const rendered = renderBlock(block, depth, numberedIndex);
    if (block.type === "numbered_list_item") numberedIndex++;

    if (rendered !== null) lines.push(rendered);
    lastType = block.type;
  }

  return lines.join("\n");
}

/**
 * Append a heading/paragraph's `_children` as nested block content after the
 * block's own line. Notion lets paragraphs and toggleable headings carry
 * children; leaving them out silently drops content from `page get`. Child
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
    if (rendered !== null) lines.push(rendered);
    if (block.type === "numbered_list_item") numIdx++;
    else numIdx = 0;
  }
  return lines.join("\n");
}

function renderBlock(block: Block, depth: number, numberedIndex: number): string | null {
  const indent = "  ".repeat(depth);
  switch (block.type) {
    case "paragraph": {
      const body = block.paragraph;
      const text = richTextToMarkdown(body.rich_text);
      return appendChildBlocks(text, block);
    }
    case "heading_1":
      return appendChildBlocks(`# ${richTextToMarkdown(block.heading_1?.rich_text ?? [])}`, block);
    case "heading_2":
      return appendChildBlocks(`## ${richTextToMarkdown(block.heading_2?.rich_text ?? [])}`, block);
    case "heading_3":
      return appendChildBlocks(`### ${richTextToMarkdown(block.heading_3?.rich_text ?? [])}`, block);
    case "bulleted_list_item": {
      const text = `${indent}- ${richTextToMarkdown(block.bulleted_list_item?.rich_text ?? [])}`;
      const nested = (block as any)._children as Block[] | undefined;
      return nested && nested.length > 0 ? `${text}\n${renderNestedList(nested, depth + 1)}` : text;
    }
    case "numbered_list_item": {
      const text = `${indent}${numberedIndex + 1}. ${richTextToMarkdown(block.numbered_list_item?.rich_text ?? [])}`;
      const nested = (block as any)._children as Block[] | undefined;
      return nested && nested.length > 0 ? `${text}\n${renderNestedList(nested, depth + 1)}` : text;
    }
    case "to_do": {
      const checked = block.to_do.checked ? "x" : " ";
      const text = `${indent}- [${checked}] ${richTextToMarkdown(block.to_do.rich_text)}`;
      const nested = (block as any)._children as Block[] | undefined;
      return nested && nested.length > 0 ? `${text}\n${renderNestedList(nested, depth + 1)}` : text;
    }
    case "quote": {
      const quoteText = richTextToMarkdown(block.quote.rich_text);
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
      return `${fence}${lang}\n${content}\n${fence}`;
    }
    case "divider":
      return "---";
    case "callout": {
      const text = richTextToMarkdown(block.callout.rich_text);
      const icon = block.callout.icon;
      const emoji = icon?.type === "emoji" ? icon.emoji : "";
      const alertType = EMOJI_TO_ALERT_TYPE[emoji] ?? colorToAlertType(block.callout.color) ?? "NOTE";
      const textPrefixed = text.split("\n").map((l) => `> ${l}`).join("\n");
      const lines: string[] = [`> [!${alertType}]`, textPrefixed];
      // Preserve icon/color as sidecar comments only when they can't be inferred from alert type
      if (emoji && !EMOJI_TO_ALERT_TYPE[emoji]) {
        lines.splice(1, 0, `<!-- icon: ${emoji} -->`);
      }
      if (block.callout.color && block.callout.color !== "default" && !colorToAlertType(block.callout.color)) {
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
    case "toggle": {
      const summary = richTextToMarkdown(block.toggle.rich_text);
      const nested = (block as any)._children as Block[] | undefined;
      const body = nested && nested.length > 0 ? "\n" + blocksToMarkdown(nested) + "\n" : "\n";
      return `<details><summary>${summary}</summary>\n${body}</details>`;
    }
    case "equation":
      return `$$${block.equation.expression}$$`;
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
            richTextToMarkdown(cell).replace(/\|/g, "\\|"),
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
            richTextToMarkdown(cell).replace(/\|/g, "\\|"),
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
      const label = caption || block.type;
      return `![${label}](${url})\n<!-- notion-block: ${block.type} id=${block.id} -->`;
    }
    case "bookmark":
    case "link_preview": {
      const bm = (block as unknown as { [key: string]: { url?: string; caption?: Array<{ plain_text: string }> } })[block.type];
      const url = bm?.url ?? "";
      const caption = (bm?.caption ?? []).map((r) => r.plain_text).join("");
      return `[${caption || url}](${url})\n<!-- notion-block: ${block.type} id=${block.id} -->`;
    }
    case "child_page":
    case "child_database": {
      const body = (block as unknown as { [key: string]: { title?: string } })[block.type];
      const title = body?.title ?? "Untitled";
      const kind = block.type === "child_page" ? "page" : "database";
      return `[${title}](notion://${kind}/${block.id})`;
    }
    case "synced_block":
    case "column_list":
    case "column":
    case "embed":
    case "table_of_contents":
    case "breadcrumb":
    default:
      return `<!-- notion-block: ${block.type} id=${block.id} -->`;
  }
}
