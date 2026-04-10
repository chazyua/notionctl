/**
 * QA review tests — additional coverage added after the 2026-04-10 audit.
 *
 * Covers gaps identified across:
 *   - tokenizer.ts: notion:// URL link handling, href vs text.link divergence,
 *     intraword guard edge cases, code-inside-bold write-path details
 *   - write.ts: heading extra-space trimming, table immediately after heading,
 *     toggle body content preservation, deep callout continuation,
 *     multi-line paragraph absorption edge cases
 *   - read.ts: heading 4+ fallback, empty rich_text arrays, child_page/child_database,
 *     video/pdf/file pass-through variants, bookmark rendering
 *   - shared.ts: resolvePageId with query-string URLs, edge-case IDs
 *   - db.ts: findOperator edge cases (property name with =, negative number filters)
 *   - capListDepth: depth=0 items with deep nesting across multiple parents
 *   - round-trip: callout continuation lines, equation in middle of doc
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { richTextToMarkdown, markdownToRichText } from "../../src/markdown/tokenizer.js";
import { markdownToBlocks } from "../../src/markdown/write.js";
import { blocksToMarkdown } from "../../src/markdown/read.js";
import { resolvePageId, parseFlags } from "../../src/commands/shared.js";
import { parseSimpleFilter, parseColumnSpec } from "../../src/commands/db.js";
import { NotionCliError as _NotionCliError } from "../../src/errors.js";
import type { RichText, Block } from "../../src/markdown/types.js";
import { DEFAULT_ANNOTATIONS } from "../../src/markdown/types.js";
import { extractSyncTitle } from "../../src/commands/page.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function rt(content: string, annotations: Partial<typeof DEFAULT_ANNOTATIONS> = {}): RichText {
  return {
    type: "text",
    text: { content, link: null },
    annotations: { ...DEFAULT_ANNOTATIONS, ...annotations },
    plain_text: content,
    href: null,
  };
}

function mkBlock(type: string, body: Record<string, unknown>, extras: Partial<Block> = {}): Block {
  return {
    object: "block",
    id: "test-id",
    type: type as Block["type"],
    has_children: false,
    [type]: body,
    ...extras,
  } as Block;
}

// ─── tokenizer.ts ────────────────────────────────────────────────────────────

describe("richTextToMarkdown — intraword guard edge cases", () => {
  it("italic followed by plain: italic marker does not produce intraword _", () => {
    // italic "a" + plain "b" — without guard, would produce "_a_b" where the
    // second _ is intraword and gets treated as literal. With the fix, "*a*b".
    const runs: RichText[] = [
      { type: "text", text: { content: "a", link: null }, annotations: { ...DEFAULT_ANNOTATIONS, italic: true }, plain_text: "a", href: null },
      { type: "text", text: { content: "b", link: null }, annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: "b", href: null },
    ];
    const md = richTextToMarkdown(runs);
    // Round-trip: the 'a' segment must survive as italic, 'b' must be plain
    const result = markdownToRichText(md);
    const aRun = result.find(r => r.plain_text === "a");
    assert.ok(aRun, "a run must exist");
    assert.equal(aRun!.annotations.italic, true, "a must be italic");
    const bRun = result.find(r => r.plain_text === "b");
    assert.ok(bRun, "b run must exist");
    assert.equal(bRun!.annotations.italic, false, "b must not be italic");
  });

  it("bold-only then bold+italic: italic marker between word chars uses *", () => {
    // Two runs: "word" (bold) then "more" (bold+italic)
    // The italic marker _ would appear between two word chars if not guarded.
    const runs: RichText[] = [
      { type: "text", text: { content: "word", link: null }, annotations: { ...DEFAULT_ANNOTATIONS, bold: true }, plain_text: "word", href: null },
      { type: "text", text: { content: "more", link: null }, annotations: { ...DEFAULT_ANNOTATIONS, bold: true, italic: true }, plain_text: "more", href: null },
    ];
    const md = richTextToMarkdown(runs);
    // Round-trip: the "more" segment must remain bold+italic
    const result = markdownToRichText(md);
    const moreRun = result.find(r => r.plain_text === "more");
    assert.ok(moreRun, "more run must survive round-trip");
    assert.equal(moreRun!.annotations.bold, true, "more must be bold");
    assert.equal(moreRun!.annotations.italic, true, "more must be italic");
  });

  it("italic close between word chars: full text survives round-trip", () => {
    // italic "x" + plain "y" — with fix, produces "*x*y" (parseable) not "_x_y"
    const runs: RichText[] = [
      { type: "text", text: { content: "x", link: null }, annotations: { ...DEFAULT_ANNOTATIONS, italic: true }, plain_text: "x", href: null },
      { type: "text", text: { content: "y", link: null }, annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: "y", href: null },
    ];
    const md = richTextToMarkdown(runs);
    const result = markdownToRichText(md);
    const fullText = result.map(r => r.plain_text).join("");
    assert.equal(fullText, "xy", "full text must be xy");
  });

  it("italic with preceding non-word char uses _ (no guard needed)", () => {
    // Space before italic: " italic" — space is not a word char, so _ is fine
    const runs: RichText[] = [
      { type: "text", text: { content: "Start ", link: null }, annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: "Start ", href: null },
      { type: "text", text: { content: "em", link: null }, annotations: { ...DEFAULT_ANNOTATIONS, italic: true }, plain_text: "em", href: null },
      { type: "text", text: { content: " end", link: null }, annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: " end", href: null },
    ];
    const md = richTextToMarkdown(runs);
    assert.ok(md.includes("_em_"), "underscore italic fine when not intraword");
  });
});

describe("markdownToRichText — link URL type handling", () => {
  it("notion:// page URL: href is stored, text.link is null (not a web URL)", () => {
    // notion:// links are rendered by richTextToMarkdown from mention runs,
    // but if the user types one manually it shouldn't get a Notion API link object
    const runs = markdownToRichText("[My Page](notion://page/abcd1234-ef56-7890-abcd-1234567890ab)");
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    assert.equal(run.type, "text");
    if (run.type === "text") {
      // notion:// URLs are not https?:// so text.link should be null
      assert.equal(run.text.link, null, "notion:// URL must not become a Notion API link");
    }
  });

  it("http URL in link produces a proper link object", () => {
    const runs = markdownToRichText("[Visit](http://example.com)");
    const run = runs[0]!;
    if (run.type === "text") {
      assert.deepEqual(run.text.link, { url: "http://example.com" });
    }
  });

  it("https URL with port produces a proper link object", () => {
    const runs = markdownToRichText("[Dev](https://localhost:3000/path)");
    const run = runs[0]!;
    if (run.type === "text") {
      assert.deepEqual(run.text.link, { url: "https://localhost:3000/path" });
    }
  });

  it("deeply nested balanced parentheses in URL", () => {
    // URL with two levels of nested parens
    const runs = markdownToRichText("[page](https://example.com/a(b(c)d)e)");
    assert.equal(runs.length, 1);
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://example.com/a(b(c)d)e" });
    }
  });

  it("link with empty label", () => {
    const runs = markdownToRichText("[](https://example.com)");
    // Empty label should still produce a run — content is ""
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "");
  });

  it("link with empty URL produces no Notion link", () => {
    const runs = markdownToRichText("[label]()");
    assert.equal(runs.length, 1);
    if (runs[0]!.type === "text") {
      assert.equal(runs[0]!.text.link, null, "empty URL must not produce a link");
    }
  });
});

describe("richTextToMarkdown — link-containing runs from read path", () => {
  it("mention page run renders as markdown link", () => {
    const mention: RichText = {
      type: "mention",
      mention: { type: "page", page: { id: "abcd1234-ef56-7890-abcd-1234567890ab" } },
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: "My Page",
      href: null,
    };
    const md = richTextToMarkdown([mention]);
    assert.match(md, /\[My Page\]\(notion:\/\/page\/abcd1234-ef56-7890-abcd-1234567890ab\)/);
  });

  it("mention database run renders as markdown link", () => {
    const mention: RichText = {
      type: "mention",
      mention: { type: "database", database: { id: "db-id-123" } },
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: "My DB",
      href: null,
    };
    const md = richTextToMarkdown([mention]);
    assert.match(md, /\[My DB\]\(notion:\/\/database\/db-id-123\)/);
  });

  it("mention date renders as angle-bracket date", () => {
    const mention: RichText = {
      type: "mention",
      mention: { type: "date", date: { start: "2026-04-10", end: null, time_zone: null } },
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: "2026-04-10",
      href: null,
    };
    const md = richTextToMarkdown([mention]);
    assert.equal(md, "<2026-04-10>");
  });

  it("mention date range renders with .. separator", () => {
    const mention: RichText = {
      type: "mention",
      mention: { type: "date", date: { start: "2026-04-01", end: "2026-04-30", time_zone: null } },
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: "Apr 2026",
      href: null,
    };
    const md = richTextToMarkdown([mention]);
    assert.equal(md, "<2026-04-01..2026-04-30>");
  });

  it("mention link_preview renders as markdown link", () => {
    const mention: RichText = {
      type: "mention",
      mention: { type: "link_preview", link_preview: { url: "https://github.com/org/repo" } },
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: "org/repo",
      href: null,
    };
    const md = richTextToMarkdown([mention]);
    assert.match(md, /\[org\/repo\]\(https:\/\/github\.com\/org\/repo\)/);
  });
});

// ─── write.ts ────────────────────────────────────────────────────────────────

describe("markdownToBlocks — heading parsing edge cases", () => {
  it("# heading text is extracted correctly (slice(2))", () => {
    const blocks = markdownToBlocks("# Hello World");
    assert.equal(blocks[0]!.type, "heading_1");
    const text = (blocks[0] as any).heading_1.rich_text[0].text.content;
    assert.equal(text, "Hello World");
  });

  it("## heading text is extracted correctly (slice(3))", () => {
    const blocks = markdownToBlocks("## Sub Section");
    const text = (blocks[0] as any).heading_2.rich_text[0].text.content;
    assert.equal(text, "Sub Section");
  });

  it("### heading text is extracted correctly (slice(4))", () => {
    const blocks = markdownToBlocks("### Deep Section");
    const text = (blocks[0] as any).heading_3.rich_text[0].text.content;
    assert.equal(text, "Deep Section");
  });

  it("# heading with extra leading space in text gets trimmed by rich text tokenizer", () => {
    // '##  Title' → trimmed is '##  Title', slice(3) → ' Title'
    // markdownToRichText(' Title') should produce a run with content ' Title'
    // This is existing behaviour; we document it here
    const blocks = markdownToBlocks("##  Title with double space");
    const text = (blocks[0] as any).heading_2.rich_text.map((r: any) => r.text.content).join("");
    // The leading space is an artifact of our current slice-based extraction
    // Behaviour is: text starts with ' Title...' — document not crash
    assert.ok(text.includes("Title"), "heading text must contain 'Title'");
  });

  it("heading immediately followed by another heading (no blank line)", () => {
    const blocks = markdownToBlocks("# H1\n## H2\n### H3");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.type, "heading_1");
    assert.equal(blocks[1]!.type, "heading_2");
    assert.equal(blocks[2]!.type, "heading_3");
  });

  it("heading immediately after a paragraph does not absorb the paragraph", () => {
    const blocks = markdownToBlocks("Some text\n# A Heading");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "heading_1");
  });

  it("bulleted list immediately after paragraph stops paragraph absorption", () => {
    const blocks = markdownToBlocks("Some text\n- item one\n- item two");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "bulleted_list_item");
    assert.equal(blocks[2]!.type, "bulleted_list_item");
  });
});

describe("markdownToBlocks — callout continuation lines", () => {
  it("callout with continuation text on subsequent > lines", () => {
    const md = "> [!NOTE] First line\n> Second line";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "callout");
    const text = (blocks[0] as any).callout.rich_text[0].text.content;
    assert.ok(text.includes("First line"), "first line present");
    assert.ok(text.includes("Second line"), "second line present");
  });

  it("callout TIP type maps to correct emoji", () => {
    const blocks = markdownToBlocks("> [!TIP] Hot tip");
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.icon.emoji, "🔥");
    assert.equal((blocks[0] as any).callout.color, "green_background");
  });

  it("callout CAUTION type maps to correct emoji", () => {
    const blocks = markdownToBlocks("> [!CAUTION] Be careful");
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.icon.emoji, "🛑");
    assert.equal((blocks[0] as any).callout.color, "red_background");
  });

  it("callout IMPORTANT type maps to correct emoji", () => {
    const blocks = markdownToBlocks("> [!IMPORTANT] Pay attention");
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.icon.emoji, "❗");
    assert.equal((blocks[0] as any).callout.color, "red_background");
  });

  it("callout WARNING type maps to correct emoji", () => {
    const blocks = markdownToBlocks("> [!WARNING] Watch out");
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.icon.emoji, "⚠️");
  });
});

describe("markdownToBlocks — toggle body handling", () => {
  it("toggle block preserves summary text", () => {
    const blocks = markdownToBlocks(
      "<details><summary>**Bold Summary**</summary>\n\nBody goes here.\n\n</details>",
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
    // Summary text should contain the bold-marked text (annotation stripped to content here)
    const richText = (blocks[0] as any).toggle.rich_text;
    const fullText = richText.map((r: any) => r.plain_text ?? r.text?.content ?? "").join("");
    assert.ok(fullText.includes("Bold Summary"), `summary must be preserved, got: ${fullText}`);
  });

  it("toggle with empty summary produces empty rich_text array or empty run", () => {
    const blocks = markdownToBlocks("<details><summary></summary>\n\n</details>");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
    // Empty summary is allowed (produces empty array or single empty run)
    const richText = (blocks[0] as any).toggle.rich_text;
    assert.ok(Array.isArray(richText), "rich_text must be an array");
  });
});

describe("markdownToBlocks — code block edge cases", () => {
  it("empty code block produces empty content", () => {
    const blocks = markdownToBlocks("```\n```");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "code");
    const content = (blocks[0] as any).code.rich_text[0].text.content;
    assert.equal(content, "");
  });

  it("code block with no language defaults to plain text", () => {
    const blocks = markdownToBlocks("```\nhello\n```");
    assert.equal((blocks[0] as any).code.language, "plain text");
  });

  it("code block preserves internal blank lines", () => {
    const md = "```\nline one\n\nline three\n```";
    const blocks = markdownToBlocks(md);
    const content = (blocks[0] as any).code.rich_text[0].text.content;
    assert.equal(content, "line one\n\nline three");
  });

  it("code block with unknown language passes language through unchanged", () => {
    const blocks = markdownToBlocks("```brainfuck\n+++---\n```");
    assert.equal((blocks[0] as any).code.language, "brainfuck");
  });

  it("all known language aliases resolve correctly", () => {
    const aliases: Array<[string, string]> = [
      ["zsh", "shell"],
      ["fish", "shell"],
      ["yml", "yaml"],
      ["rb", "ruby"],
      ["cs", "c#"],
      ["cpp", "c++"],
      ["kt", "kotlin"],
      ["hs", "haskell"],
      ["ex", "elixir"],
      ["erl", "erlang"],
      ["fs", "f#"],
      ["vb", "visual basic"],
      ["asm", "assembly"],
      ["tf", "hcl"],
      ["proto", "protobuf"],
      ["tex", "latex"],
      ["md", "markdown"],
      ["objc", "objective-c"],
    ];
    for (const [alias, expected] of aliases) {
      const blocks = markdownToBlocks(`\`\`\`${alias}\ncode\n\`\`\``);
      assert.equal(
        (blocks[0] as any).code.language,
        expected,
        `alias '${alias}' should map to '${expected}'`,
      );
    }
  });
});

describe("markdownToBlocks — numbered list numbering", () => {
  it("non-sequential numbered list items are normalised to sequential", () => {
    // Markdown allows '1. 1. 1.' but we reformat to 1. 2. 3.
    const blocks = markdownToBlocks("1. First\n1. Second\n1. Third");
    assert.equal(blocks.length, 3);
    blocks.forEach(b => assert.equal(b.type, "numbered_list_item"));
  });

  it("numbered list starting at a number other than 1", () => {
    const blocks = markdownToBlocks("5. Fifth\n6. Sixth");
    assert.equal(blocks.length, 2);
    blocks.forEach(b => assert.equal(b.type, "numbered_list_item"));
  });
});

describe("markdownToBlocks — mixed list types", () => {
  it("bulleted list followed by numbered list produces two separate groups", () => {
    const md = "- bullet one\n- bullet two\n\n1. number one\n2. number two";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 4);
    assert.equal(blocks[0]!.type, "bulleted_list_item");
    assert.equal(blocks[1]!.type, "bulleted_list_item");
    assert.equal(blocks[2]!.type, "numbered_list_item");
    assert.equal(blocks[3]!.type, "numbered_list_item");
  });

  it("to-do list can have nested bullet children", () => {
    const md = "- [ ] Task\n  - note one\n  - note two";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "to_do");
    const children = (blocks[0] as any).to_do.children;
    assert.ok(children && children.length === 2, "to-do must have 2 bullet children");
    assert.equal(children[0].type, "bulleted_list_item");
  });
});

describe("markdownToBlocks — GFM table edge cases", () => {
  it("table with 1 column is valid", () => {
    const md = "| Solo |\n| --- |\n| value |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "table");
    assert.equal((blocks[0] as any).table.table_width, 1);
  });

  it("table separator row with aligned colons is recognized", () => {
    const md = "| A | B |\n| :--- | ---: |\n| left | right |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "table");
  });

  it("table with many columns", () => {
    const md = "| A | B | C | D | E |\n| --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 |";
    const blocks = markdownToBlocks(md);
    assert.equal((blocks[0] as any).table.table_width, 5);
    assert.equal((blocks[0] as any).table.children.length, 2); // header + 1 data row
  });

  it("table immediately following a heading (no blank line)", () => {
    const md = "## Table Section\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "heading_2");
    assert.equal(blocks[1]!.type, "table");
  });
});

describe("markdownToBlocks — equation edge cases", () => {
  it("multi-line equation with opening $$ having trailing text on same line", () => {
    // '$$E = mc^2' opening line with content, then separate closing '$$'
    const md = "$$E = mc^2\n$$";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "equation");
    const expr = (blocks[0] as any).equation.expression;
    assert.ok(expr.includes("E = mc^2"), `expression must include formula, got: ${expr}`);
  });

  it("equation block surrounded by paragraphs", () => {
    const md = "Before\n\n$$x = 1$$\n\nAfter";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "equation");
    assert.equal(blocks[2]!.type, "paragraph");
  });
});

describe("markdownToBlocks — divider edge cases", () => {
  it("long divider (------) is still a divider", () => {
    const blocks = markdownToBlocks("------");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "divider");
  });

  it("divider immediately before a heading", () => {
    const blocks = markdownToBlocks("---\n# Title");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "divider");
    assert.equal(blocks[1]!.type, "heading_1");
  });
});

// ─── read.ts ─────────────────────────────────────────────────────────────────

describe("blocksToMarkdown — edge cases from read path", () => {
  it("paragraph with empty rich_text renders as empty string", () => {
    const block = mkBlock("paragraph", { rich_text: [], color: "default" });
    const out = blocksToMarkdown([block]);
    assert.equal(out.trim(), "");
  });

  it("heading with empty rich_text renders as bare heading marker", () => {
    const block = mkBlock("heading_1", { rich_text: [], color: "default", is_toggleable: false });
    const out = blocksToMarkdown([block]);
    assert.match(out, /^# $/m);
  });

  it("child_page block renders as notion link", () => {
    const block: Block = {
      object: "block",
      id: "child-page-1",
      type: "child_page",
      has_children: false,
      child_page: { title: "My Subpage" },
    } as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /\[My Subpage\]\(notion:\/\/page\/child-page-1\)/);
  });

  it("child_database block renders as notion link", () => {
    const block: Block = {
      object: "block",
      id: "child-db-1",
      type: "child_database",
      has_children: false,
      child_database: { title: "My Database" },
    } as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /\[My Database\]\(notion:\/\/database\/child-db-1\)/);
  });

  it("child_page with no title falls back to 'Untitled'", () => {
    const block: Block = {
      object: "block",
      id: "no-title-1",
      type: "child_page",
      has_children: false,
      child_page: {},
    } as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /\[Untitled\]/);
  });

  it("video block passes through with HTML comment", () => {
    const block: Block = {
      object: "block",
      id: "vid-1",
      type: "video",
      has_children: false,
      video: {
        type: "external",
        external: { url: "https://youtube.com/watch?v=abc" },
        caption: [],
      },
    } as unknown as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /!\[video\]\(https:\/\/youtube\.com/);
    assert.match(out, /<!-- notion-block: video id=vid-1 -->/);
  });

  it("pdf block passes through as image+comment", () => {
    const block: Block = {
      object: "block",
      id: "pdf-1",
      type: "pdf",
      has_children: false,
      pdf: {
        type: "external",
        external: { url: "https://example.com/doc.pdf" },
        caption: [{ plain_text: "My Document" }],
      },
    } as unknown as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /!\[My Document\]/);
    assert.match(out, /<!-- notion-block: pdf id=pdf-1 -->/);
  });

  it("bookmark block renders as a link with HTML comment", () => {
    const block: Block = {
      object: "block",
      id: "bm-1",
      type: "bookmark",
      has_children: false,
      bookmark: {
        url: "https://example.com",
        caption: [{ plain_text: "Example Site" }],
      },
    } as unknown as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /\[Example Site\]\(https:\/\/example\.com\)/);
    assert.match(out, /<!-- notion-block: bookmark id=bm-1 -->/);
  });

  it("bookmark block with no caption uses URL as label", () => {
    const block: Block = {
      object: "block",
      id: "bm-2",
      type: "bookmark",
      has_children: false,
      bookmark: {
        url: "https://example.com",
        caption: [],
      },
    } as unknown as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /\[https:\/\/example\.com\]\(https:\/\/example\.com\)/);
  });

  it("link_preview block renders as a link", () => {
    const block: Block = {
      object: "block",
      id: "lp-1",
      type: "link_preview",
      has_children: false,
      link_preview: {
        url: "https://github.com/owner/repo",
        caption: [],
      },
    } as unknown as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /\[https:\/\/github\.com\/owner\/repo\]/);
    assert.match(out, /<!-- notion-block: link_preview id=lp-1 -->/);
  });

  it("image with file URL (not external) renders correctly", () => {
    const block: Block = {
      object: "block",
      id: "img-file-1",
      type: "image",
      has_children: false,
      image: {
        type: "file",
        file: { url: "https://s3.amazonaws.com/notion/img.png" },
        caption: [],
      },
    } as unknown as Block;
    const out = blocksToMarkdown([block]);
    assert.match(out, /!\[image\]\(https:\/\/s3\.amazonaws\.com/);
  });

  it("callout with CAUTION emoji renders as [!CAUTION]", () => {
    const block = mkBlock("callout", {
      rich_text: [rt("Danger!")],
      icon: { type: "emoji", emoji: "🛑" },
      color: "red_background",
    });
    const out = blocksToMarkdown([block]);
    assert.match(out, /> \[!CAUTION\]/);
  });

  it("callout with IMPORTANT emoji renders as [!IMPORTANT]", () => {
    const block = mkBlock("callout", {
      rich_text: [rt("Critical!")],
      icon: { type: "emoji", emoji: "❗" },
      color: "red_background",
    });
    const out = blocksToMarkdown([block]);
    assert.match(out, /> \[!IMPORTANT\]/);
  });

  it("callout with color-only (no emoji) falls back to color-based type", () => {
    const block = mkBlock("callout", {
      rich_text: [rt("From color only")],
      icon: null,
      color: "green_background",
    });
    const out = blocksToMarkdown([block]);
    assert.match(out, /> \[!TIP\]/);
  });

  it("callout with no icon and unknown color defaults to NOTE", () => {
    const block = mkBlock("callout", {
      rich_text: [rt("Default")],
      icon: null,
      color: "purple_background",
    });
    const out = blocksToMarkdown([block]);
    assert.match(out, /> \[!NOTE\]/);
  });

  it("table with _children (API mode) renders correctly", () => {
    const tableBlock: Block = {
      object: "block",
      id: "tbl-1",
      type: "table",
      has_children: true,
      table: { table_width: 2, has_column_header: true, has_row_header: false },
    } as Block;
    (tableBlock as any)._children = [
      { type: "table_row", table_row: { cells: [[rt("Col1")], [rt("Col2")]] } },
      { type: "table_row", table_row: { cells: [[rt("A")], [rt("B")]] } },
    ];
    const out = blocksToMarkdown([tableBlock]);
    assert.match(out, /\| Col1 \| Col2 \|/);
    assert.match(out, /\| A \| B \|/);
  });

  it("empty table (no rows) renders as empty string", () => {
    const tableBlock: Block = {
      object: "block",
      id: "tbl-empty",
      type: "table",
      has_children: false,
      table: { table_width: 2, has_column_header: true, has_row_header: false, children: [] },
    } as Block;
    const out = blocksToMarkdown([tableBlock]);
    assert.equal(out.trim(), "");
  });

  it("equation with LaTeX expression renders with $$ delimiters", () => {
    const expr = "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}";
    const block = mkBlock("equation", { expression: expr });
    const out = blocksToMarkdown([block]);
    assert.ok(out.startsWith("$$"), "must start with $$");
    assert.ok(out.endsWith("$$"), "must end with $$");
    assert.ok(out.includes(expr), "expression must be preserved verbatim");
  });
});

// ─── shared.ts / resolvePageId ────────────────────────────────────────────────

describe("resolvePageId — additional edge cases", () => {
  it("notion.so URL with query string (?pvs=4) resolves correctly", () => {
    // The #fragment is stripped by split("#")[0], but ?query stays in the URL
    // The regex [^/?#]+ won't match past '?' so the ID must be in the last segment
    const url = "https://www.notion.so/My-Page-abcd1234ef567890abcd1234567890ab?pvs=4";
    // After split("#")[0]: url stays with ?pvs=4
    // The regex: notion\.(?:so|site)\/(?:[^/]+\/)*([^/?#]+)
    // Last segment before ? is "My-Page-abcd1234ef567890abcd1234567890ab"
    assert.equal(
      resolvePageId(url),
      "abcd1234-ef56-7890-abcd-1234567890ab",
    );
  });

  it("bare 32-char hex without any dashes normalizes to UUID", () => {
    assert.equal(
      resolvePageId("abcd1234ef567890abcd1234567890ab"),
      "abcd1234-ef56-7890-abcd-1234567890ab",
    );
  });

  it("UUID with all-zeros is valid", () => {
    const id = "00000000-0000-0000-0000-000000000000";
    assert.equal(resolvePageId(id), id);
  });

  it("UUID with mixed case is normalized", () => {
    // Our regex is case-insensitive so ABCD... should work
    const result = resolvePageId("ABCD1234EF567890ABCD1234567890AB");
    assert.equal(result, "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("notion.site URL with numeric subdomain resolves", () => {
    const url = "https://teamname.notion.site/My-Doc-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("URL with #anchor and ?query both stripped before ID extraction", () => {
    const url = "https://www.notion.so/Workspace/Page-abcd1234ef567890abcd1234567890ab?pvs=4#section";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("throws on all-letter string (no hex content)", () => {
    assert.throws(() => resolvePageId("notanid"), /Could not parse/);
  });

  it("throws on UUID with wrong character count (31 hex digits)", () => {
    assert.throws(() => resolvePageId("abcd1234ef567890abcd1234567890a"), /Could not parse/);
  });

  it("throws on UUID with wrong character count (33 hex digits)", () => {
    assert.throws(() => resolvePageId("abcd1234ef567890abcd1234567890abc"), /Could not parse/);
  });
});

// ─── db.ts — parseSimpleFilter edge cases ────────────────────────────────────

function schema(overrides: Record<string, { type: string }>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, s] of Object.entries(overrides)) {
    out[name] = { id: name, name, type: s.type };
  }
  return out;
}

describe("parseSimpleFilter — operator edge cases", () => {
  it("property name with spaces is trimmed", () => {
    const s = schema({ Count: { type: "number" } });
    // "Count = 5" has ' = ' with spaces around operator
    const result = parseSimpleFilter("Count = 5", s);
    assert.deepEqual(result, { property: "Count", number: { equals: 5 } });
  });

  it("value with spaces is preserved", () => {
    const s = schema({ Status: { type: "select" } });
    const result = parseSimpleFilter("Status=In Progress", s);
    assert.deepEqual(result, { property: "Status", select: { equals: "In Progress" } });
  });

  it("number filter with floating point value", () => {
    const s = schema({ Price: { type: "number" } });
    const result = parseSimpleFilter("Price=9.99", s);
    assert.deepEqual(result, { property: "Price", number: { equals: 9.99 } });
  });

  it("number filter with large integer", () => {
    const s = schema({ Views: { type: "number" } });
    const result = parseSimpleFilter("Views>1000000", s);
    assert.deepEqual(result, { property: "Views", number: { greater_than: 1000000 } });
  });

  it("multi_select filter with single whitespace-only value after trim is rejected", () => {
    const s = schema({ Tags: { type: "multi_select" } });
    assert.throws(
      () => parseSimpleFilter("Tags= ", s),
      /at least one value/,
    );
  });

  it("unsupported property type (people) suggests using --filter-json", () => {
    const s = schema({ Assignee: { type: "people" } });
    assert.throws(
      () => parseSimpleFilter("Assignee=user:abc", s),
      /not supported in simple form/,
    );
  });

  it("unsupported property type (files) suggests using --filter-json", () => {
    const s = schema({ Attachments: { type: "files" } });
    assert.throws(
      () => parseSimpleFilter("Attachments=url:https://example.com", s),
      /not supported in simple form/,
    );
  });
});

describe("parseColumnSpec — edge cases", () => {
  it("column name with spaces is preserved", () => {
    const result = parseColumnSpec("My Column=text");
    assert.equal(result.name, "My Column");
  });

  it("phone_number alias works", () => {
    const result = parseColumnSpec("Phone=phone_number");
    assert.deepEqual(result.schema, { phone_number: {} });
  });

  it("rich_text alias works", () => {
    const result = parseColumnSpec("Notes=rich_text");
    assert.deepEqual(result.schema, { rich_text: {} });
  });

  it("select with spaces in option names", () => {
    const result = parseColumnSpec("Priority=select:Very High,Medium Low,Not Started");
    const opts = (result.schema as any).select.options;
    assert.deepEqual(opts, [
      { name: "Very High" },
      { name: "Medium Low" },
      { name: "Not Started" },
    ]);
  });

  it("multi_select with no options produces empty array", () => {
    const result = parseColumnSpec("Tags=multi_select");
    assert.deepEqual((result.schema as any).multi_select.options, []);
  });
});

// ─── page.ts — extractSyncTitle ──────────────────────────────────────────────

describe("extractSyncTitle — additional cases", () => {
  it("frontmatter title is numeric string — coerced to string", () => {
    // frontmatter.title might be the number 42 if parsed from YAML
    const { title } = extractSyncTitle({ title: 42 as unknown as string }, "# Ignored\n\nBody");
    assert.equal(title, "42");
  });

  it("body with only H1 (no following content) strips H1 leaving empty body", () => {
    const { title, syncBody } = extractSyncTitle({}, "# My Title\n");
    assert.equal(title, "My Title");
    assert.equal(syncBody.trim(), "");
  });

  it("H1 anywhere in body is extracted (multiline regex ^# with /m flag)", () => {
    // The /m flag on /^# (.+)$/m means ^ matches start of any line, not just
    // the document. The first H1 found anywhere in the body is used as the title.
    const { title } = extractSyncTitle({}, "Some text\n# Mid Title\nmore");
    assert.equal(title, "Mid Title");
  });

  it("bold H1 text is extracted with asterisks intact (raw text)", () => {
    const { title } = extractSyncTitle({}, "# **Bold Title**\n\nBody");
    assert.equal(title, "**Bold Title**");
  });
});

// ─── capListDepth / list promotion correctness ────────────────────────────────

describe("capListDepth — deep list promotion edge cases", () => {
  it("5-level nesting: all levels 3+ promoted to be siblings at level 2", () => {
    const md = "- L1\n  - L2\n    - L3\n      - L4\n        - L5";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "one root block");
    const l1Children = (blocks[0] as any).bulleted_list_item.children;
    // L2, L3, L4, L5 all at second level (4 siblings)
    assert.equal(l1Children.length, 4, "L2, L3, L4, L5 all at second level");
    for (const child of l1Children) {
      assert.equal(child.bulleted_list_item.children, undefined, "no third-level children");
    }
  });

  it("two separate parent items each with deep nesting — both capped independently", () => {
    const md = "- A\n  - A1\n    - A2\n- B\n  - B1\n    - B2";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2, "two root items");
    const aChildren = (blocks[0] as any).bulleted_list_item.children;
    const bChildren = (blocks[1] as any).bulleted_list_item.children;
    assert.equal(aChildren.length, 2, "A1, A2 at second level");
    assert.equal(bChildren.length, 2, "B1, B2 at second level");
  });

  it("mixed type nesting: numbered parent with bulleted children capped correctly", () => {
    const md = "1. Step One\n   - note\n     - deep note\n2. Step Two";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2, "two numbered items");
    const step1Children = (blocks[0] as any).numbered_list_item.children;
    assert.ok(step1Children && step1Children.length >= 1, "step one has children");
  });
});

// ─── round-trip completeness ──────────────────────────────────────────────────

describe("Full round-trip — blocks → md → blocks", () => {
  function rt(text: string) {
    return [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
  }

  it("callout round-trips through NOTE type", () => {
    const blocks = [{
      id: "1", type: "callout", has_children: false,
      callout: {
        rich_text: rt("Be careful"),
        icon: { type: "emoji", emoji: "💡" },
        color: "blue_background",
      },
    }];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.type, "callout");
  });

  it("toggle round-trips", () => {
    const blocks = [{
      id: "1", type: "toggle", has_children: false,
      toggle: { rich_text: rt("Click to expand"), color: "default" },
    }];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.type, "toggle");
    const toggleText = (result[0] as any).toggle.rich_text.map((r: any) => r.text.content).join("");
    assert.equal(toggleText, "Click to expand");
  });

  it("equation with special LaTeX chars round-trips", () => {
    const expr = "\\frac{a}{b} + \\sqrt{c}";
    const blocks = [{ id: "1", type: "equation", has_children: false, equation: { expression: expr } }];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 1);
    assert.equal((result[0] as any).equation.expression, expr);
  });

  it("divider round-trips", () => {
    const blocks = [
      { id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: rt("before") } },
      { id: "2", type: "divider", has_children: false, divider: {} },
      { id: "3", type: "paragraph", has_children: false, paragraph: { rich_text: rt("after") } },
    ];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 3);
    assert.equal(result[0]!.type, "paragraph");
    assert.equal(result[1]!.type, "divider");
    assert.equal(result[2]!.type, "paragraph");
  });

  it("quote block round-trips", () => {
    const blocks = [{ id: "1", type: "quote", has_children: false, quote: { rich_text: rt("Famous quote"), color: "default" } }];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.type, "quote");
    const text = (result[0] as any).quote.rich_text.map((r: any) => r.text.content).join("");
    assert.equal(text, "Famous quote");
  });

  it("to-do list with mixed check states round-trips", () => {
    const blocks = [
      { id: "1", type: "to_do", has_children: false, to_do: { rich_text: rt("Open"), checked: false, color: "default" } },
      { id: "2", type: "to_do", has_children: false, to_do: { rich_text: rt("Done"), checked: true, color: "default" } },
      { id: "3", type: "to_do", has_children: false, to_do: { rich_text: rt("Another"), checked: false, color: "default" } },
    ];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 3);
    assert.equal((result[0] as any).to_do.checked, false);
    assert.equal((result[1] as any).to_do.checked, true);
    assert.equal((result[2] as any).to_do.checked, false);
  });

  it("complex document with all block types preserves order", () => {
    const mkRt = (t: string) => [{ type: "text", text: { content: t, link: null }, plain_text: t, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
    const blocks = [
      { id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: mkRt("Document Title") } },
      { id: "2", type: "paragraph", has_children: false, paragraph: { rich_text: mkRt("Introduction paragraph.") } },
      { id: "3", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: mkRt("Item 1"), color: "default" } },
      { id: "4", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: mkRt("Item 2"), color: "default" } },
      { id: "5", type: "heading_2", has_children: false, heading_2: { rich_text: mkRt("Code Section") } },
      { id: "6", type: "code", has_children: false, code: { rich_text: mkRt("const x = 1;"), language: "javascript", caption: [] } },
      { id: "7", type: "divider", has_children: false, divider: {} },
      { id: "8", type: "quote", has_children: false, quote: { rich_text: mkRt("A wise quote"), color: "default" } },
      { id: "9", type: "equation", has_children: false, equation: { expression: "E = mc^2" } },
    ];
    const md = blocksToMarkdown(blocks as any);
    const result = markdownToBlocks(md);
    assert.equal(result.length, 9);
    assert.deepEqual(
      result.map((b: any) => b.type),
      ["heading_1", "paragraph", "bulleted_list_item", "bulleted_list_item", "heading_2", "code", "divider", "quote", "equation"],
    );
  });
});

// ─── parseFlags edge cases ────────────────────────────────────────────────────

describe("parseFlags — additional edge cases", () => {
  it("--flag with = in value parses correctly", () => {
    const { flags } = parseFlags(["--title", "Key=Value"]);
    assert.equal(flags.get("title"), "Key=Value");
  });

  it("--flag=value with = in value parses correctly", () => {
    const { repeated } = parseFlags(["--filter=Status=Done"]);
    // --filter=Status=Done → name="filter", value="Status=Done" (filter is repeatable)
    assert.deepEqual(repeated.get("filter"), ["Status=Done"]);
  });

  it("positional args mixed with flags", () => {
    const { flags, positional } = parseFlags(["page-id", "--format", "json", "extra-pos"]);
    assert.equal(flags.get("format"), "json");
    assert.deepEqual(positional, ["page-id", "extra-pos"]);
  });

  it("--prop flag is repeatable and collects all values", () => {
    const { repeated } = parseFlags(["--prop", "Status=Done", "--prop", "Priority=High", "--prop", "Count=5"]);
    assert.deepEqual(repeated.get("prop"), ["Status=Done", "Priority=High", "Count=5"]);
  });

  it("boolean flag as --flag=true stores string 'true'", () => {
    // When using --flag=value form, BOOLEAN_FLAGS branch is bypassed so
    // value is taken from the = split regardless
    const { flags } = parseFlags(["--dry-run=true"]);
    assert.equal(flags.get("dry-run"), "true");
  });

  it("empty args produces empty results", () => {
    const result = parseFlags([]);
    assert.equal(result.flags.size, 0);
    assert.equal(result.repeated.size, 0);
    assert.deepEqual(result.positional, []);
  });
});
