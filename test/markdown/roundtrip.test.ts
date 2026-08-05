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
import { setMarkdownWarnHandler } from "../../src/markdown/write.js";

/**
 * The read path takes children on `_children`; the write path produces them on
 * `<type>.children`. Re-attaching lets a result be fed back in, which is what
 * makes multi-cycle testing possible — several first-cycle regressions hid
 * behind a helper that could only ever run once.
 */
function reattach(blocks: any[]): any[] {
  return blocks.map((b) => {
    const kids = b[b.type]?.children;
    return kids && kids.length > 0 ? { ...b, _children: reattach(kids) } : b;
  });
}

function roundTrip(blocks: unknown[]): unknown[] {
  const md = blocksToMarkdown(blocks as any);
  return markdownToBlocks(md);
}

/** Run `n` full read→write cycles, re-attaching children between each. */
function cycles(blocks: unknown[], n: number): unknown[] {
  let current = blocks as any[];
  for (let i = 0; i < n; i++) current = reattach(markdownToBlocks(blocksToMarkdown(current)) as any[]);
  return current;
}

/** Compact structural view, for asserting that two cycles agree. */
function shape(blocks: any[]): string {
  return JSON.stringify(blocks.map(function walk(b: any): unknown {
    const d = b[b.type] ?? {};
    return [b.type, (d.rich_text ?? []).map((r: any) => r.plain_text).join(""), (d.children ?? []).map(walk)];
  }));
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

  it("divider survives, in either spelling", () => {
    assert.match(mdRoundTrip("---"), /^\*\*\*$/m, "--- is read as a divider and written back unambiguously");
    assert.match(mdRoundTrip("***"), /^\*\*\*$/m);
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
    const dividerIdx = result.indexOf("***");
    const quoteIdx = result.indexOf("> Quote");
    assert.ok(titleIdx < paraIdx, "title before para");
    assert.ok(paraIdx < listIdx, "para before list");
    assert.ok(listIdx < codeIdx, "list before code");
    assert.ok(codeIdx < dividerIdx, "code before divider");
    assert.ok(dividerIdx < quoteIdx, "divider before quote");
  });
});

