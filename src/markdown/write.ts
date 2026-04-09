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

export function markdownToBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i++;
      continue;
    }

    // Fenced code block
    if (/^```/.test(trimmed)) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++;  // consume closing fence
      blocks.push(makeCodeBlock(codeLines.join("\n"), lang));
      continue;
    }

    // Divider
    if (/^---$/.test(trimmed) || /^---\s*$/.test(trimmed)) {
      blocks.push(makeDividerBlock());
      i++;
      continue;
    }

    // Headings
    if (/^#\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(1, trimmed.slice(2)));
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(2, trimmed.slice(3)));
      i++;
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(3, trimmed.slice(4)));
      i++;
      continue;
    }

    // To-do (must check before bullet)
    const todoMatch = /^-\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (todoMatch) {
      const checked = todoMatch[1]!.toLowerCase() === "x";
      blocks.push(makeTodoBlock(todoMatch[2]!, checked));
      i++;
      continue;
    }

    // Bulleted list
    if (/^-\s+/.test(trimmed)) {
      blocks.push(makeBulletedBlock(trimmed.slice(2)));
      i++;
      continue;
    }

    // Numbered list
    const numMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (numMatch) {
      blocks.push(makeNumberedBlock(numMatch[2]!));
      i++;
      continue;
    }

    // Quote (plain, no alert prefix — alerts handled in Task 20)
    if (/^>\s+/.test(trimmed) && !/^>\s+\[!/.test(trimmed)) {
      blocks.push(makeQuoteBlock(trimmed.slice(2)));
      i++;
      continue;
    }

    // GFM alert (callout)
    if (/^>\s+\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.test(trimmed)) {
      const alertMatch = /^>\s+\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i.exec(trimmed);
      const calloutText = alertMatch?.[2] ?? "";
      i++;
      // Collect optional sidecar comments (icon, color)
      let icon: { type: "emoji"; emoji: string } | null = null;
      let color = "default";
      while (i < lines.length) {
        const next = lines[i]!.trim();
        const iconMatch = /^<!--\s*icon:\s*(\S+)\s*-->$/.exec(next);
        const colorMatch = /^<!--\s*color:\s*(\S+)\s*-->$/.exec(next);
        if (iconMatch) { icon = { type: "emoji", emoji: iconMatch[1]! }; i++; continue; }
        if (colorMatch) { color = colorMatch[1]!; i++; continue; }
        break;
      }
      blocks.push({
        object: "block",
        id: "",
        type: "callout",
        has_children: false,
        callout: {
          rich_text: markdownToRichText(calloutText),
          icon: icon ?? { type: "emoji", emoji: "💡" },
          color,
        },
      } as unknown as Block);
      continue;
    }

    // HTML toggle: <details><summary>...</summary>...</details>
    if (/^<details>/i.test(trimmed)) {
      const summaryMatch = /<summary>(.*?)<\/summary>/i.exec(trimmed);
      const summary = summaryMatch?.[1] ?? "";
      i++;
      while (i < lines.length && !/<\/details>/i.test(lines[i]!)) i++;
      i++;  // consume closing tag
      blocks.push({
        object: "block",
        id: "",
        type: "toggle",
        has_children: false,
        toggle: { rich_text: markdownToRichText(summary), color: "default" },
      } as unknown as Block);
      continue;
    }

    // Equation block
    if (/^\$\$.*\$\$$/.test(trimmed)) {
      const expr = trimmed.slice(2, -2);
      blocks.push({
        object: "block",
        id: "",
        type: "equation",
        has_children: false,
        equation: { expression: expr },
      } as unknown as Block);
      i++;
      continue;
    }

    // Pass-through HTML comment
    const passMatch = /^<!--\s*notion-block:\s*(\w+)\s+id=([\w-]+)\s*-->$/.exec(trimmed);
    if (passMatch) {
      blocks.push({
        object: "block",
        id: passMatch[2]!,
        type: passMatch[1]! as Block["type"],
        has_children: false,
      } as Block);
      i++;
      continue;
    }

    // GFM table
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|\s*---/.test(lines[i + 1]!.trim())) {
      const headerCells = parseTableRow(trimmed);
      i += 2;  // skip header + separator
      const rowBlocks: Block[] = [
        {
          object: "block",
          id: "",
          type: "table_row",
          has_children: false,
          table_row: { cells: headerCells.map((c) => markdownToRichText(c)) },
        } as unknown as Block,
      ];
      while (i < lines.length && /^\|.*\|$/.test(lines[i]!.trim())) {
        const rowCells = parseTableRow(lines[i]!.trim());
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
          has_column_header: true,
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

  return blocks;
}

function isBlockStart(line: string): boolean {
  const t = line.trim();
  return (
    /^#{1,3}\s/.test(t) ||
    /^-\s/.test(t) ||
    /^\d+\.\s/.test(t) ||
    /^>\s/.test(t) ||
    /^```/.test(t) ||
    /^---$/.test(t)
  );
}

function makeParagraphBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "paragraph",
    has_children: false,
    paragraph: { rich_text: markdownToRichText(text), color: "default" },
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

function makeBulletedBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "bulleted_list_item",
    has_children: false,
    bulleted_list_item: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeNumberedBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "numbered_list_item",
    has_children: false,
    numbered_list_item: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeTodoBlock(text: string, checked: boolean): Block {
  return {
    object: "block",
    id: "",
    type: "to_do",
    has_children: false,
    to_do: { rich_text: markdownToRichText(text), checked, color: "default" },
  } as Block;
}

function makeQuoteBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "quote",
    has_children: false,
    quote: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeCodeBlock(content: string, language: string): Block {
  const lang = language || "plain text";
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

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
}
