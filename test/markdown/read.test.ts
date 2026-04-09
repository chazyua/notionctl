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
