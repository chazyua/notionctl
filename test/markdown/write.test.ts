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

  it("standalone sidecar comment for non-markdown-expressible type is dropped", () => {
    // synced_block, column_list, embed, etc. cannot be expressed in markdown.
    // The read path emits a sidecar comment with the original block id as a
    // round-trip breadcrumb. Creating a stub block here would fail Notion's
    // API (the block has a type but no body data), so the write path drops
    // it instead and the page sync / update skips it.
    const blocks = markdownToBlocks("<!-- notion-block: synced_block id=abc-123 -->");
    assert.equal(blocks.length, 0);
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

  it("three-level nesting is preserved (Notion allows it)", () => {
    const md = "- A\n  - B\n    - C";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    const bs = (blocks[0] as any).bulleted_list_item.children;
    assert.equal(bs.length, 1, "only B at second level");
    const cs = bs[0].bulleted_list_item.children;
    assert.equal(cs.length, 1, "C stays nested under B");
    assert.equal(cs[0].bulleted_list_item.children, undefined);
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

  it("four-level nesting promotes the deepest item (Notion API limit)", () => {
    const md = "- A\n  - B\n    - C\n      - D";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "one root block A");
    const aChildren = (blocks[0] as any).bulleted_list_item.children;
    assert.equal(aChildren.length, 1, "only B at second level");
    const bChildren = aChildren[0].bulleted_list_item.children;
    // D is promoted to sit beside C — a third-level block may not have children
    assert.equal(bChildren.length, 2, "C and D both at third level");
    for (const child of bChildren) {
      assert.equal(child.bulleted_list_item.children, undefined, "no fourth-level children");
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

  it("divider on the line after prose is a setext heading, not a divider", () => {
    const md = "Some text\n---";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "prose plus its underline is one heading");
    assert.equal(blocks[0]!.type, "heading_2");
    assert.equal((blocks[0] as any).heading_2.rich_text[0].text.content, "Some text");
  });

  it("divider separated from prose by a blank line stays a divider", () => {
    const blocks = markdownToBlocks("Some text\n\n---");
    assert.equal(blocks.length, 2);
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

  it("standalone sidecar comment after paragraph is dropped, paragraph kept", () => {
    const md = "Some text\n<!-- notion-block: synced_block id=abc-123 -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "paragraph");
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

  it("image with parens in URL query still parses", () => {
    const blocks = markdownToBlocks("![alt](https://example.com/img.png?size=(large))");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
    assert.equal((blocks[0] as any).image.external.url, "https://example.com/img.png?size=(large)");
  });

  it("image with optional title text strips the title from URL", () => {
    const blocks = markdownToBlocks('![alt](https://example.com/pic.jpg "some title")');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
    assert.equal((blocks[0] as any).image.external.url, "https://example.com/pic.jpg");
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

describe("markdownToBlocks — inline details body preservation", () => {
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

describe("markdownToBlocks — table column normalization", () => {
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

describe("markdownToBlocks — callout child blocks", () => {
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

describe("markdownToBlocks — code language validation", () => {
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

describe("markdownToBlocks — nested details toggles", () => {
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

describe("markdownToBlocks — callout sidecar color and icon", () => {
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

describe("markdownToBlocks — H4/H5/H6 headings downgraded to H3", () => {
  it("writes a stderr warning on downgrade", () => {
    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (chunk: any) => { captured.push(String(chunk)); return true; };
    try {
      markdownToBlocks("#### H4 heading\n\n##### H5\n\n###### H6");
    } finally {
      process.stderr.write = origWrite;
    }
    assert.ok(captured.some(c => /H[1-3]/.test(c) && /H4|H5|H6|heading/i.test(c)), "warning emitted on stderr");
  });

  it("does not re-warn within a single call for multiple downgrades", () => {
    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (chunk: any) => { captured.push(String(chunk)); return true; };
    try {
      markdownToBlocks("#### a\n\n#### b\n\n##### c");
    } finally {
      process.stderr.write = origWrite;
    }
    const warnings = captured.filter(c => /H[1-3]/.test(c));
    assert.equal(warnings.length, 1, "single consolidated warning");
  });

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

describe("markdown write edge cases", () => {
  afterEach(() => setMarkdownWarnHandler(null));

  it("emits one warning via the registered handler when lists are flattened", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((msg) => warnings.push(msg));
    const md = "- a\n  - b\n    - c\n      - d\n        - e";
    markdownToBlocks(md);
    assert.equal(warnings.length, 1, "one warning however many levels were flattened");
    assert.match(warnings[0]!, /2 levels/i);
  });

  it("does not warn when nesting stays within the limit", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((msg) => warnings.push(msg));
    markdownToBlocks("- a\n  - b\n    - c");
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

describe("markdown write — list and heading fixes", () => {
  it("empty todo - [ ] is parsed as an unchecked to_do, not a bulleted list", () => {
    const blocks = markdownToBlocks("- [ ]");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "to_do");
    const td = (blocks[0] as any).to_do;
    assert.equal(td.checked, false);
    assert.equal(td.rich_text.length, 0);
  });

  it("empty todo - [x] is parsed as a checked to_do", () => {
    const blocks = markdownToBlocks("- [x]");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "to_do");
    const td = (blocks[0] as any).to_do;
    assert.equal(td.checked, true);
    assert.equal(td.rich_text.length, 0);
  });

  it("blockquote containing a list creates structured children", () => {
    const md = "> Quote intro\n> - item 1\n> - item 2\n> outro";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const q = (blocks[0] as any).quote;
    // First paragraph stays in rich_text…
    assert.ok(
      q.rich_text.some((r: any) => (r.text?.content ?? r.plain_text ?? "").includes("Quote intro")),
      "leading paragraph in rich_text",
    );
    // …and the rest become children, including the bullets.
    assert.ok(Array.isArray(q.children) && q.children.length > 0, "structured children present");
    const types = q.children.map((c: any) => c.type);
    assert.ok(types.includes("bulleted_list_item"), "bullet survives as a child block");
  });

  it("plain multi-paragraph blockquote still flattens to a single rich_text run", () => {
    const md = "> First paragraph.\n>\n> Second paragraph.";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
    const q = (blocks[0] as any).quote;
    const text = q.rich_text.map((r: any) => r.plain_text ?? r.text?.content ?? "").join("");
    assert.ok(text.includes("First paragraph."));
    assert.ok(text.includes("Second paragraph."));
    assert.ok(text.includes("\n\n"), "paragraph break preserved");
    assert.ok(!q.children, "no structured children for paragraph-only quote");
  });

  it("multi-paragraph blockquote preserves bold/italic/link annotations", () => {
    // Regression: the allParagraphs branch used to flatten each paragraph's
    // rich_text runs to their plain content and re-parse the joined string,
    // which silently stripped bold/italic/link annotations on round-trip.
    const md = "> first **bold** para\n>\n> second _italic_ para with [link](https://example.com)";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    const runs = (blocks[0] as any).quote.rich_text;
    assert.ok(runs.some((r: any) => r.annotations?.bold === true), "bold preserved");
    assert.ok(runs.some((r: any) => r.annotations?.italic === true), "italic preserved");
    assert.ok(runs.some((r: any) => r.text?.link?.url === "https://example.com"), "link preserved");
  });
});

describe("round-trip sidecar comment absorption", () => {
  it("image line followed by video sidecar becomes a video block", () => {
    const md = "![caption](https://example.com/v.mp4)\n<!-- notion-block: video id=vid-abc-1234 -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1, "single block emitted, sidecar absorbed");
    assert.equal(blocks[0]!.type, "video");
    const url = (blocks[0] as any).video.external.url;
    assert.equal(url, "https://example.com/v.mp4");
  });

  it("image line followed by file sidecar becomes a file block", () => {
    const md = "![report.pdf](https://example.com/r.pdf)\n<!-- notion-block: file id=file-abc-1234 -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "file");
  });

  it("image line followed by pdf sidecar becomes a pdf block", () => {
    const md = "![](https://example.com/doc.pdf)\n<!-- notion-block: pdf id=pdf-abc-1234 -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "pdf");
  });

  it("bare link line followed by bookmark sidecar becomes a bookmark block", () => {
    const md = "[Example](https://example.com)\n<!-- notion-block: bookmark id=bm-abc-1234 -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "bookmark");
    assert.equal((blocks[0] as any).bookmark.url, "https://example.com");
  });

  it("bare link line followed by link_preview sidecar becomes link_preview block", () => {
    const md = "[https://github.com/owner/repo](https://github.com/owner/repo)\n<!-- notion-block: link_preview id=lp-abc -->";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "link_preview");
  });

  it("image line without sidecar stays as image block", () => {
    const blocks = markdownToBlocks("![caption](https://example.com/pic.png)");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "image");
  });
});

describe("markdownToBlocks — CRLF normalization", () => {
  it("CRLF line endings do not leave carriage returns in paragraph text", () => {
    const md = "line one\r\nline two\r\n\r\nanother para";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    const text = (blocks[0] as any).paragraph.rich_text
      .map((r: any) => r.text?.content ?? "")
      .join("");
    assert.ok(!text.includes("\r"), "no stray \\r in rich_text content");
  });
});

describe("markdownToBlocks — empty-body list items", () => {
  it("whitespace-only bullet does not infinite-loop", () => {
    // Regression: `isListLine` matched on trailing whitespace after the
    // bullet char but `classifyListLine` rejected the line after trim, so
    // the main loop kept re-entering parseListSection at the same index.
    // A 5-second hard timer via test runner would catch the hang, but
    // just finishing at all is enough for this regression.
    const blocks = markdownToBlocks("- \n- real");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "bulleted_list_item");
    assert.equal(blocks[1]!.type, "bulleted_list_item");
  });

  it("single whitespace-only bullet parses as one empty item", () => {
    const blocks = markdownToBlocks("- ");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "bulleted_list_item");
  });

  it("whitespace-only numbered item does not infinite-loop", () => {
    const blocks = markdownToBlocks("1. \n2. real");
    assert.equal(blocks.length, 2);
    blocks.forEach((b) => assert.equal(b.type, "numbered_list_item"));
  });
});

describe("notion-table has_column_header=false round-trip", () => {
  it("consumes the sidecar comment and sets has_column_header to false", () => {
    const md = [
      "<!-- notion-table: has_column_header=false -->",
      "|   |   |",
      "| --- | --- |",
      "| A1 | B1 |",
      "| A2 | B2 |",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    const table = blocks[0] as unknown as { type: string; table: { has_column_header: boolean; children: unknown[] } };
    assert.equal(table.type, "table");
    assert.equal(table.table.has_column_header, false);
    // The synthetic empty header row should be skipped — only data rows remain
    assert.equal(table.table.children.length, 2);
  });

  it("table without the sidecar comment still gets has_column_header=true", () => {
    const md = [
      "| Col A | Col B |",
      "| --- | --- |",
      "| A1 | B1 |",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    const table = blocks[0] as unknown as { table: { has_column_header: boolean; children: unknown[] } };
    assert.equal(table.table.has_column_header, true);
    assert.equal(table.table.children.length, 2); // header + 1 data row
  });
});

describe("code block closing fence respects CommonMark indentation", () => {
  it("indented backticks (4+ spaces) inside a code block are treated as content, not a closing fence", () => {
    const md = [
      "```",
      "some code",
      "    ```",
      "more code",
      "```",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "code");
    const code = (blocks[0] as unknown as { code: { rich_text: Array<{ text: { content: string } }> } }).code;
    const content = code.rich_text[0]!.text.content;
    assert.ok(content.includes("    ```"), "indented backticks should be preserved as content");
    assert.ok(content.includes("more code"), "content after indented backticks should be included");
  });

  it("closing fence with 0-3 spaces of indentation still closes the block", () => {
    const md = [
      "```",
      "some code",
      "   ```",
      "after block",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "code");
    assert.equal(blocks[1]!.type, "paragraph");
  });
});

describe("embed sidecar round-trips back to embed block", () => {
  it("link with embed sidecar becomes embed block", () => {
    const md = [
      "[https://www.youtube.com/watch?v=test123](https://www.youtube.com/watch?v=test123)",
      "<!-- notion-block: embed id=embed-id -->",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "embed");
    const embed = (blocks[0] as any).embed;
    assert.equal(embed.url, "https://www.youtube.com/watch?v=test123");
  });

  it("link with bookmark sidecar still becomes bookmark block", () => {
    const md = [
      "[Example](https://example.com)",
      "<!-- notion-block: bookmark id=bm-id -->",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "bookmark");
  });
});

describe("markdownToBlocks does NOT strip YAML frontmatter", () => {
  // markdownToBlocks is a pure markdown-to-blocks converter. Frontmatter
  // stripping is the caller's responsibility (extractFrontmatter). This test
  // confirms that block append must strip frontmatter before calling
  // markdownToBlocks, otherwise YAML fences become divider/paragraph blocks.
  it("frontmatter produces divider and paragraph blocks if not stripped", () => {
    const md = "---\ntitle: test\n---\n\nReal content";
    const blocks = markdownToBlocks(md);
    assert.ok(blocks.length > 1, "frontmatter should produce multiple blocks");
    const types = blocks.map((b) => b.type);
    assert.ok(types.includes("divider"), "--- should become a divider block");
    assert.ok(types.includes("paragraph"), "body should become a paragraph");
  });

  it("pre-stripped frontmatter produces only content blocks", async () => {
    // Simulates what block append now does after the fix
    const { extractFrontmatter } = await import("../../src/sync/frontmatter.js");
    const md = "---\ntitle: test\n---\n\nReal content";
    const { body } = extractFrontmatter(md);
    const blocks = markdownToBlocks(body);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "paragraph");
    const text = (blocks[0] as any).paragraph.rich_text[0]?.text?.content;
    assert.equal(text, "Real content");
  });
});


describe("setext headings", () => {
  it("prose underlined with === becomes an H1", () => {
    const blocks = markdownToBlocks("Title\n===");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "heading_1");
    assert.equal((blocks[0] as any).heading_1.rich_text[0].text.content, "Title");
  });

  it("prose underlined with --- becomes an H2", () => {
    const blocks = markdownToBlocks("Title\n---");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "heading_2");
    assert.equal((blocks[0] as any).heading_2.rich_text[0].text.content, "Title");
  });

  it("a single = or - underline still counts", () => {
    assert.equal(markdownToBlocks("Title\n=")[0]!.type, "heading_1");
    assert.equal(markdownToBlocks("Title\n-")[0]!.type, "heading_2");
  });

  it("the underline never leaks into the text", () => {
    const blocks = markdownToBlocks("Title\n====");
    const runs = (blocks[0] as any).heading_1.rich_text as any[];
    assert.equal(runs.map((r) => r.plain_text).join(""), "Title");
  });

  it("*** after prose is still a divider, not a heading", () => {
    const blocks = markdownToBlocks("Some text\n***");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "divider");
  });

  it("=== with no prose above it stays a paragraph", () => {
    const blocks = markdownToBlocks("===");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "paragraph");
  });

  it("heading text keeps inline formatting", () => {
    const blocks = markdownToBlocks("**Bold** title\n===");
    const runs = (blocks[0] as any).heading_1.rich_text as any[];
    assert.equal(runs[0].annotations.bold, true);
  });
});

describe("multi-paragraph list items", () => {
  it("indented continuation stays a child of its list item", () => {
    const blocks = markdownToBlocks("- Item\n\n  continuation");
    assert.equal(blocks.length, 1, "continuation must not become a top-level sibling");
    assert.equal(blocks[0]!.type, "bulleted_list_item");
    const children = (blocks[0] as any).bulleted_list_item.children;
    assert.equal(children.length, 1);
    assert.equal(children[0].type, "paragraph");
    assert.equal(children[0].paragraph.rich_text[0].text.content, "continuation");
  });

  it("continuation indentation does not leak into the text", () => {
    const blocks = markdownToBlocks("1. Item\n\n   continuation");
    const children = (blocks[0] as any).numbered_list_item.children;
    assert.equal(children[0].paragraph.rich_text[0].text.content, "continuation");
  });

  it("a to-do item carries its continuation too", () => {
    const blocks = markdownToBlocks("- [x] Done\n\n      why it is done");
    assert.equal(blocks.length, 1);
    const children = (blocks[0] as any).to_do.children;
    assert.equal(children[0].paragraph.rich_text[0].text.content, "why it is done");
  });

  it("continuation stops at the next list item", () => {
    const blocks = markdownToBlocks("- One\n\n  more about one\n\n- Two");
    assert.equal(blocks.length, 2);
    assert.equal((blocks[0] as any).bulleted_list_item.children.length, 1);
    assert.equal((blocks[1] as any).bulleted_list_item.children, undefined);
  });

  it("continuation stops at unindented prose", () => {
    const blocks = markdownToBlocks("- One\n\n  mine\n\nnot mine");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1]!.type, "paragraph");
    assert.equal((blocks[1] as any).paragraph.rich_text[0].text.content, "not mine");
  });

  it("a code fence whose body is unindented still closes correctly", () => {
    const blocks = markdownToBlocks("- Item\n\n  ```\nunindented\n  ```\n\nafter");
    assert.equal(blocks.length, 2, "the fence must not swallow the trailing paragraph");
    const children = (blocks[0] as any).bulleted_list_item.children;
    assert.equal(children[0].type, "code");
    assert.equal(children[0].code.rich_text[0].text.content, "unindented");
    assert.equal(blocks[1]!.type, "paragraph");
  });

  it("multiple continuation blocks all attach to the item", () => {
    const blocks = markdownToBlocks("- Item\n\n  first\n\n  second");
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as any).bulleted_list_item.children.length, 2);
  });
});

/** Deepest block depth in the tree, counting the top-level array as depth 0. */
function maxDepth(blocks: any[], depth = 0): number {
  let deepest = depth;
  for (const b of blocks) {
    const kids = b[b.type]?.children ?? b.children;
    if (Array.isArray(kids) && kids.length > 0) {
      deepest = Math.max(deepest, maxDepth(kids, depth + 1));
    }
  }
  return deepest;
}

describe("nesting depth is capped across mixed block types", () => {
  const cases: Array<[string, string]> = [
    ["toggles", "<details><summary>L1</summary>\n\n<details><summary>L2</summary>\n\n<details><summary>L3</summary>\n\nleaf\n\n</details>\n\n</details>\n\n</details>"],
    ["toggle > quote > quote", "<details><summary>L1</summary>\n\n> outer\n>\n> > inner\n> >\n> > > deepest\n\n</details>"],
    ["toggle > callout", "<details><summary>L1</summary>\n\n> [!NOTE]\n> body\n>\n> - a\n>   - b\n>     - c\n\n</details>"],
    ["toggle > list", "<details><summary>L1</summary>\n\n- a\n  - b\n    - c\n\n</details>"],
    ["callout > list", "> [!NOTE]\n> body\n>\n> - a\n>   - b\n>     - c"],
    ["list item continuation inside a toggle", "<details><summary>L1</summary>\n\n- a\n  - b\n\n    note\n\n</details>"],
  ];
  for (const [name, md] of cases) {
    it(`${name} never exceeds Notion's limit`, () => {
      assert.ok(maxDepth(markdownToBlocks(md)) <= 2, `${name} nested too deep`);
    });
  }

  it("content pushed past the limit is promoted, not dropped", () => {
    const md = "<details><summary>L1</summary>\n\n<details><summary>L2</summary>\n\n<details><summary>L3</summary>\n\nkeep me\n\n</details>\n\n</details>\n\n</details>";
    assert.match(JSON.stringify(markdownToBlocks(md)), /keep me/);
  });

  it("warns when blocks are promoted out of a container", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((msg) => warnings.push(msg));
    markdownToBlocks("<details><summary>L1</summary>\n\n<details><summary>L2</summary>\n\n<details><summary>L3</summary>\n\nleaf\n\n</details>\n\n</details>\n\n</details>");
    setMarkdownWarnHandler(null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /2 levels/i);
  });
});

describe("wrapped list item text", () => {
  it("a line wrapped without a blank line folds into the item's text", () => {
    const blocks = markdownToBlocks("- A long item that\n  wraps onto a second line");
    assert.equal(blocks.length, 1);
    const item = (blocks[0] as any).bulleted_list_item;
    assert.equal(item.children, undefined, "a soft wrap is not a child block");
    assert.equal(item.rich_text.map((r: any) => r.plain_text).join(""), "A long item that wraps onto a second line");
  });

  it("a blank line still separates a real child paragraph", () => {
    const blocks = markdownToBlocks("- Item\n  wrapped\n\n  separate paragraph");
    const item = (blocks[0] as any).bulleted_list_item;
    assert.equal(item.rich_text.map((r: any) => r.plain_text).join(""), "Item wrapped");
    assert.equal(item.children.length, 1);
    assert.equal(item.children[0].paragraph.rich_text[0].text.content, "separate paragraph");
  });
});

describe("nesting limits that need extra room", () => {
  it("a table two containers deep is promoted, since its rows need a level", () => {
    const md = "<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n</details>\n\n</details>";
    const blocks = markdownToBlocks(md);
    assert.ok(maxDepth(blocks) <= 2, "table rows must not land at depth 3");
    assert.match(JSON.stringify(blocks), /table_row/, "the table must survive");
  });

  it("a table under a nested list item is promoted too", () => {
    const md = "- a\n  - b\n\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |";
    const blocks = markdownToBlocks(md);
    assert.ok(maxDepth(blocks) <= 2, "table rows must not land at depth 3");
    assert.match(JSON.stringify(blocks), /table_row/);
  });

  it("a table one container deep still nests normally", () => {
    const blocks = markdownToBlocks("<details><summary>Outer</summary>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n</details>");
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as any).toggle.children[0].type, "table");
  });

  it("a pathologically indented list does not exhaust the stack", () => {
    const md = Array.from({ length: 5000 }, (_, k) => " ".repeat(k) + "- x").join("\n");
    assert.doesNotThrow(() => markdownToBlocks(md));
  });
});

describe("list item body column", () => {
  it("an over-indented fence still finds its closing marker", () => {
    const blocks = markdownToBlocks("- Item\n\n      ```\n      code\n      ```\n\nafter");
    assert.equal(blocks.length, 2, "the fence must close, leaving the trailing paragraph");
    const children = (blocks[0] as any).bulleted_list_item.children;
    assert.equal(children[0].type, "code");
    assert.equal(children[0].code.rich_text[0].text.content, "code");
    assert.equal(blocks[1]!.type, "paragraph");
  });
});

describe("an unrecognised comment inside a callout", () => {
  it("is skipped rather than ending the callout", () => {
    // Falling through to the loop's break left an empty callout, the comment as
    // a visible paragraph, and the body stranded in a separate quote.
    const blocks = markdownToBlocks("> [!NOTE]\n<!-- todo: revisit -->\n> body text");
    assert.equal(blocks.length, 1, "must stay one block");
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.rich_text.map((r: any) => r.plain_text).join(""), "body text");
  });
});

describe("markers and values the parser cannot use", () => {
  it("a pass-through marker inside a callout is still reported, not silently dropped", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((m) => warnings.push(m));
    markdownToBlocks("> [!NOTE]\n> body\n<!-- notion-block: synced_block id=abc123 -->");
    setMarkdownWarnHandler(null);
    assert.ok(warnings.some((w) => /synced_block/.test(w)), "dropping a block must stay visible");
  });

  it("a colour Notion does not know falls back instead of failing the request", () => {
    const warnings: string[] = [];
    setMarkdownWarnHandler((m) => warnings.push(m));
    const blocks = markdownToBlocks("> [!NOTE]\n<!-- color: chartreuse -->\n> body");
    setMarkdownWarnHandler(null);
    assert.ok((blocks[0] as any).callout.color !== "chartreuse");
    assert.equal(warnings.length, 1);
  });

  it("a non-emoji icon value falls back, including non-English text", () => {
    for (const value of ["hello", "x", "日本語", "café"]) {
      const blocks = markdownToBlocks(`> [!NOTE]\n<!-- icon: ${value} -->\n> body`);
      const icon = (blocks[0] as any).callout.icon;
      assert.equal(icon.type, "emoji");
      assert.notEqual(icon.emoji, value, `${value} must not be sent as an emoji`);
    }
  });

  it("a real emoji is still accepted", () => {
    for (const value of ["🚀", "1️⃣", "🇺🇸", "👨‍👩‍👧‍👦", "❗"]) {
      const blocks = markdownToBlocks(`> [!NOTE]\n<!-- icon: ${value} -->\n> body`);
      assert.equal((blocks[0] as any).callout.icon.emoji, value);
    }
  });

  it("an emoji with anything else beside it falls back", () => {
    // Notion wants a single glyph and rejects the whole request otherwise, so
    // "contains an emoji" was not a strong enough test.
    for (const value of ["🚀 launch", "fire 🔥", "🚀!"]) {
      const icon = (markdownToBlocks(`> [!NOTE]\n<!-- icon: ${value} -->\n> body`)[0] as any).callout.icon;
      assert.notEqual(icon.emoji, value, `${value} must not be sent as an emoji`);
    }
  });
});
