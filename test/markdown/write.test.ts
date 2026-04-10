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

describe("markdownToBlocks nested lists", () => {
  it("single-level bulleted list stays flat", () => {
    const blocks = markdownToBlocks("- A\n- B\n- C");
    assert.equal(blocks.length, 3);
    blocks.forEach((b) => assert.equal(b.type, "bulleted_list_item"));
    blocks.forEach((b) => assert.equal((b as any).bulleted_list_item.children, undefined));
  });

  it("two-level bulleted list nests children inside type object", () => {
    const md = "- Parent\n  - Child A\n  - Child B";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "one top-level block");
    assert.equal(blocks[0]!.type, "bulleted_list_item");
    // Children MUST live under the type-specific object (Notion API requirement)
    assert.equal((blocks[0] as any).children, undefined, "no top-level children key");
    const children = (blocks[0] as any).bulleted_list_item.children as any[];
    assert.equal(children.length, 2, "two children");
    assert.equal(children[0].type, "bulleted_list_item");
    assert.equal(children[1].type, "bulleted_list_item");
  });

  it("three-level nesting", () => {
    const md = "- A\n  - B\n    - C";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    const b = (blocks[0] as any).bulleted_list_item.children[0];
    assert.equal(b.type, "bulleted_list_item");
    const c = b.bulleted_list_item.children[0];
    assert.equal(c.type, "bulleted_list_item");
  });

  it("multiple top-level items each with children", () => {
    const md = "- P1\n  - C1\n- P2\n  - C2";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal((blocks[0] as any).bulleted_list_item.children.length, 1);
    assert.equal((blocks[1] as any).bulleted_list_item.children.length, 1);
  });

  it("nested numbered list", () => {
    const md = "1. First\n   1. Sub-first\n   2. Sub-second\n2. Second";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "numbered_list_item");
    const children = (blocks[0] as any).numbered_list_item.children as any[];
    assert.equal(children.length, 2);
    children.forEach((c: any) => assert.equal(c.type, "numbered_list_item"));
  });

  it("has_children is true on parent, false on leaf", () => {
    const md = "- Parent\n  - Leaf";
    const blocks = markdownToBlocks(md);
    assert.equal((blocks[0] as any).has_children, true);
    assert.equal((blocks[0] as any).bulleted_list_item.children[0].has_children, false);
  });

  it("no id field on new blocks", () => {
    const blocks = markdownToBlocks("- A\n  - B");
    assert.equal((blocks[0] as any).id, undefined);
    assert.equal((blocks[0] as any).bulleted_list_item.children[0].id, undefined);
  });

  it("to-do items preserved in nested list", () => {
    const blocks = markdownToBlocks("- [ ] open\n- [x] done");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "to_do");
    assert.equal((blocks[0] as any).to_do.checked, false);
    assert.equal(blocks[1]!.type, "to_do");
    assert.equal((blocks[1] as any).to_do.checked, true);
  });
});
