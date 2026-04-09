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