describe("prose that looks like a block marker", () => {
  const ANN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
  const runs = (t: string) => [{ type: "text", text: { content: t, link: null }, plain_text: t, href: null, annotations: ANN }];
  const para = (t: string) => ({ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: runs(t) } });

  /** Text of the first block, whatever its type. */
  function firstText(blocks: unknown[]): string {
    const b = blocks[0] as any;
    return (b?.[b?.type]?.rich_text ?? []).map((r: any) => r.text?.content ?? r.plain_text ?? "").join("");
  }

  // Each of these was silently re-typed on write-back. `---` was the worst:
  // it became a divider and the text was discarded entirely.
  // One entry per distinct code path. `* star`, `***`, "```" and `___` look
  // redundant next to `- note`/`---` but are not: the inline escaper already
  // shields those characters, so they prove we do not add a second backslash.
  const MARKERS = [
    "---", "# not a heading", "- note", "* star", "> quoted", ">", "1. first",
    "$$x$$", "<details>", "| a | b |", "```", "***", "___", "  # indented",
  ];

  for (const text of MARKERS) {
    it(`keeps ${JSON.stringify(text)} as a paragraph with its text intact`, () => {
      const result = roundTrip([para(text)]);
      assert.equal(result.length, 1, "must stay a single block");
      assert.equal((result[0] as any).type, "paragraph", `${JSON.stringify(text)} was re-typed`);
      assert.equal(firstText(result), text, "text must survive verbatim");
      // Concatenated text alone hides re-typing *within* the paragraph: `$$x$$`
      // used to come back as text+equation+text, which reassembles to the right
      // string while having silently become a rendered equation in Notion.
      const runs = (result[0] as any).paragraph.rich_text;
      assert.equal(runs.length, 1, `${JSON.stringify(text)} was split into ${runs.length} runs`);
      assert.equal(runs[0].type, "text", `${JSON.stringify(text)} became a ${runs[0].type} run`);
    });
  }

  it("does not turn a literal $$ into an inline equation mid-line either", () => {
    // The same defect away from line start, where no shielding is involved.
    const result = roundTrip([para("a $$x$$ b")]);
    const runs = (result[0] as any).paragraph.rich_text;
    assert.equal(runs.length, 1, "literal $$ must not open an equation");
    assert.equal(runs[0].text.content, "a $$x$$ b");
  });

  it("still parses a genuine single-dollar inline equation", () => {
    const blocks = markdownToBlocks("a $x^2$ b");
    const runs = (blocks[0] as any).paragraph.rich_text;
    assert.ok(runs.some((r: any) => r.type === "equation"), "real inline equations must still work");
  });

  it("does not touch prose that only resembles a marker mid-line", () => {
    for (const text of ["normal text", "a - dash", "5 items", "#hashtag", "-5 degrees", "x > y"]) {
      const md = blocksToMarkdown([para(text)] as any);
      assert.equal(md, text, `${JSON.stringify(text)} must not be escaped`);
    }
  });

  it("shields a marker on any line, not just the first", () => {
    const result = roundTrip([para("intro\n# second\ntail")]);
    assert.equal(result.length, 1, "a later marker line must not split the paragraph");
    assert.equal(firstText(result), "intro\n# second\ntail");
  });

  it("keeps quote text that starts with a marker", () => {
    const blocks = [{ id: "1", type: "quote", has_children: false, quote: { rich_text: runs("# inside quote") } }];
    const result = roundTrip(blocks);
    assert.equal((result[0] as any).type, "quote");
    assert.equal(firstText(result), "# inside quote", "quote text was dropped");
  });

  it("keeps callout text that starts with a marker", () => {
    const blocks = [{
      id: "1", type: "callout", has_children: false,
      callout: { rich_text: runs("- inside callout"), icon: { type: "emoji", emoji: "\u{1F4A1}" }, color: "default" },
    }];
    const result = roundTrip(blocks);
    assert.equal((result[0] as any).type, "callout");
    assert.equal(firstText(result), "- inside callout", "callout text was dropped");
  });

  it("leaves a literal leading backslash alone", () => {
    // `\# foo` is prose starting with a backslash, not a shielded heading — the
    // shield must not be stripped off it on the way back in.
    const result = roundTrip([para("\\# foo")]);
    assert.equal((result[0] as any).type, "paragraph");
    assert.equal(firstText(result), "\\# foo");
  });

  it("is idempotent — repeated syncs do not accrete backslashes", () => {
    for (const text of ["---", "# heading-ish", "\\# literal", "| a | b |"]) {
      const md1 = blocksToMarkdown([para(text)] as any);
      const md2 = blocksToMarkdown(markdownToBlocks(md1) as any);
      const md3 = blocksToMarkdown(markdownToBlocks(md2) as any);
      assert.equal(md2, md1, `${JSON.stringify(text)} drifted on the second sync`);
      assert.equal(md3, md2, `${JSON.stringify(text)} drifted on the third sync`);
    }
  });

  it("still lets real markers build real blocks", () => {
    // The shield must only apply to text that came from Notion prose. A user
    // authoring markdown by hand still gets real headings, lists and dividers.
    const result = markdownToBlocks("# Real heading\n\n- real item\n\n---");
    assert.deepEqual(result.map((b: any) => b.type), ["heading_1", "bulleted_list_item", "divider"]);
  });
});

describe("list item children survive the round-trip", () => {
  function rt(text: string) {
    return [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
  }

  it("an extra paragraph stays a child, not a top-level sibling", () => {
    const blocks = [{
      id: "1", type: "bulleted_list_item", has_children: true,
      bulleted_list_item: { rich_text: rt("Item"), color: "default" },
      _children: [{ id: "2", type: "paragraph", has_children: false, paragraph: { rich_text: rt("belongs to the item"), color: "default" } }],
    }];
    const result = roundTrip(blocks) as any[];
    assert.equal(result.length, 1, "the paragraph must not escape to the top level");
    const children = result[0].bulleted_list_item.children;
    assert.equal(children.length, 1);
    assert.equal(children[0].type, "paragraph");
    assert.equal(children[0].paragraph.rich_text[0].text.content, "belongs to the item");
  });

  it("a code child stays attached and keeps its language", () => {
    const blocks = [{
      id: "1", type: "bulleted_list_item", has_children: true,
      bulleted_list_item: { rich_text: rt("Item"), color: "default" },
      _children: [{ id: "2", type: "code", has_children: false, code: { rich_text: rt("print(1)"), caption: [], language: "python" } }],
    }];
    const result = roundTrip(blocks) as any[];
    assert.equal(result.length, 1);
    const children = result[0].bulleted_list_item.children;
    assert.equal(children[0].type, "code");
    assert.equal(children[0].code.language, "python");
    assert.equal(children[0].code.rich_text[0].text.content, "print(1)");
  });

  it("a nested list item and an extra paragraph coexist", () => {
    const blocks = [{
      id: "1", type: "bulleted_list_item", has_children: true,
      bulleted_list_item: { rich_text: rt("Item"), color: "default" },
      _children: [
        { id: "2", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("nested"), color: "default" } },
        { id: "3", type: "paragraph", has_children: false, paragraph: { rich_text: rt("trailing note"), color: "default" } },
      ],
    }];
    const result = roundTrip(blocks) as any[];
    assert.equal(result.length, 1);
    assert.equal(result[0].bulleted_list_item.children.length, 2);
  });
});

