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
      while (i < lines.length && !closePat.test(lines[i]!.trim())) {
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

    // Image: ![alt](url) — only when it's the entire line
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (imgMatch) {
      const alt = imgMatch[1]!;
      const url = imgMatch[2]!;
      if (!/^https?:\/\//i.test(url)) {
        // Skip non-HTTP image URLs (javascript:, data:, file://, etc.)
        i++;
        continue;
      }
      blocks.push({
        object: "block",
        id: "",
        type: "image",
        has_children: false,
        image: {
          type: "external",
          external: { url },
          caption: alt ? [{ type: "text", text: { content: alt, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }, plain_text: alt, href: null }] : [],
        },
      } as unknown as Block);
      i++;
      continue;
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
      blocks.push(makeHeadingBlock(3, text));
      i++;
      continue;
    }

    // Lists: bulleted, numbered, to-do — all indentation levels
    if (isListLine(line)) {
      const { blocks: listBlocks, nextIdx } = parseListSection(lines, i);
      blocks.push(...listBlocks);
      i = nextIdx;
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
      blocks.push(makeQuoteBlock(quoteLines.join("\n")));
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
      const childBlocks = innerMd.length > 0 ? markdownToBlocks(innerMd) : [];
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
        const childBlocks = bodyText.length > 0 ? markdownToBlocks(bodyText) : [];
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
      const childBlocks = bodyMd.length > 0 ? markdownToBlocks(bodyMd) : [];

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

    // GFM table — separator row may have alignment colons: | :--- | ---: | :---: |
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|\s*:?---/.test(lines[i + 1]!.trim())) {
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

  // Strip empty id fields — Notion API rejects id:"" on new blocks.
  // Must recurse into type-specific children (e.g. table.children).
  stripEmptyIds(blocks);
  return blocks;
}

function isBlockStart(line: string): boolean {
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

interface ListItem {
  type: "bulleted" | "numbered" | "todo";
  text: string;
  checked: boolean;
  indent: number;
  children: ListItem[];
}

function isListLine(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

function parseListSection(lines: string[], startIdx: number): { blocks: Block[]; nextIdx: number } {
  const rawItems: Omit<ListItem, "children">[] = [];
  let i = startIdx;
  while (i < lines.length && isListLine(lines[i]!)) {
    const parsed = classifyListLine(lines[i]!);
    if (parsed === null) break;
    rawItems.push(parsed);
    i++;
  }
  const tree = capListDepth(buildListTree(rawItems));
  return { blocks: tree.map(listItemToBlock), nextIdx: i };
}

function classifyListLine(line: string): Omit<ListItem, "children"> | null {
  const indent = (line.match(/^(\s*)/) ?? ["", ""])[1]!.length;
  const trimmed = line.trim();
  const todoMatch = /^-\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
  if (todoMatch) {
    return { indent, type: "todo", text: todoMatch[2]!, checked: todoMatch[1]!.toLowerCase() === "x" };
  }
  const bulletMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
  if (bulletMatch) {
    return { indent, type: "bulleted", text: bulletMatch[1]!, checked: false };
  }
  const numMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
  if (numMatch) {
    return { indent, type: "numbered", text: numMatch[1]!, checked: false };
  }
  return null;
}

function buildListTree(flat: Omit<ListItem, "children">[]): ListItem[] {
  const roots: ListItem[] = [];
  const stack: ListItem[] = [];
  for (const raw of flat) {
    const item: ListItem = { ...raw, children: [] };
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

function capListDepth(items: ListItem[], depth: number = 0): ListItem[] {
  const result: ListItem[] = [];
  for (const item of items) {
    if (depth + 1 >= MAX_CHILD_DEPTH) {
      // This item's children would exceed the limit. Promote all
      // descendants to be siblings of this item (at the same level).
      result.push({ ...item, children: [] });
      result.push(...collectDescendants(item.children).map((c) => ({ ...c, children: [] })));
    } else {
      result.push({ ...item, children: capListDepth(item.children, depth + 1) });
    }
  }
  return result;
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
  const childBlocks = item.children.map(listItemToBlock);
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

function makeQuoteBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "quote",
    has_children: false,
    quote: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
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
