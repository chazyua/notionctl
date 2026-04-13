/**
 * Round-trip test: blocks → markdown → blocks.
 * Verifies that reading Notion blocks as Markdown and writing them back
 * produces structurally equivalent block trees. This catches silent data
 * loss where read and write tests pass individually but the pipeline drops
 * content.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksToMarkdown, markdownToBlocks } from "../../src/markdown/index.js";

function roundTrip(blocks: unknown[]): unknown[] {
  const md = blocksToMarkdown(blocks as any);
  return markdownToBlocks(md);
}

describe("Markdown round-trip", () => {
  it("paragraph with bold and italic survives round-trip", () => {
    const blocks = [{
      id: "1", type: "paragraph", has_children: false,
      paragraph: { rich_text: [
        { type: "text", text: { content: "Hello " }, plain_text: "Hello ", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } },
        { type: "text", text: { content: "world" }, plain_text: "world", annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false } },
      ] },
    }];
    const result = roundTrip(blocks);
    assert.equal(result.length, 1);
    const rt = (result[0] as any).paragraph.rich_text;
    const fullText = rt.map((r: any) => r.text.content).join("");
    assert.equal(fullText, "Hello world");
    // The bold segment must be preserved
    const boldRun = rt.find((r: any) => r.annotations?.bold);
    assert.ok(boldRun, "bold annotation lost in round-trip");
    assert.equal(boldRun.text.content, "world");
  });

  it("headings survive round-trip", () => {
    const blocks = [
      { id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: [{ type: "text", text: { content: "H1" }, plain_text: "H1", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }] } },
      { id: "2", type: "heading_2", has_children: false, heading_2: { rich_text: [{ type: "text", text: { content: "H2" }, plain_text: "H2", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }] } },
      { id: "3", type: "heading_3", has_children: false, heading_3: { rich_text: [{ type: "text", text: { content: "H3" }, plain_text: "H3", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }] } },
    ];
    const result = roundTrip(blocks);
    assert.equal(result.length, 3);
    assert.equal((result[0] as any).type, "heading_1");
    assert.equal((result[1] as any).type, "heading_2");
    assert.equal((result[2] as any).type, "heading_3");
  });

  it("nested bullet list survives round-trip", () => {
    const blocks = [{
      id: "1", type: "bulleted_list_item", has_children: true,
      bulleted_list_item: {
        rich_text: [{ type: "text", text: { content: "Parent" }, plain_text: "Parent", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }],
      },
      _children: [{
        id: "2", type: "bulleted_list_item", has_children: false,
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: "Child" }, plain_text: "Child", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }],
        },
      }],
    }];
    const result = roundTrip(blocks);
    assert.equal(result.length, 1);
    const parent = result[0] as any;
    assert.equal(parent.type, "bulleted_list_item");
    const children = parent.bulleted_list_item.children;
    assert.ok(children, "nested children lost in round-trip");
    assert.equal(children.length, 1);
    assert.equal(children[0].bulleted_list_item.rich_text[0].text.content, "Child");
  });

  it("code block with language survives round-trip", () => {
    const blocks = [{
      id: "1", type: "code", has_children: false,
      code: {
        language: "typescript",
        rich_text: [{ type: "text", text: { content: "const x = 1;" }, plain_text: "const x = 1;", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }],
      },
    }];
    const result = roundTrip(blocks);
    assert.equal(result.length, 1);
    const code = (result[0] as any).code;
    assert.equal(code.language, "typescript");
    assert.equal(code.rich_text[0].text.content, "const x = 1;");
  });

  it("to-do checked state survives round-trip", () => {
    const blocks = [
      { id: "1", type: "to_do", has_children: false, to_do: { checked: false, rich_text: [{ type: "text", text: { content: "Not done" }, plain_text: "Not done", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }] } },
      { id: "2", type: "to_do", has_children: false, to_do: { checked: true, rich_text: [{ type: "text", text: { content: "Done" }, plain_text: "Done", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }] } },
    ];
    const result = roundTrip(blocks);
    assert.equal((result[0] as any).to_do.checked, false);
    assert.equal((result[1] as any).to_do.checked, true);
  });

  it("mixed block types preserve order and type", () => {
    const rt = (text: string) => [{ type: "text", text: { content: text }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }];
    const blocks = [
      { id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: rt("Title") } },
      { id: "2", type: "paragraph", has_children: false, paragraph: { rich_text: rt("Intro text") } },
      { id: "3", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("Item 1") } },
      { id: "4", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("Item 2") } },
      { id: "5", type: "quote", has_children: false, quote: { rich_text: rt("A quote") } },
    ];
    const result = roundTrip(blocks);
    assert.equal(result.length, 5);
    assert.deepEqual(
      result.map((b: any) => b.type),
      ["heading_1", "paragraph", "bulleted_list_item", "bulleted_list_item", "quote"],
    );
  });

  it("equation block with multi-line expression survives round-trip", () => {
    const blocks = [{
      id: "1", type: "equation", has_children: false,
      equation: { expression: "E = mc^2" },
    }];
    const result = roundTrip(blocks);
    assert.equal(result.length, 1);
    assert.equal((result[0] as any).type, "equation");
    assert.equal((result[0] as any).equation.expression, "E = mc^2");
  });

  it("divider block survives round-trip", () => {
    const blocks = [{
      id: "1", type: "divider", has_children: false,
      divider: {},
    }];
    const result = roundTrip(blocks);
    assert.equal(result.length, 1);
    assert.equal((result[0] as any).type, "divider");
  });

  it("paragraph followed by table produces both blocks on round-trip", () => {
    const rt = (text: string) => [{ type: "text", text: { content: text }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }];
    const blocks = [
      { id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: rt("Before table") } },
      {
        id: "2", type: "table", has_children: true,
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            { type: "table_row", table_row: { cells: [rt("A"), rt("B")] } },
            { type: "table_row", table_row: { cells: [rt("1"), rt("2")] } },
          ],
        },
      },
    ];
    const result = roundTrip(blocks);
    assert.equal(result.length, 2, "paragraph + table must both survive round-trip");
    assert.equal((result[0] as any).type, "paragraph");
    assert.equal((result[1] as any).type, "table");
  });

  it("bold+strikethrough rich text survives round-trip with correct annotations", () => {
    const blocks = [{
      id: "1", type: "paragraph", has_children: false,
      paragraph: { rich_text: [
        { type: "text", text: { content: "both" }, plain_text: "both",
          annotations: { bold: true, italic: false, strikethrough: true, underline: false, code: false } },
        { type: "text", text: { content: " just strike" }, plain_text: " just strike",
          annotations: { bold: false, italic: false, strikethrough: true, underline: false, code: false } },
      ] },
    }];
    const result = roundTrip(blocks);
    const rt = (result[0] as any).paragraph.rich_text;
    const fullText = rt.map((r: any) => r.text.content).join("");
    assert.equal(fullText, "both just strike");
    const bothRun = rt.find((r: any) => r.text.content === "both");
    assert.ok(bothRun, "both run must exist");
    assert.equal(bothRun.annotations.bold, true);
    assert.equal(bothRun.annotations.strikethrough, true);
    const strikeRun = rt.find((r: any) => r.text.content.includes("just strike"));
    assert.ok(strikeRun, "strike run must exist");
    assert.equal(strikeRun.annotations.bold, false, "strike-only run must NOT be bold");
    assert.equal(strikeRun.annotations.strikethrough, true);
  });
});

describe("Markdown string round-trip (md → blocks → md)", () => {
  function mdRoundTrip(md: string): string {
    const blocks = markdownToBlocks(md);
    return blocksToMarkdown(blocks);
  }

  it("plain paragraph survives", () => {
    assert.equal(mdRoundTrip("Hello world").trim(), "Hello world");
  });

  it("bold text survives", () => {
    const result = mdRoundTrip("**bold text**").trim();
    assert.ok(result.includes("**bold text**") || result.includes("**bold text**"));
  });

  it("heading levels survive", () => {
    const result = mdRoundTrip("# H1\n\n## H2\n\n### H3");
    assert.match(result, /^# H1$/m);
    assert.match(result, /^## H2$/m);
    assert.match(result, /^### H3$/m);
  });

  it("bulleted list survives", () => {
    const result = mdRoundTrip("- A\n- B\n- C");
    assert.match(result, /^- A$/m);
    assert.match(result, /^- B$/m);
    assert.match(result, /^- C$/m);
  });

  it("numbered list survives", () => {
    const result = mdRoundTrip("1. First\n2. Second\n3. Third");
    assert.match(result, /1\. First/);
    assert.match(result, /2\. Second/);
    assert.match(result, /3\. Third/);
  });

  it("code block with language survives", () => {
    const md = "```javascript\nconsole.log('hi');\n```";
    const result = mdRoundTrip(md);
    assert.match(result, /```javascript/);
    assert.match(result, /console\.log/);
  });

  it("divider survives", () => {
    const result = mdRoundTrip("---");
    assert.match(result, /^---$/m);
  });

  it("table survives with correct structure", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const result = mdRoundTrip(md);
    assert.match(result, /\| A \| B \|/);
    assert.match(result, /\| --- \| --- \|/);
    assert.match(result, /\| 1 \| 2 \|/);
  });

  it("quote survives", () => {
    const result = mdRoundTrip("> Some quoted text");
    assert.match(result, /^> .*Some quoted text/m);
  });

  it("todo items survive with check state", () => {
    const result = mdRoundTrip("- [ ] Open\n- [x] Done");
    assert.match(result, /\[ \] Open/);
    assert.match(result, /\[x\] Done/);
  });

  it("equation block survives", () => {
    const result = mdRoundTrip("$$E = mc^2$$");
    assert.match(result, /\$\$E = mc\^2\$\$/);
  });

  it("multi-line equation survives", () => {
    const result = mdRoundTrip("$$\nx^2 + y^2\n$$");
    assert.match(result, /\$\$x\^2 \+ y\^2\$\$/);
  });

  it("literal marker characters in plain text survive round-trip without corruption", () => {
    // Blocks → md → blocks: literal asterisks, underscores, tildes, backticks
    const rt = (content: string) => [{ type: "text", text: { content, link: null }, plain_text: content, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false } }];
    const blocks = [
      { id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: rt("Use *asterisks* carefully") } },
      { id: "2", type: "paragraph", has_children: false, paragraph: { rich_text: rt("multi_select and _underscores_") } },
      { id: "3", type: "paragraph", has_children: false, paragraph: { rich_text: rt("~~not strikethrough~~") } },
      { id: "4", type: "paragraph", has_children: false, paragraph: { rich_text: rt("`not code`") } },
    ];
    const result = roundTrip(blocks);
    assert.equal(result.length, 4);
    // All text must remain plain (no annotations) after round-trip
    for (let i = 0; i < result.length; i++) {
      const runs = (result[i] as any).paragraph.rich_text;
      const fullText = runs.map((r: any) => r.text.content).join("");
      const origText = (blocks[i] as any).paragraph.rich_text[0].text.content;
      assert.equal(fullText, origText, `block ${i} content corrupted in round-trip`);
      for (const run of runs) {
        assert.equal(run.annotations.bold, false, `block ${i} unexpectedly gained bold`);
        assert.equal(run.annotations.italic, false, `block ${i} unexpectedly gained italic`);
        assert.equal(run.annotations.strikethrough, false, `block ${i} unexpectedly gained strikethrough`);
        assert.equal(run.annotations.code, false, `block ${i} unexpectedly gained code`);
      }
    }
  });

  it("mixed content preserves block order", () => {
    const md = "# Title\n\nParagraph.\n\n- List item\n\n```\ncode\n```\n\n---\n\n> Quote";
    const result = mdRoundTrip(md);
    const titleIdx = result.indexOf("# Title");
    const paraIdx = result.indexOf("Paragraph.");
    const listIdx = result.indexOf("- List item");
    const codeIdx = result.indexOf("code");
    const dividerIdx = result.indexOf("---");
    const quoteIdx = result.indexOf("> Quote");
    assert.ok(titleIdx < paraIdx, "title before para");
    assert.ok(paraIdx < listIdx, "para before list");
    assert.ok(listIdx < codeIdx, "list before code");
    assert.ok(codeIdx < dividerIdx, "code before divider");
    assert.ok(dividerIdx < quoteIdx, "divider before quote");
  });
});