describe("setext underlines in prose are shielded", () => {
  function para(text: string) {
    return [{ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }], color: "default" } }];
  }
  function textOf(blocks: any[]) {
    return blocks[0][blocks[0].type].rich_text.map((r: any) => r.plain_text).join("");
  }

  for (const body of ["===", "---", "--", "=", "\\===", "Title\n===", "a\n-"]) {
    it(`a paragraph reading ${JSON.stringify(body)} stays that paragraph`, () => {
      const back = roundTrip(para(body)) as any[];
      assert.equal(back.length, 1, "must not split into a heading or a divider");
      assert.equal(back[0].type, "paragraph");
      assert.equal(textOf(back), body);
      // A second cycle must not accrete or shed backslashes.
      assert.equal(textOf(roundTrip(para(textOf(back))) as any[]), body);
    });
  }
});

describe("list item child order is preserved", () => {
  function rt(text: string) {
    return [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
  }
  function item(text: string, children?: any[]) {
    const b: any = { id: "1", type: "bulleted_list_item", has_children: !!children, bulleted_list_item: { rich_text: rt(text), color: "default" } };
    if (children) b._children = children;
    return b;
  }
  const para = (t: string) => ({ id: "2", type: "paragraph", has_children: false, paragraph: { rich_text: rt(t), color: "default" } });

  it("a paragraph written above a nested item stays above it", () => {
    const result = roundTrip([item("Item", [para("note"), item("sub")])]) as any[];
    const kids = result[0].bulleted_list_item.children;
    assert.deepEqual(kids.map((k: any) => k.type), ["paragraph", "bulleted_list_item"]);
  });

  it("a paragraph written below a nested item stays below it", () => {
    const result = roundTrip([item("Item", [item("sub"), para("note")])]) as any[];
    const kids = result[0].bulleted_list_item.children;
    assert.deepEqual(kids.map((k: any) => k.type), ["bulleted_list_item", "paragraph"]);
  });
});

describe("a heading with a soft line break", () => {
  it("keeps a setext-looking continuation line instead of swallowing it", () => {
    const text = "Release\nnotes\n===";
    const blocks = [{ id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }], color: "default", is_toggleable: false } }];
    const result = roundTrip(blocks) as any[];
    const all = result.map((b) => b[b.type].rich_text.map((r: any) => r.plain_text).join("")).join("\n");
    assert.match(all, /===/, "the underline must not be deleted");
    assert.match(all, /notes/);
  });
});

describe("toggleable headings", () => {
  function rt(text: string) {
    return [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
  }
  function heading(level: 1 | 2 | 3, text: string, toggleable: boolean, children?: any[]) {
    const key = `heading_${level}`;
    const b: any = { id: "1", type: key, has_children: !!children, [key]: { rich_text: rt(text), color: "default", is_toggleable: toggleable } };
    if (children) b._children = children;
    return b;
  }
  const para = (t: string) => ({ id: "2", type: "paragraph", has_children: false, paragraph: { rich_text: rt(t), color: "default" } });

  for (const level of [1, 2, 3] as const) {
    it(`an H${level} keeps is_toggleable and its children`, () => {
      const result = roundTrip([heading(level, "Section", true, [para("hidden child")])]) as any[];
      assert.equal(result.length, 1, "children must stay nested, not become siblings");
      assert.equal(result[0].type, `heading_${level}`);
      assert.equal(result[0][`heading_${level}`].is_toggleable, true);
      const kids = result[0][`heading_${level}`].children;
      assert.equal(kids.length, 1);
      assert.equal(kids[0].paragraph.rich_text[0].text.content, "hidden child");
    });
  }

  it("a toggleable heading with no children still round-trips", () => {
    const result = roundTrip([heading(2, "Empty", true)]) as any[];
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "heading_2");
    assert.equal(result[0].heading_2.is_toggleable, true);
  });

  it("a plain heading stays plain", () => {
    const result = roundTrip([heading(1, "Section", false)]) as any[];
    assert.equal(result[0].type, "heading_1");
    assert.equal(result[0].heading_1.is_toggleable, false);
  });

  it("a hand-written <details> with no sidecar is still a toggle", () => {
    const result = markdownToBlocks("<details><summary>Plain</summary>\n\nbody\n\n</details>") as any[];
    assert.equal(result[0].type, "toggle");
  });

  it("a stray heading sidecar does not attach to a later toggle", () => {
    const result = markdownToBlocks("<!-- notion-heading: 1 -->") as any[];
    assert.equal(result.length, 0);
  });
});

