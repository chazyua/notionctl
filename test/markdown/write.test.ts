import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks } from "../../src/markdown/write.js";

describe("markdownToBlocks basic blocks", () => {
  it("single paragraph", () => {
    const blocks = markdownToBlocks("Hello world.");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "paragraph");
  });

  it("multiple paragraphs separated by blank lines", () => {
    const blocks = markdownToBlocks("First para.\n\nSecond para.");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "paragraph");
  });

  it("headings 1-3", () => {
    const blocks = markdownToBlocks("# H1\n\n## H2\n\n### H3");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.type, "heading_1");
    assert.equal(blocks[1]!.type, "heading_2");
    assert.equal(blocks[2]!.type, "heading_3");
  });

  it("bulleted list", () => {
    const blocks = markdownToBlocks("- alpha\n- beta\n- gamma");
    assert.equal(blocks.length, 3);
    blocks.forEach((b) => assert.equal(b.type, "bulleted_list_item"));
  });

  it("numbered list", () => {
    const blocks = markdownToBlocks("1. one\n2. two\n3. three");
    assert.equal(blocks.length, 3);
    blocks.forEach((b) => assert.equal(b.type, "numbered_list_item"));
  });

  it("to_do items", () => {
    const blocks = markdownToBlocks("- [ ] open\n- [x] done");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "to_do");
    assert.equal((blocks[0] as any).to_do.checked, false);
    assert.equal((blocks[1] as any).to_do.checked, true);
  });

  it("quote", () => {
    const blocks = markdownToBlocks("> to be or not to be");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
  });

  it("fenced code block", () => {
    const blocks = markdownToBlocks("```typescript\nconst x = 1;\n```");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "code");
    assert.equal((blocks[0] as any).code.language, "typescript");
  });

  it("divider", () => {
    const blocks = markdownToBlocks("---");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "divider");
  });

  it("ignores leading/trailing whitespace and blank lines", () => {
    const blocks = markdownToBlocks("\n\n# Hello\n\n\n");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "heading_1");
  });
});

describe("markdownToBlocks complex blocks", () => {
  it("GFM alert callout", () => {
    const blocks = markdownToBlocks("> [!NOTE] Some note\n<!-- icon: 💡 -->\n<!-- color: blue_background -->");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.icon.emoji, "💡");
    assert.equal((blocks[0] as any).callout.color, "blue_background");
  });

  it("HTML details toggle", () => {
    const blocks = markdownToBlocks(
      "<details><summary>Expand me</summary>\n\nHidden body\n\n</details>",
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
  });

  it("equation block", () => {
    const blocks = markdownToBlocks("$$E = mc^2$$");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "equation");
    assert.equal((blocks[0] as any).equation.expression, "E = mc^2");
  });

  it("pass-through block preserves ID", () => {
    const blocks = markdownToBlocks("<!-- notion-block: synced_block id=abc-123 -->");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "synced_block");
    assert.equal(blocks[0]!.id, "abc-123");
  });

  it("GFM table", () => {
    const md = "| Name | Status |\n| --- | --- |\n| Alice | Active |\n| Bob | Inactive |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "table");
    const table = blocks[0] as any;
    assert.equal(table.table.table_width, 2);
    assert.equal(table.table.has_column_header, true);
    assert.equal(table.table.children.length, 3);  // header + 2 rows
  });
});
