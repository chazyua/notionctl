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
      return richTextToMarkdown(body.rich_text);
    }
    case "heading_1":
      return `# ${richTextToMarkdown(block.heading_1?.rich_text ?? [])}`;
    case "heading_2":
      return `## ${richTextToMarkdown(block.heading_2?.rich_text ?? [])}`;
    case "heading_3":
      return `### ${richTextToMarkdown(block.heading_3?.rich_text ?? [])}`;
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
    case "quote":
      return `> ${richTextToMarkdown(block.quote.rich_text)}`;
    case "code": {
      const lang = block.code.language === "plain text" ? "" : block.code.language;
      const content = block.code.rich_text.map((r) => r.plain_text).join("");
      return `\`\`\`${lang}\n${content}\n\`\`\``;
    }
    case "divider":
      return "---";
    case "callout": {
      const text = richTextToMarkdown(block.callout.rich_text);
      const icon = block.callout.icon;
      const emoji = icon?.type === "emoji" ? icon.emoji : "";
      const alertType = EMOJI_TO_ALERT_TYPE[emoji] ?? colorToAlertType(block.callout.color) ?? "NOTE";
      const lines: string[] = [`> [!${alertType}]`, `> ${text}`];
      // Preserve icon/color as sidecar comments only when they can't be inferred from alert type
      if (emoji && !EMOJI_TO_ALERT_TYPE[emoji]) {
        lines.splice(1, 0, `<!-- icon: ${emoji} -->`);
      }
      if (block.callout.color && block.callout.color !== "default" && !colorToAlertType(block.callout.color)) {
        lines.splice(1, 0, `<!-- color: ${block.callout.color} -->`);
      }
      return lines.join("\n");
    }
    case "toggle": {
      const summary = richTextToMarkdown(block.toggle.rich_text);
      return `<details><summary>${summary}</summary>\n\n</details>`;
    }
    case "equation":
      return `$$${block.equation.expression}$$`;
    case "table": {
      const tb = block as unknown as { table: { children?: unknown[] }; _children?: unknown[] };
      const rows = (tb.table.children ?? tb._children ?? []) as Array<{
        type: "table_row";
        table_row: { cells: RichText[][] };
      }>;
      if (rows.length === 0) return "";
      const lines: string[] = [];
      rows.forEach((row, i) => {
        const cells = row.table_row.cells.map((cell) =>
          richTextToMarkdown(cell).replace(/\|/g, "\\|"),
        );
        lines.push(`| ${cells.join(" | ")} |`);
        if (i === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      return lines.join("\n");
    }
    case "image":
    case "video":
    case "file":
    case "pdf": {
      const media = (block as unknown as { [key: string]: { caption?: Array<{ plain_text: string }>; external?: { url: string }; file?: { url: string } } })[block.type];
      const url = media?.external?.url ?? media?.file?.url ?? "";
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