describe("a heading containing a line break", () => {
  function head(text: string) {
    return [{ id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }], color: "default", is_toggleable: false } }];
  }

  it("stays one heading, with the break normalised to a space", () => {
    const result = roundTrip(head("Release\nnotes")) as any[];
    assert.equal(result.length, 1, "must not split into a heading plus a paragraph");
    assert.equal(result[0].type, "heading_1");
    assert.equal(result[0].heading_1.rich_text.map((r: any) => r.plain_text).join(""), "Release notes");
  });

  it("keeps text that looks like a setext underline", () => {
    const result = roundTrip(head("Release\nnotes\n===")) as any[];
    assert.equal(result.length, 1);
    assert.match(result[0].heading_1.rich_text.map((r: any) => r.plain_text).join(""), /===/);
  });

  it("is stable on a second pass", () => {
    const once = roundTrip(head("Release\nnotes")) as any[];
    const twice = roundTrip(once.map((b: any) => ({ ...b, _children: b[b.type]?.children }))) as any[];
    assert.equal(twice.length, 1);
    assert.equal(twice[0].heading_1.rich_text.map((r: any) => r.plain_text).join(""), "Release notes");
  });
});

describe("HTML close tags inside a disclosure title", () => {
  function rt(text: string) {
    return [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
  }
  const titles = ["a</summary>b", "a</details>b", "a&lt;/summary>b", "A & B", "a<details>b"];

  for (const title of titles) {
    it(`a toggle titled ${JSON.stringify(title)} survives`, () => {
      const result = roundTrip([{ id: "1", type: "toggle", has_children: false, toggle: { rich_text: rt(title), color: "default" } }]) as any[];
      assert.equal(result.length, 1);
      assert.equal(result[0].toggle.rich_text.map((r: any) => r.plain_text).join(""), title);
    });

    it(`a toggleable heading titled ${JSON.stringify(title)} survives`, () => {
      const result = roundTrip([{ id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: rt(title), color: "default", is_toggleable: true } }]) as any[];
      assert.equal(result.length, 1);
      assert.equal(result[0].heading_1.rich_text.map((r: any) => r.plain_text).join(""), title);
    });
  }
});

describe("markers the parser consumes are shielded as prose", () => {
  function para(text: string) {
    return [{ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }], color: "default" } }];
  }

  for (const marker of ["<!-- notion-heading: 2 -->", "<!-- notion-table: has_column_header=false -->", "#"]) {
    it(`a paragraph reading ${JSON.stringify(marker)} survives`, () => {
      const result = roundTrip(para(marker)) as any[];
      assert.equal(result.length, 1);
      assert.equal(result[0].type, "paragraph");
      assert.equal(result[0].paragraph.rich_text.map((r: any) => r.plain_text).join(""), marker);
    });
  }

  it("a stray heading marker does not retype a later toggle", () => {
    const md = "<!-- notion-heading: 1 -->\n\nSome paragraph\n\n<details><summary>Just a toggle</summary>\n\nbody\n\n</details>";
    const result = markdownToBlocks(md) as any[];
    assert.deepEqual(result.map((b) => b.type), ["paragraph", "toggle"]);
  });

  it("a stray table marker does not strip a later table's header", () => {
    const md = "<!-- notion-table: has_column_header=false -->\n\nSome paragraph\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    const result = markdownToBlocks(md) as any[];
    assert.equal(result[1].type, "table");
    assert.equal(result[1].table.has_column_header, true);
  });

  it("an empty heading round-trips as a heading, not a paragraph", () => {
    const blocks = [{ id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: [], color: "default", is_toggleable: false } }];
    const result = roundTrip(blocks) as any[];
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "heading_1");
  });

  it("a doubly-escaped close tag in a title is not eaten", () => {
    const title = "x&amp;lt;/summary>y";
    const result = roundTrip([{ id: "1", type: "toggle", has_children: false, toggle: { rich_text: [{ type: "text", text: { content: title, link: null }, plain_text: title, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }], color: "default" } }]) as any[];
    assert.equal(result[0].toggle.rich_text.map((r: any) => r.plain_text).join(""), title);
  });
});

