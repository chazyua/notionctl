import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksToMarkdown } from "../../src/markdown/read.js";
import type { Block, RichText } from "../../src/markdown/types.js";
import { DEFAULT_ANNOTATIONS } from "../../src/markdown/types.js";

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

describe("blocksToMarkdown basic blocks", () => {
  it("paragraph", () => {
    const blocks: Block[] = [mkBlock("paragraph", { rich_text: [rt("hello world")], color: "default" })];
    assert.equal(blocksToMarkdown(blocks).trim(), "hello world");
  });

  it("heading 1, 2, 3", () => {
    const blocks: Block[] = [
      mkBlock("heading_1", { rich_text: [rt("Title")], color: "default", is_toggleable: false }),
      mkBlock("heading_2", { rich_text: [rt("Subtitle")], color: "default", is_toggleable: false }),
      mkBlock("heading_3", { rich_text: [rt("Subsubtitle")], color: "default", is_toggleable: false }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /^# Title$/m);
    assert.match(out, /^## Subtitle$/m);
    assert.match(out, /^### Subsubtitle$/m);
  });

  it("bulleted and numbered list items", () => {
    const blocks: Block[] = [
      mkBlock("bulleted_list_item", { rich_text: [rt("bullet one")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("bullet two")], color: "default" }),
      mkBlock("numbered_list_item", { rich_text: [rt("number one")], color: "default" }),
      mkBlock("numbered_list_item", { rich_text: [rt("number two")], color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /^- bullet one$/m);
    assert.match(out, /^- bullet two$/m);
    assert.match(out, /^1\. number one$/m);
    assert.match(out, /^2\. number two$/m);
  });

  it("to_do unchecked and checked", () => {
    const blocks: Block[] = [
      mkBlock("to_do", { rich_text: [rt("open task")], checked: false, color: "default" }),
      mkBlock("to_do", { rich_text: [rt("done task")], checked: true, color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /^- \[ \] open task$/m);
    assert.match(out, /^- \[x\] done task$/m);
  });

  it("quote", () => {
    const blocks: Block[] = [mkBlock("quote", { rich_text: [rt("to be or not to be")], color: "default" })];
    assert.match(blocksToMarkdown(blocks), /^> to be or not to be$/m);
  });

  it("code block with language", () => {
    const blocks: Block[] = [
      mkBlock("code", {
        rich_text: [rt("const x = 1;")],
        caption: [],
        language: "typescript",
      }),
    ];
    assert.match(blocksToMarkdown(blocks), /```typescript\nconst x = 1;\n```/);
  });

  it("divider", () => {
    const blocks: Block[] = [mkBlock("divider", {})];
    assert.match(blocksToMarkdown(blocks), /^---$/m);
  });

  it("separates sibling blocks with blank lines", () => {
    const blocks: Block[] = [
      mkBlock("paragraph", { rich_text: [rt("first")], color: "default" }),
      mkBlock("paragraph", { rich_text: [rt("second")], color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.equal(out.trim(), "first\n\nsecond");
  });

  it("groups adjacent list items without blank lines between", () => {
    const blocks: Block[] = [
      mkBlock("bulleted_list_item", { rich_text: [rt("a")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("b")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("c")], color: "default" }),
    ];
    assert.equal(blocksToMarkdown(blocks).trim(), "- a\n- b\n- c");
  });
});

describe("blocksToMarkdown complex blocks", () => {
  it("callout with emoji icon and color", () => {
    const blocks: Block[] = [
      mkBlock("callout", {
        rich_text: [rt("This is a tip")],
        icon: { type: "emoji", emoji: "💡" },
        color: "blue_background",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /> \[!NOTE\]/);
    assert.match(out, /This is a tip/);
    assert.match(out, /<!-- icon: 💡 -->/);
    assert.match(out, /<!-- color: blue_background -->/);
  });

  it("toggle block", () => {
    const blocks: Block[] = [
      mkBlock("toggle", { rich_text: [rt("Summary text")], color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /<details><summary>Summary text<\/summary>/);
    assert.match(out, /<\/details>/);
  });

  it("equation block", () => {
    const blocks: Block[] = [
      mkBlock("equation", { expression: "E = mc^2" }),
    ];
    assert.match(blocksToMarkdown(blocks), /\$\$E = mc\^2\$\$/);
  });

  it("image with caption", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "img-1",
        type: "image",
        has_children: false,
        image: {
          type: "external",
          external: { url: "https://example.com/pic.png" },
          caption: [rt("A picture")],
        },
      } as Block,
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /!\[A picture\]\(https:\/\/example\.com\/pic\.png\)/);
    assert.match(out, /<!-- notion-block: image id=img-1 -->/);
  });

  it("synced_block passes through as HTML comment", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "sync-1",
        type: "synced_block",
        has_children: true,
        synced_block: { synced_from: null },
      } as Block,
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /<!-- notion-block: synced_block id=sync-1 -->/);
  });

  it("column_list passes through", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "col-1",
        type: "column_list",
        has_children: true,
        column_list: {},
      } as Block,
    ];
    assert.match(blocksToMarkdown(blocks), /<!-- notion-block: column_list id=col-1 -->/);
  });

  it("unknown future block type passes through", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "x-1",
        type: "unsupported" as any,
        has_children: false,
        unsupported: {},
      } as Block,
    ];
    assert.match(blocksToMarkdown(blocks), /<!-- notion-block: unsupported id=x-1 -->/);
  });
});

describe("blocksToMarkdown nested lists", () => {
  it("flat list renders without indentation", () => {
    const blocks: Block[] = [
      mkBlock("bulleted_list_item", { rich_text: [rt("a")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("b")], color: "default" }),
    ];
    assert.equal(blocksToMarkdown(blocks).trim(), "- a\n- b");
  });

  it("nested bulleted list renders with 2-space indentation", () => {
    const parent = mkBlock("bulleted_list_item", { rich_text: [rt("parent")], color: "default" }, { has_children: true });
    const child = mkBlock("bulleted_list_item", { rich_text: [rt("child")], color: "default" });
    (parent as any)._children = [child];
    const out = blocksToMarkdown([parent]);
    assert.equal(out.trim(), "- parent\n  - child");
  });

  it("three-level nesting indents by 4 spaces at level 2", () => {
    const grandchild = mkBlock("bulleted_list_item", { rich_text: [rt("gc")], color: "default" });
    const child = mkBlock("bulleted_list_item", { rich_text: [rt("c")], color: "default" }, { has_children: true });
    (child as any)._children = [grandchild];
    const parent = mkBlock("bulleted_list_item", { rich_text: [rt("p")], color: "default" }, { has_children: true });
    (parent as any)._children = [child];
    const out = blocksToMarkdown([parent]);
    assert.equal(out.trim(), "- p\n  - c\n    - gc");
  });

  it("nested numbered list counts correctly", () => {
    const c1 = mkBlock("numbered_list_item", { rich_text: [rt("sub-one")], color: "default" });
    const c2 = mkBlock("numbered_list_item", { rich_text: [rt("sub-two")], color: "default" });
    const parent = mkBlock("numbered_list_item", { rich_text: [rt("top")], color: "default" }, { has_children: true });
    (parent as any)._children = [c1, c2];
    const out = blocksToMarkdown([parent]);
    assert.match(out, /^1\. top$/m);
    assert.match(out, /^  1\. sub-one$/m);
    assert.match(out, /^  2\. sub-two$/m);
  });

  it("multiple top-level items each with children", () => {
    const p1 = mkBlock("bulleted_list_item", { rich_text: [rt("P1")], color: "default" }, { has_children: true });
    (p1 as any)._children = [mkBlock("bulleted_list_item", { rich_text: [rt("C1")], color: "default" })];
    const p2 = mkBlock("bulleted_list_item", { rich_text: [rt("P2")], color: "default" }, { has_children: true });
    (p2 as any)._children = [mkBlock("bulleted_list_item", { rich_text: [rt("C2")], color: "default" })];
    const out = blocksToMarkdown([p1, p2]);
    assert.match(out, /^- P1$/m);
    assert.match(out, /^  - C1$/m);
    assert.match(out, /^- P2$/m);
    assert.match(out, /^  - C2$/m);
  });

  it("GFM table with header", () => {
    const tableBlock: Block = {
      object: "block",
      id: "table-1",
      type: "table",
      has_children: true,
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
      },
    } as Block;
    // With children attached inline
    (tableBlock as any).table.children = [
      {
        object: "block",
        id: "row-1",
        type: "table_row",
        has_children: false,
        table_row: { cells: [[rt("Name")], [rt("Status")]] },
      },
      {
        object: "block",
        id: "row-2",
        type: "table_row",
        has_children: false,
        table_row: { cells: [[rt("Alice")], [rt("Active")]] },
      },
    ];
    const out = blocksToMarkdown([tableBlock]);
    assert.match(out, /\| Name \| Status \|/);
    assert.match(out, /\| --- \| --- \|/);
    assert.match(out, /\| Alice \| Active \|/);
  });
});
