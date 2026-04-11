import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks, setMarkdownWarnHandler } from "../../src/markdown/write.js";

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

  it("maps language aliases to Notion-accepted names", () => {
    assert.equal((markdownToBlocks("```sh\nls\n```")[0] as any).code.language, "shell");
    assert.equal((markdownToBlocks("```js\n1\n```")[0] as any).code.language, "javascript");
    assert.equal((markdownToBlocks("```ts\n1\n```")[0] as any).code.language, "typescript");
    assert.equal((markdownToBlocks("```py\n1\n```")[0] as any).code.language, "python");
    assert.equal((markdownToBlocks("```yml\n1\n```")[0] as any).code.language, "yaml");
    assert.equal((markdownToBlocks("```rs\n1\n```")[0] as any).code.language, "rust");
    assert.equal((markdownToBlocks("```dockerfile\n1\n```")[0] as any).code.language, "docker");
  });

  it("divider", () => {
    const blocks = markdownToBlocks("---");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "divider");
  });

  it("divider variants: *** and ___", () => {
    assert.equal(markdownToBlocks("***")[0]!.type, "divider");
    assert.equal(markdownToBlocks("___")[0]!.type, "divider");
    assert.equal(markdownToBlocks("****")[0]!.type, "divider");
  });

  it("4-backtick fence contains 3-backtick content", () => {
    const md = "````\nSome ``` backticks ``` inside\n````";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "code");
    assert.ok((blocks[0] as any).code.rich_text[0].text.content.includes("```"));
  });

  it("multi-line blockquote becomes single quote block", () => {
    const md = "> Line one\n> Line two\n> Line three";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const text = (blocks[0] as any).quote.rich_text[0].text.content;
    assert.ok(text.includes("Line one"), "first line present");
    assert.ok(text.includes("Line three"), "last line present");
  });

  it("nested blockquote flattens > > to single level", () => {
    const md = "> Level 1\n> > Level 2\n> Back to level 1";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const text = (blocks[0] as any).quote.rich_text[0].text.content;
    assert.ok(text.includes("Level 1"), "level 1 present");
    assert.ok(text.includes("Level 2"), "level 2 present");
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

  it("GFM table with escaped pipes in cells", () => {
    const md = "| Flag | Desc |\n| --- | --- |\n| `--format md\\|json\\|csv` | Output format |";
    const blocks = markdownToBlocks(md);
    const table = blocks[0] as any;
    assert.equal(table.table.table_width, 2);
    assert.equal(table.table.children.length, 2); // header + 1 row
    // The escaped pipes should be inside a single cell, not split into extra columns
    const dataRow = table.table.children[1];
    assert.equal(dataRow.table_row.cells.length, 2);
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

  it("three-level nesting caps at Notion API limit (2 levels of children)", () => {
    const md = "- A\n  - B\n    - C";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    // B and C are both children of A (C promoted from B's child to A's child)
    const children = (blocks[0] as any).bulleted_list_item.children;
    assert.equal(children.length, 2, "B and C both at second level");
    assert.equal(children[0].type, "bulleted_list_item");
    assert.equal(children[1].type, "bulleted_list_item");
    // Neither has further children
    assert.equal(children[0].bulleted_list_item.children, undefined);
    assert.equal(children[1].bulleted_list_item.children, undefined);
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

  it("four-level nesting promotes deeper items (Notion API limit)", () => {
    const md = "- A\n  - B\n    - C\n      - D";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "one root block A");
    const aChildren = (blocks[0] as any).bulleted_list_item.children;
    // B, C, D all promoted to children of A (only 2 nesting levels allowed)
    assert.equal(aChildren.length, 3, "B, C, D all at second level");
    // None should have children
    for (const child of aChildren) {
      assert.equal(child.bulleted_list_item.children, undefined, "no third-level children");
    }
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

describe("markdownToBlocks — paragraph/block boundary edge cases", () => {
  it("table immediately after paragraph (no blank line) is parsed as separate blocks", () => {
    const md = "Some text\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2, "paragraph and table must be separate");
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "table");
  });

  it("equation after paragraph (no blank line) is parsed as separate blocks", () => {
    const md = "Some text\n$$E = mc^2$$";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2, "paragraph and equation must be separate");
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "equation");
  });

  it("divider after paragraph (no blank line) is parsed separately", () => {
    const md = "Some text\n---";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2, "paragraph and divider must be separate");
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "divider");
  });

  it("HTML toggle after paragraph (no blank line) is parsed separately", () => {
    const md = "Some text\n<details><summary>Toggle</summary>\n\n</details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "toggle");
  });

  it("pass-through comment after paragraph is parsed separately", () => {
    const md = "Some text\n<!-- notion-block: synced_block id=abc-123 -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "synced_block");
  });
});

describe("markdownToBlocks — multi-line equation", () => {
  it("multi-line equation block ($$ on separate lines)", () => {
    const md = "$$\nE = mc^2\n$$";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "equation");
    assert.equal((blocks[0] as any).equation.expression, "E = mc^2");
  });

  it("multi-line equation with multiple lines", () => {
    const md = "$$\n\\sum_{i=1}^{n} x_i\n= x_1 + x_2 + \\ldots + x_n\n$$";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "equation");
    const expr = (blocks[0] as any).equation.expression;
    assert.ok(expr.includes("\\sum"), "expression must include sum");
    assert.ok(expr.includes("\\ldots"), "expression must include ldots");
  });

  it("single-line equation still works", () => {
    const md = "$$x^2 + y^2 = z^2$$";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "equation");
    assert.equal((blocks[0] as any).equation.expression, "x^2 + y^2 = z^2");
  });
});

