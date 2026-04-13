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

  it("heading with nested children renders children after the heading line", () => {
    // Regression: renderBlock used to emit only the heading line, dropping
    // any children. For toggleable headings and paragraphs-with-children,
    // that meant `page get` silently lost content from the markdown output.
    const child = mkBlock("paragraph", { rich_text: [rt("under the heading")], color: "default" });
    const parent = mkBlock(
      "heading_1",
      { rich_text: [rt("Section")], color: "default", is_toggleable: true },
      { has_children: true },
    );
    (parent as any)._children = [child];
    const out = blocksToMarkdown([parent]);
    assert.match(out, /# Section/);
    assert.match(out, /under the heading/);
  });

  it("paragraph with nested children renders children after the paragraph", () => {
    const child = mkBlock("paragraph", { rich_text: [rt("nested body")], color: "default" });
    const parent = mkBlock(
      "paragraph",
      { rich_text: [rt("top level")], color: "default" },
      { has_children: true },
    );
    (parent as any)._children = [child];
    const out = blocksToMarkdown([parent]);
    assert.match(out, /top level/);
    assert.match(out, /nested body/);
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

  it("to_do with nested children", () => {
    const parent: any = mkBlock("to_do", { rich_text: [rt("parent")], checked: false, color: "default" });
    parent._children = [
      mkBlock("to_do", { rich_text: [rt("child unchecked")], checked: false, color: "default" }),
      mkBlock("to_do", { rich_text: [rt("child checked")], checked: true, color: "default" }),
    ];
    const out = blocksToMarkdown([parent]);
    assert.match(out, /^- \[ \] parent$/m);
    assert.match(out, /^ {2}- \[ \] child unchecked$/m);
    assert.match(out, /^ {2}- \[x\] child checked$/m);
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

  it("code block containing triple backticks uses a longer fence", () => {
    const inner = "Here is a nested fence:\n```python\nprint('hi')\n```\nEnd.";
    const blocks: Block[] = [
      mkBlock("code", {
        rich_text: [rt(inner)],
        caption: [],
        language: "markdown",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    // Outer fence must be longer than any inner backtick run
    assert.match(out, /^````+markdown\n/m, "outer fence is 4+ backticks");
    assert.ok(out.includes("```python"), "inner triple backticks preserved verbatim");
    // The outer fence must close on its own line with the same length
    const match = out.match(/^(`{4,})markdown/);
    assert.ok(match);
    const fence = match![1]!;
    assert.ok(out.endsWith(`\n${fence}`), "closes with matching fence length");
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
    assert.match(out, /> This is a tip/);
    // Known icon+color → no sidecar comments needed
    assert.ok(!out.includes("<!-- icon"), "known emoji should not produce sidecar comment");
  });

  it("callout WARNING type round-trips via emoji", () => {
    const blocks: Block[] = [
      mkBlock("callout", {
        rich_text: [rt("Careful here")],
        icon: { type: "emoji", emoji: "⚠️" },
        color: "yellow_background",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /> \[!WARNING\]/);
    assert.match(out, /> Careful here/);
  });

  it("callout with unknown emoji preserves it as sidecar comment", () => {
    const blocks: Block[] = [
      mkBlock("callout", {
        rich_text: [rt("Custom")],
        icon: { type: "emoji", emoji: "🎯" },
        color: "default",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /> \[!NOTE\]/);
    assert.match(out, /<!-- icon: 🎯 -->/);
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

  it("GFM table preserves inline code and bold in cells", () => {
    const tableBlock: Block = {
      object: "block",
      id: "table-fmt",
      type: "table",
      has_children: true,
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
      },
    } as Block;
    (tableBlock as any).table.children = [
      {
        type: "table_row",
        table_row: { cells: [[rt("Command")], [rt("Desc")]] },
      },
      {
        type: "table_row",
        table_row: {
          cells: [
            [rt("whoami", { code: true })],
            [rt("Show "), rt("integration", { bold: true }), rt(" info")],
          ],
        },
      },
    ];
    const out = blocksToMarkdown([tableBlock]);
    assert.match(out, /`whoami`/, "inline code should be preserved in table cell");
    assert.match(out, /\*\*integration\*\*/, "bold should be preserved in table cell");
  });

  it("GFM table escapes literal pipe in cell content", () => {
    const tableBlock: Block = {
      object: "block",
      id: "table-pipe",
      type: "table",
      has_children: true,
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
      },
    } as Block;
    (tableBlock as any).table.children = [
      {
        type: "table_row",
        table_row: { cells: [[rt("Flag")], [rt("Desc")]] },
      },
      {
        type: "table_row",
        table_row: {
          cells: [
            [rt("md|json|csv")],
            [rt("formats")],
          ],
        },
      },
    ];
    const out = blocksToMarkdown([tableBlock]);
    // Pipes in cell content must be escaped so the table structure isn't broken
    assert.match(out, /md\\\|json\\\|csv/, "pipes in cell content should be escaped");
  });
});

describe("blocksToMarkdown — blockquote multi-line", () => {
  it("multi-line quote rich_text gets > prefix on every line", () => {
    const block = mkBlock("quote", {
      rich_text: [rt("Line one\nLine two\nLine three")],
      color: "default",
    });
    const out = blocksToMarkdown([block]);
    assert.equal(out, "> Line one\n> Line two\n> Line three");
  });

  it("single-line quote still works", () => {
    const block = mkBlock("quote", {
      rich_text: [rt("Single line")],
      color: "default",
    });
    const out = blocksToMarkdown([block]);
    assert.equal(out, "> Single line");
  });

  it("quote with children prefixes children too", () => {
    const child = mkBlock("paragraph", { rich_text: [rt("Child paragraph")], color: "default" });
    const block = {
      ...mkBlock("quote", { rich_text: [rt("Quote text")], color: "default" }),
      _children: [child],
    };
    const out = blocksToMarkdown([block as unknown as Block]);
    assert.ok(out.includes("> Quote text"), "quote text has > prefix");
    assert.ok(out.includes("> Child paragraph"), "child has > prefix");
  });

  it("multi-line quote with children prefixes all lines", () => {
    const child = mkBlock("bulleted_list_item", {
      rich_text: [rt("list item")],
      color: "default",
    });
    const block = {
      ...mkBlock("quote", { rich_text: [rt("First\nSecond")], color: "default" }),
      _children: [child],
    };
    const out = blocksToMarkdown([block as unknown as Block]);
    const lines = out.split("\n");
    for (const line of lines) {
      // Either `> text` or a bare `>` paragraph-break continuation line.
      assert.ok(
        line.startsWith("> ") || line === ">",
        `all lines must be in the quote (> text or bare >) but got: "${line}"`,
      );
    }
  });

  it("quote with child paragraph preserves paragraph break on round-trip", () => {
    // Regression: the read path used to emit `> main\n> child` back-to-back,
    // which a subsequent write pass collapses into a single main paragraph
    // run, losing the second paragraph.
    const child = mkBlock("paragraph", { rich_text: [rt("Second paragraph")], color: "default" });
    const block = {
      ...mkBlock("quote", { rich_text: [rt("First paragraph")], color: "default" }),
      _children: [child],
    };
    const out = blocksToMarkdown([block as unknown as Block]);
    // Expect an empty `>` line (bare) between the two paragraphs.
    assert.match(out, /> First paragraph\n>\n> Second paragraph/);
  });
});

describe("code block fence widening", () => {
  it("emits a longer fence when code body contains triple backticks", () => {
    const blocks: Block[] = [
      mkBlock("code", {
        rich_text: [rt("outer\n```\nnested fence\n```\nclose")],
        caption: [],
        language: "plain text",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    // The opening and closing fences must be at least 4 backticks so the
    // 3-backtick lines inside the body don't terminate the block early.
    assert.match(out, /^`{4,}/m);
    assert.match(out, /`{4,}$/m);
  });

  it("uses the standard 3-backtick fence when no inner backticks", () => {
    const blocks: Block[] = [
      mkBlock("code", {
        rich_text: [rt("plain content")],
        caption: [],
        language: "plain text",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.ok(out.startsWith("```\n"), `expected 3-backtick fence, got: ${out}`);
  });
});

describe("column content must not be silently dropped", () => {
  it("renders column_list children as sequential content", () => {
    const col1: Block = {
      object: "block",
      id: "col1-id",
      type: "column" as Block["type"],
      has_children: true,
      column: {},
      _children: [
        mkBlock("paragraph", { rich_text: [rt("Left column text")], color: "default" }),
      ],
    } as unknown as Block;
    const col2: Block = {
      object: "block",
      id: "col2-id",
      type: "column" as Block["type"],
      has_children: true,
      column: {},
      _children: [
        mkBlock("paragraph", { rich_text: [rt("Right column text")], color: "default" }),
      ],
    } as unknown as Block;
    const columnList: Block = {
      object: "block",
      id: "collist-id",
      type: "column_list" as Block["type"],
      has_children: true,
      column_list: {},
      _children: [col1, col2],
    } as unknown as Block;

    const out = blocksToMarkdown([columnList]);
    assert.ok(out.includes("Left column text"), `expected left column text, got: ${out}`);
    assert.ok(out.includes("Right column text"), `expected right column text, got: ${out}`);
    assert.ok(out.includes("<!-- notion-block: column_list"), "expected sidecar comment");
  });

  it("renders column_list without children as plain comment", () => {
    const columnList: Block = {
      object: "block",
      id: "empty-collist",
      type: "column_list" as Block["type"],
      has_children: false,
      column_list: {},
    } as unknown as Block;

    const out = blocksToMarkdown([columnList]);
    assert.ok(out.includes("<!-- notion-block: column_list id=empty-collist -->"));
    assert.ok(!out.includes("undefined"));
  });
});

describe("embed block URLs must be preserved", () => {
  it("renders embed as link with sidecar comment", () => {
    const embed: Block = {
      object: "block",
      id: "embed-id",
      type: "embed" as Block["type"],
      has_children: false,
      embed: {
        url: "https://www.youtube.com/watch?v=test123",
        caption: [],
      },
    } as unknown as Block;

    const out = blocksToMarkdown([embed]);
    assert.ok(out.includes("https://www.youtube.com/watch?v=test123"), `expected embed URL, got: ${out}`);
    assert.ok(out.includes("<!-- notion-block: embed id=embed-id -->"), "expected sidecar");
  });

  it("uses caption as link label when available", () => {
    const embed: Block = {
      object: "block",
      id: "embed-id",
      type: "embed" as Block["type"],
      has_children: false,
      embed: {
        url: "https://example.com/widget",
        caption: [{ plain_text: "My Widget" }],
      },
    } as unknown as Block;

    const out = blocksToMarkdown([embed]);
    assert.ok(out.includes("[My Widget](https://example.com/widget)"), `expected captioned link, got: ${out}`);
  });
});