describe("mentions round-trip as mentions", () => {
  function mention(kind: "user" | "page" | "database", id: string, label: string) {
    const inner = kind === "user" ? { user: { id } } : kind === "page" ? { page: { id } } : { database: { id } };
    return [{
      id: "1", type: "paragraph", has_children: false,
      paragraph: {
        rich_text: [{ type: "mention", mention: { type: kind, ...inner }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }, plain_text: label, href: null }],
        color: "default",
      },
    }];
  }
  const ID = "33dd872b-594c-816b-b58b-00025280b6c9";

  for (const kind of ["user", "page", "database"] as const) {
    it(`a ${kind} mention comes back as a ${kind} mention`, () => {
      const result = roundTrip(mention(kind, ID, "@Dev Alot")) as any[];
      const run = result[0].paragraph.rich_text[0];
      assert.equal(run.type, "mention", "must not degrade to a link");
      assert.equal(run.mention.type, kind);
      assert.equal(run.mention[kind].id, ID);
    });
  }

  it("a person mention no longer leaks a bare id as visible text", () => {
    const md = blocksToMarkdown(mention("user", ID, "@Dev Alot") as any);
    assert.match(md, /@Dev Alot/, "the display name must be visible");
    assert.doesNotMatch(md, /@user:/, "the raw id must not be the visible text");
  });
});

describe("callout icons", () => {
  function callout(icon: any) {
    return [{
      id: "1", type: "callout", has_children: false,
      callout: {
        rich_text: [{ type: "text", text: { content: "body", link: null }, plain_text: "body", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }],
        icon, color: "default",
      },
    }];
  }

  it("an external icon URL survives", () => {
    const url = "https://example.com/star.png";
    const result = roundTrip(callout({ type: "external", external: { url } })) as any[];
    assert.deepEqual(result[0].callout.icon, { type: "external", external: { url } });
  });

  it("a built-in Notion icon survives with its colour", () => {
    const result = roundTrip(callout({ type: "icon", icon: { name: "star", color: "yellow" } })) as any[];
    assert.deepEqual(result[0].callout.icon, { type: "icon", icon: { name: "star", color: "yellow" } });
  });

  it("a non-alert emoji icon still survives", () => {
    const result = roundTrip(callout({ type: "emoji", emoji: "🚀" })) as any[];
    assert.deepEqual(result[0].callout.icon, { type: "emoji", emoji: "🚀" });
  });

  it("an alert-mapped emoji needs no sidecar", () => {
    const md = blocksToMarkdown(callout({ type: "emoji", emoji: "⚠️" }) as any);
    assert.doesNotMatch(md, /<!-- icon:/);
    assert.match(md, /\[!WARNING\]/);
  });

  it("a Notion-hosted icon falls back with a warning rather than a dead URL", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((m) => warnings.push(m));
    const result = roundTrip(callout({ type: "file", file: { url: "https://s3.example/signed?expires=1" } })) as any[];
    setMarkdownWarnHandler(null);
    assert.equal(result[0].callout.icon.type, "emoji", "must not write back an expiring URL");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /cannot be written back/i);
  });
});

describe("empty spacer paragraphs (documented limitation)", () => {
  function para(text: string, children?: any[]) {
    const b: any = { id: "1", type: "paragraph", has_children: !!children, paragraph: { rich_text: text ? [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }] : [], color: "default" } };
    if (children) b._children = children;
    return b;
  }

  // Markdown cannot express a blank block, and Notion pages are full of them,
  // so spacers are dropped rather than marked up. This is a decision, not an
  // oversight — the test exists so changing it has to be deliberate.
  it("a spacer paragraph is dropped", () => {
    const result = roundTrip([para("one"), para(""), para(""), para("two")]) as any[];
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((b) => b.paragraph.rich_text[0].text.content), ["one", "two"]);
  });

  it("dropping spacers is stable, not cumulative", () => {
    const once = roundTrip([para("one"), para(""), para("two")]) as any[];
    const twice = roundTrip(once) as any[];
    assert.equal(twice.length, once.length);
  });

  it("an empty paragraph that carries children keeps them", () => {
    const result = roundTrip([para("", [para("child content")])]) as any[];
    const text = JSON.stringify(result);
    assert.match(text, /child content/, "content must never be lost, only spacing");
  });
});

