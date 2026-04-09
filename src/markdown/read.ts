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
import type { Block } from "./types.js";

export interface RenderOptions {
  depth?: number;
}

export function blocksToMarkdown(blocks: Block[], opts: RenderOptions = {}): string {
  const depth = opts.depth ?? 0;
  const lines: string[] = [];
  let lastType: string | null = null;
  let numberedIndex = 0;

  for (const block of blocks) {
    const isListItem = block.type === "bulleted_list_item" || block.type === "numbered_list_item";
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

function renderBlock(block: Block, _depth: number, numberedIndex: number): string | null {
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
    case "bulleted_list_item":
      return `- ${richTextToMarkdown(block.bulleted_list_item?.rich_text ?? [])}`;
    case "numbered_list_item":
      return `${numberedIndex + 1}. ${richTextToMarkdown(block.numbered_list_item?.rich_text ?? [])}`;
    case "to_do": {
      const checked = block.to_do.checked ? "x" : " ";
      return `- [${checked}] ${richTextToMarkdown(block.to_do.rich_text)}`;
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
    default:
      // Complex blocks handled in Task 18
      return null;
  }
}
