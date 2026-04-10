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
});