describe("brackets in link and mention labels", () => {
  function rt(text: string) {
    return [{ type: "text", text: { content: text, link: null }, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
  }
  // `]` closes a link label. It was escaped on the way back but never on the
  // way out, so a label containing one ended its own link: the link was lost
  // and, for a mention, the raw id reappeared as visible text.
  const labels = ["O]Brien", "A [B]", "Q3] draft", "[bracketed]", "back\\slash"];

  for (const label of labels) {
    it(`a link labelled ${JSON.stringify(label)} keeps its URL and text`, () => {
      const blocks = [{ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ type: "text", text: { content: label, link: { url: "https://example.com" } }, plain_text: label, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }, href: "https://example.com" }], color: "default" } }];
      const run = (roundTrip(blocks) as any[])[0].paragraph.rich_text[0];
      assert.equal(run.type, "text");
      assert.deepEqual(run.text.link, { url: "https://example.com" });
      assert.equal(run.plain_text, label);
    });

    it(`a mention labelled ${JSON.stringify(label)} stays a mention`, () => {
      const id = "33dd872b-594c-816b-b58b-00025280b6c9";
      const blocks = [{ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ type: "mention", mention: { type: "user", user: { id } }, plain_text: label, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }, href: null }], color: "default" } }];
      const runs = (roundTrip(blocks) as any[])[0].paragraph.rich_text;
      assert.equal(runs.length, 1);
      assert.equal(runs[0].type, "mention", "must not fall apart into literal text");
      assert.equal(runs[0].mention.user.id, id);
      assert.doesNotMatch(JSON.stringify(runs[0].plain_text), /notion:\/\//, "the id must not leak into the text");
    });
  }

  it("plain bracketed prose still round-trips unchanged", () => {
    const result = roundTrip([{ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: rt("array[0] access"), color: "default" } }]) as any[];
    assert.equal(result[0].paragraph.rich_text.map((r: any) => r.plain_text).join(""), "array[0] access");
  });
});

describe("remote text cannot forge markup", () => {
  const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
  function para(runs: any[]) {
    return [{ id: "1", type: "paragraph", has_children: false, paragraph: { rich_text: runs, color: "default" } }];
  }

  it("a link_preview title cannot inject a link to somewhere else", () => {
    // The title comes from the remote page, so it is the least trusted string
    // in the document. Unescaped, it closed its own link and the rest became a
    // second, attacker-chosen link in the user's page.
    const hostile = "Ship it](https://evil.example/phish)";
    const result = roundTrip(para([
      { type: "mention", mention: { type: "link_preview", link_preview: { url: "https://real.example/x" } }, annotations: ann, plain_text: hostile, href: null },
    ])) as any[];
    const runs = result[0].paragraph.rich_text;
    const links = runs.map((r: any) => r.text?.link?.url).filter(Boolean);
    assert.ok(!links.includes("https://evil.example/phish"), "must not create a link to the injected URL");
  });

  it("a callout icon URL containing a space keeps the callout whole", () => {
    const blocks = [{ id: "1", type: "callout", has_children: false, callout: {
      rich_text: [{ type: "text", text: { content: "body", link: null }, plain_text: "body", annotations: ann }],
      icon: { type: "external", external: { url: "https://ex.com/my icon.png" } }, color: "default" } }];
    const result = roundTrip(blocks) as any[];
    assert.equal(result.length, 1, "the body must not be evicted into separate blocks");
    assert.equal(result[0].type, "callout");
    assert.equal(result[0].callout.rich_text[0].text.content, "body");
  });

  it("a newline in an icon value cannot splice lines into the callout", () => {
    const blocks = [{ id: "1", type: "callout", has_children: false, callout: {
      rich_text: [{ type: "text", text: { content: "body", link: null }, plain_text: "body", annotations: ann }],
      icon: { type: "external", external: { url: "https://x/ -->\n> injected line" } }, color: "default" } }];
    const result = roundTrip(blocks) as any[];
    // The value stays inside the icon field; what must not happen is it
    // becoming a line of the callout, or splitting the callout apart.
    assert.equal(result.length, 1, "must stay one block");
    assert.equal(result[0].type, "callout");
    assert.equal(result[0].callout.rich_text.map((r: any) => r.plain_text).join(""), "body");
  });

  it("a callout keeps its colour instead of taking the alert's", () => {
    const blocks = [{ id: "1", type: "callout", has_children: false, callout: {
      rich_text: [{ type: "text", text: { content: "body", link: null }, plain_text: "body", annotations: ann }],
      icon: { type: "emoji", emoji: "💡" }, color: "red_background" } }];
    assert.equal((roundTrip(blocks) as any[])[0].callout.color, "red_background");
  });

  it("a default-coloured callout does not turn blue", () => {
    const blocks = [{ id: "1", type: "callout", has_children: false, callout: {
      rich_text: [{ type: "text", text: { content: "body", link: null }, plain_text: "body", annotations: ann }],
      icon: { type: "emoji", emoji: "💡" }, color: "default" } }];
    assert.equal((roundTrip(blocks) as any[])[0].callout.color, "default");
  });

  it("a malformed id in a hand-written notion:// link stays a link", () => {
    // Built as a mention it became a body Notion rejects outright, failing the
    // whole page update rather than the one line.
    const runs = markdownToBlocks("[docs](notion://page/3-3dd872b594c816bb58b00025280b6c9)") as any[];
    assert.equal(runs[0].paragraph.rich_text[0].type, "text");
  });

  it("a dashless id is normalised rather than sent as-is", () => {
    const runs = markdownToBlocks("[docs](notion://page/33dd872b594c816bb58b00025280b6c9)") as any[];
    const run = runs[0].paragraph.rich_text[0];
    assert.equal(run.type, "mention");
    assert.equal(run.mention.page.id, "33dd872b-594c-816b-b58b-00025280b6c9");
  });

  it("a hand-edited icon that is not an emoji falls back with a warning", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((m) => warnings.push(m));
    const blocks = markdownToBlocks("> [!NOTE]\n<!-- icon: hello -->\n> body") as any[];
    setMarkdownWarnHandler(null);
    assert.equal(blocks[0].callout.icon.type, "emoji");
    assert.notEqual(blocks[0].callout.icon.emoji, "hello", "must not send a word to the API as an emoji");
    assert.equal(warnings.length, 1);
  });
});