describe("image parsing", () => {
  it("parses ![alt](url) as image block", () => {
    const blocks = markdownToBlocks("![Screenshot](https://example.com/img.png)");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
    const img = (blocks[0] as any).image;
    assert.equal(img.external.url, "https://example.com/img.png");
    assert.equal(img.caption[0].plain_text, "Screenshot");
  });

  it("handles image with empty alt text", () => {
    const blocks = markdownToBlocks("![](https://example.com/img.png)");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
    assert.deepEqual((blocks[0] as any).image.caption, []);
  });

  it("image on its own line does not absorb into paragraph", () => {
    const blocks = markdownToBlocks("Before text.\n\n![img](https://example.com/img.png)\n\nAfter text.");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "image");
    assert.equal(blocks[2]!.type, "paragraph");
  });
});

describe("markdownToBlocks — special characters and Unicode", () => {
  it("emoji in headings", () => {
    const blocks = markdownToBlocks("# 🚀 Launch Notes");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "heading_1");
    const text = (blocks[0] as any).heading_1.rich_text[0].text.content;
    assert.ok(text.includes("🚀"));
  });

  it("CJK characters in list items", () => {
    const blocks = markdownToBlocks("- 日本語テスト\n- 中文测试\n- 한국어 테스트");
    assert.equal(blocks.length, 3);
    blocks.forEach(b => assert.equal(b.type, "bulleted_list_item"));
  });

  it("code block with special characters preserves content exactly", () => {
    const md = "```\n<script>alert('xss');</script>\n```";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    const content = (blocks[0] as any).code.rich_text[0].text.content;
    assert.equal(content, "<script>alert('xss');</script>");
  });

  it("table with empty cells", () => {
    const md = "| A | B | C |\n| --- | --- | --- |\n| 1 | | 3 |";
    const blocks = markdownToBlocks(md);
    const table = blocks[0] as any;
    const dataRow = table.table.children[1];
    assert.equal(dataRow.table_row.cells.length, 3);
    // Middle cell is empty — markdownToRichText("") returns []
    assert.equal(dataRow.table_row.cells[1].length, 0);
  });
});

describe("toggle (details) parsing", () => {
  it("captures body content as toggle children", () => {
    const md = "<details><summary>Title</summary>\n\nBody paragraph.\n\n- Item 1\n\n</details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
    const toggle = (blocks[0] as any).toggle;
    assert.equal(toggle.rich_text[0].plain_text, "Title");
    assert.equal(blocks[0]!.has_children, true);
    assert.ok(toggle.children && toggle.children.length >= 1, "toggle should have children");
  });

  it("handles multi-line details with summary on separate line", () => {
    const md = "<details>\n<summary>Multi-line Title</summary>\nBody here.\n</details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    const toggle = (blocks[0] as any).toggle;
    assert.equal(toggle.rich_text[0].plain_text, "Multi-line Title");
  });

  it("handles inline details without eating next block", () => {
    const md = "<details><summary>First</summary></details>\n\n<details><summary>Second</summary></details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal((blocks[0] as any).toggle.rich_text[0].plain_text, "First");
    assert.equal((blocks[1] as any).toggle.rich_text[0].plain_text, "Second");
  });

  it("creates empty toggle when no body content", () => {
    const md = "<details><summary>Empty</summary>\n</details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.has_children, false);
  });
});