describe("everything converges, not just the first cycle", () => {
  const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
  const rt = (t: string) => [{ type: "text", text: { content: t, link: null }, plain_text: t, annotations: ann }];
  const kid = (t: string) => ({ id: "k", type: "paragraph", has_children: false, paragraph: { rich_text: rt(t), color: "default" } });

  // A line break is the case that kept slipping through: it is legal in every
  // Notion rich_text field, and several renderers put it somewhere Markdown
  // cannot express.
  const specimens: Array<[string, any]> = [
    ["toggle with a line break in its title", { id: "1", type: "toggle", has_children: true, toggle: { rich_text: rt("Release\nnotes"), color: "default" }, _children: [kid("body")] }],
    ["list item with a line break", { id: "1", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("a\nb"), color: "default" } }],
    ["to-do with a line break", { id: "1", type: "to_do", has_children: false, to_do: { rich_text: rt("a\nb"), checked: false, color: "default" } }],
    ["heading with a line break", { id: "1", type: "heading_1", has_children: false, heading_1: { rich_text: rt("a\nb"), color: "default", is_toggleable: false } }],
    ["toggleable heading", { id: "1", type: "heading_2", has_children: true, heading_2: { rich_text: rt("Sec"), color: "default", is_toggleable: true }, _children: [kid("inside")] }],
    ["list item with a child paragraph", { id: "1", type: "bulleted_list_item", has_children: true, bulleted_list_item: { rich_text: rt("Item"), color: "default" }, _children: [kid("note")] }],
    ["callout with a child list", { id: "1", type: "callout", has_children: true, callout: { rich_text: rt("body"), icon: { type: "emoji", emoji: "💡" }, color: "default" }, _children: [{ id: "l", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("a"), color: "default" } }] }],
    ["quote with a child paragraph", { id: "1", type: "quote", has_children: true, quote: { rich_text: rt("quoted"), color: "default" }, _children: [kid("second")] }],
  ];

  for (const [name, block] of specimens) {
    it(`${name} is unchanged from cycle 1 to cycle 3`, () => {
      const one = shape(cycles([block], 1) as any[]);
      const two = shape(cycles([block], 2) as any[]);
      const three = shape(cycles([block], 3) as any[]);
      assert.equal(two, three, `${name} never settles`);
      assert.equal(one, two, `${name} changes on the second cycle`);
    });
  }

  it("a title with a line break keeps its text", () => {
    const out = cycles([specimens[0]![1]], 1) as any[];
    assert.match(shape(out), /Release notes/, "the title must survive, collapsed to one line");
  });

  it("a list item with a line break stays in the list", () => {
    const out = cycles([specimens[1]![1]], 1) as any[];
    assert.equal(out.length, 1, "must not spill a paragraph out of the list");
    assert.equal((out[0] as any).type, "bulleted_list_item");
  });
});