describe("blockquote parsing", () => {
  it("preserves multi-paragraph blockquotes with newline separation", () => {
    const md = "> First paragraph.\n>\n> Second paragraph.\n>\n> Third paragraph.";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const text = (blocks[0] as any).quote.rich_text.map((r: any) => r.plain_text).join("");
    assert.ok(text.includes("First paragraph."), "first paragraph present");
    assert.ok(text.includes("Second paragraph."), "second paragraph present");
    assert.ok(!text.includes("  "), "no double spaces from collapsed blank lines");
  });

  it("multi-paragraph blockquote preserves paragraph breaks", () => {
    const md = "> First paragraph.\n>\n> Second paragraph.\n>\n> Third paragraph.";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const text = (blocks[0] as any).quote.rich_text.map((r: any) => r.plain_text).join("");
    assert.ok(text.includes("First paragraph."), "first paragraph present");
    assert.ok(text.includes("Second paragraph."), "second paragraph present");
    assert.ok(text.includes("Third paragraph."), "third paragraph present");
    assert.ok(text.includes("\n\n"), "paragraph breaks preserved");
  });

  it("blockquote without space after > is recognized", () => {
    const blocks = markdownToBlocks(">This is a quote\n>Second line");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const text = (blocks[0] as any).quote.rich_text[0].text.content;
    assert.ok(text.includes("This is a quote"), "text preserved");
    assert.ok(text.includes("Second line"), "second line preserved");
  });

  it("bare > starts empty quote", () => {
    const blocks = markdownToBlocks(">\n");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
  });
});

describe("markdownToBlocks — inline details body preservation (BUG-2 regression)", () => {
  it("inline details with body creates toggle with children", () => {
    const md = "<details><summary>Title</summary>Body content here</details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
    assert.equal((blocks[0] as any).has_children, true);
    const children = (blocks[0] as any).toggle.children;
    assert.ok(children && children.length > 0, "must have children");
    assert.equal(children[0].type, "paragraph");
    const text = children[0].paragraph.rich_text[0].plain_text;
    assert.equal(text, "Body content here");
  });

  it("inline details without body creates empty toggle", () => {
    const md = "<details><summary>Title</summary></details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
    assert.equal((blocks[0] as any).has_children, false);
  });

  it("inline details does not consume next block", () => {
    const md = "<details><summary>Toggle</summary>Body</details>\n\nNext paragraph.";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "toggle");
    assert.equal(blocks[1]!.type, "paragraph");
  });
});

describe("markdownToBlocks — table column normalization (BUG-4 regression)", () => {
  it("extra cells in data row are truncated to header width", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 | 3 | 4 |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "table");
    const rows = (blocks[0] as any).table.children;
    assert.equal(rows.length, 2); // header + 1 data row
    assert.equal(rows[1].table_row.cells.length, 2, "extra cells must be truncated");
  });

  it("missing cells in data row are padded with empty", () => {
    const md = "| A | B | C |\n| --- | --- | --- |\n| only one |";
    const blocks = markdownToBlocks(md);
    const rows = (blocks[0] as any).table.children;
    assert.equal(rows[1].table_row.cells.length, 3, "must pad to header width");
  });

  it("uniform table is unchanged", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
    const blocks = markdownToBlocks(md);
    const rows = (blocks[0] as any).table.children;
    assert.equal(rows.length, 3);
    rows.forEach((r: any) => assert.equal(r.table_row.cells.length, 2));
  });
});

describe("markdownToBlocks — callout child blocks (BUG-5/6 regression)", () => {
  it("callout with list items creates children", () => {
    const md = "> [!NOTE]\n> Intro text\n> - Item one\n> - Item two";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).has_children, true);
    const children = (blocks[0] as any).callout.children;
    assert.ok(children && children.length >= 1, "must have children for list items");
    const listChildren = children.filter((c: any) => c.type === "bulleted_list_item");
    assert.equal(listChildren.length, 2, "two list items as children");
  });

  it("callout blank continuation line does not terminate early", () => {
    const md = "> [!WARNING]\n> First part\n>\n> Second part";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "should be one callout, not split");
    assert.equal(blocks[0]!.type, "callout");
    // Both parts should be represented
    const callout = (blocks[0] as any).callout;
    const mainText = callout.rich_text.map((r: any) => r.plain_text).join("");
    const childTexts = (callout.children ?? []).map(
      (c: any) => (c.paragraph?.rich_text ?? []).map((r: any) => r.plain_text).join("")
    ).join(" ");
    const allText = mainText + " " + childTexts;
    assert.ok(allText.includes("First part"), "first part preserved");
    assert.ok(allText.includes("Second part"), "second part preserved");
  });

  it("simple single-line callout still works", () => {
    const md = "> [!TIP]\n> Just a simple tip";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "callout");
    const text = (blocks[0] as any).callout.rich_text.map((r: any) => r.plain_text).join("");
    assert.equal(text, "Just a simple tip");
  });
});

describe("markdownToBlocks — code language validation (BH2-1)", () => {
  it("unknown language falls back to plain text", () => {
    const blocks = markdownToBlocks("```unknownlang\ncode\n```");
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as any).code.language, "plain text");
  });

  it("known language is preserved", () => {
    assert.equal((markdownToBlocks("```python\n1\n```")[0] as any).code.language, "python");
    assert.equal((markdownToBlocks("```rust\n1\n```")[0] as any).code.language, "rust");
    assert.equal((markdownToBlocks("```go\n1\n```")[0] as any).code.language, "go");
  });
});

describe("markdownToBlocks — nested details toggles (BH2-2)", () => {
  it("nested details blocks are preserved", () => {
    const md = "<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>\nInner content\n</details>\n\nAfter inner\n\n</details>";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "single outer toggle");
    assert.equal(blocks[0]!.type, "toggle");
    const toggle = (blocks[0] as any).toggle;
    assert.equal(toggle.rich_text[0].plain_text, "Outer");
    assert.ok(toggle.children && toggle.children.length >= 2, "must have inner toggle + paragraph");
    const innerToggle = toggle.children.find((c: any) => c.type === "toggle");
    assert.ok(innerToggle, "inner toggle must exist");
    assert.equal(innerToggle.toggle.rich_text[0].plain_text, "Inner");
    const afterParagraph = toggle.children.find((c: any) => c.type === "paragraph" && c.paragraph.rich_text[0]?.plain_text === "After inner");
    assert.ok(afterParagraph, "paragraph after inner toggle must be inside outer toggle");
  });
});

describe("markdownToBlocks — callout sidecar color and icon (BH2-4)", () => {
  it("callout preserves sidecar color and icon on round-trip", () => {
    const md = "> [!NOTE]\n<!-- color: orange_background -->\n<!-- icon: 🎨 -->\n> Custom callout";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.color, "orange_background");
    assert.equal((blocks[0] as any).callout.icon.emoji, "🎨");
  });

  it("callout without sidecar uses default color and icon", () => {
    const md = "> [!WARNING]\n> Warning text";
    const blocks = markdownToBlocks(md);
    assert.equal((blocks[0] as any).callout.color, "yellow_background");
    assert.equal((blocks[0] as any).callout.icon.emoji, "⚠️");
  });
});

describe("markdownToBlocks — H4/H5/H6 headings downgraded to H3 (BH2-5)", () => {
  it("H4 is downgraded to H3", () => {
    const blocks = markdownToBlocks("#### H4 heading");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "heading_3");
    assert.equal((blocks[0] as any).heading_3.rich_text[0].text.content, "H4 heading");
  });

  it("H5 and H6 are also downgraded to H3", () => {
    const blocks = markdownToBlocks("##### H5\n\n###### H6");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "heading_3");
    assert.equal(blocks[1]!.type, "heading_3");
  });
});

describe("bug hunt round 4 regressions — write", () => {
  afterEach(() => setMarkdownWarnHandler(null));

  it("emits a warning via the registered handler when lists are flattened", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((msg) => warnings.push(msg));
    const md = "- a\n  - b\n    - c\n      - d\n        - e";
    markdownToBlocks(md);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /list item/i);
    assert.match(warnings[0]!, /2 levels/i);
  });

  it("does not warn when list nesting stays within 2 levels", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((msg) => warnings.push(msg));
    markdownToBlocks("- a\n  - b\n- c");
    assert.equal(warnings.length, 0);
  });

  it("image URL containing parens still parses as image block", () => {
    const md = "![wiki](https://en.wikipedia.org/wiki/Foo_(bar).png)";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
    const img = (blocks[0] as any).image;
    assert.equal(img.type, "external");
    assert.equal(img.external.url, "https://en.wikipedia.org/wiki/Foo_(bar).png");
    assert.equal(img.caption[0]?.text?.content, "wiki");
  });

  it("image with empty alt and parens URL still parses", () => {
    const md = "![](https://example.com/a(b)c.jpg)";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
    assert.equal((blocks[0] as any).image.external.url, "https://example.com/a(b)c.jpg");
  });
});