describe("remote titles cannot forge links from any block type", () => {
  const hostile = "X](https://evil.example)";
  const cases: Array<[string, any]> = [
    ["child_page", { id: "33dd872b-594c-816b-b58b-00025280b6c9", type: "child_page", has_children: false, child_page: { title: hostile } }],
    ["bookmark", { id: "1", type: "bookmark", has_children: false, bookmark: { url: "https://real.example", caption: [{ plain_text: hostile }] } }],
    ["image", { id: "1", type: "image", has_children: false, image: { type: "external", external: { url: "https://real.example/i.png" }, caption: [{ plain_text: hostile }] } }],
    ["embed", { id: "1", type: "embed", has_children: false, embed: { url: "https://real.example", caption: [{ plain_text: hostile }] } }],
  ];

  for (const [name, block] of cases) {
    it(`a ${name} title cannot link somewhere else`, () => {
      const md = blocksToMarkdown([block] as any);
      const out = markdownToBlocks(md) as any[];
      const links: string[] = [];
      const walk = (bs: any[]) => bs.forEach((b) => {
        (b[b.type]?.rich_text ?? []).forEach((r: any) => { if (r.text?.link?.url) links.push(r.text.link.url); });
        walk(b[b.type]?.children ?? []);
      });
      walk(out);
      assert.ok(!links.includes("https://evil.example"), `${name} forged a link`);
    });
  }
});

describe("constructs that used to swallow or destroy neighbouring blocks", () => {
  const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
  const rt = (t: string) => [{ type: "text", text: { content: t, link: null }, plain_text: t, annotations: ann }];
  const para = (t: string) => ({ id: "p", type: "paragraph", has_children: false, paragraph: { rich_text: rt(t), color: "default" } });

  for (const [name, expr] of [["multi-line", "a = b\nc = d"], ["empty", ""], ["containing a $$ line", "a\n$$\nb"]] as const) {
    it(`an equation ${name} does not swallow what follows it`, () => {
      // The closing $$ was glued to the last line, so the parser never found a
      // terminator and ran to end of file, absorbing every later block.
      const eq = { id: "e", type: "equation", has_children: false, equation: { expression: expr } };
      const out = roundTrip([eq, para("survivor")]) as any[];
      assert.equal(out.length, 2, `${name}: the following block must survive`);
      assert.equal(out[0].type, "equation");
      assert.equal(out[0].equation.expression, expr, "the expression must be exact");
      assert.equal(out[1].paragraph.rich_text[0].text.content, "survivor");
    });
  }

  it("prose mentioning </details> keeps its text and stays inside the toggle", () => {
    const toggle = {
      id: "t", type: "toggle", has_children: true,
      toggle: { rich_text: rt("HTML tips"), color: "default" },
      _children: [para("close it with </details> at the end")],
    };
    const out = roundTrip([toggle]) as any[];
    assert.equal(out.length, 1, "no stray block");
    assert.equal(out[0].toggle.children?.length, 1, "the child must survive");
    assert.match(JSON.stringify(out), /close it with/);
  });

  it("a toggle body mentioning <details> does not absorb the next block", () => {
    const toggle = {
      id: "t", type: "toggle", has_children: true,
      toggle: { rich_text: rt("T"), color: "default" },
      _children: [{ id: "c", type: "code", has_children: false, code: { rich_text: rt("<details>"), caption: [], language: "html" } }],
    };
    const out = roundTrip([toggle, para("after")]) as any[];
    assert.equal(out.length, 2, "the sibling must stay a sibling");
    assert.equal(out[1].type, "paragraph");
  });

  function table(cells: string[][]) {
    return {
      id: "t", type: "table", has_children: true,
      table: { table_width: cells[0]!.length, has_column_header: true, has_row_header: false },
      _children: cells.map((row, i) => ({ id: `r${i}`, type: "table_row", has_children: false, table_row: { cells: row.map(rt) } })),
    };
  }

  it("a backtick in a cell does not merge or delete columns", () => {
    const out = roundTrip([table([["the ` char", "backtick"], ["x", "y"]])]) as any[];
    assert.equal(out[0].type, "table");
    assert.equal(out[0].table.table_width, 2, "the column must not vanish");
    const rows = out[0].table.children.map((r: any) => r.table_row.cells.map((c: any[]) => c.map((x) => x.plain_text).join("")));
    assert.deepEqual(rows, [["the ` char", "backtick"], ["x", "y"]]);
  });

  it("a line break in a cell keeps the table a table", () => {
    const out = roundTrip([table([["line1\nline2", "c"]])]) as any[];
    assert.equal(out[0].type, "table", "must not degrade into paragraphs");
    assert.equal(out[0].table.table_width, 2);
  });

  it("a pipe in a cell still round-trips", () => {
    const out = roundTrip([table([["a | b", "c"]])]) as any[];
    const cells = out[0].table.children[0].table_row.cells.map((c: any[]) => c.map((x) => x.plain_text).join(""));
    assert.deepEqual(cells, ["a | b", "c"]);
  });
});
