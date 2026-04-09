import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { richTextToMarkdown, markdownToRichText } from "../../src/markdown/tokenizer.js";
import type { RichText } from "../../src/markdown/types.js";
import { DEFAULT_ANNOTATIONS } from "../../src/markdown/types.js";

function text(content: string, annotations: Partial<typeof DEFAULT_ANNOTATIONS> = {}): RichText {
  return {
    type: "text",
    text: { content, link: null },
    annotations: { ...DEFAULT_ANNOTATIONS, ...annotations },
    plain_text: content,
    href: null,
  };
}

function link(content: string, url: string, annotations: Partial<typeof DEFAULT_ANNOTATIONS> = {}): RichText {
  return {
    type: "text",
    text: { content, link: { url } },
    annotations: { ...DEFAULT_ANNOTATIONS, ...annotations },
    plain_text: content,
    href: url,
  };
}

describe("richTextToMarkdown", () => {
  it("plain text passes through", () => {
    assert.equal(richTextToMarkdown([text("hello world")]), "hello world");
  });

  it("bold wraps in **", () => {
    assert.equal(richTextToMarkdown([text("hello", { bold: true })]), "**hello**");
  });

  it("italic wraps in _", () => {
    assert.equal(richTextToMarkdown([text("hello", { italic: true })]), "_hello_");
  });

  it("bold + italic nests correctly", () => {
    assert.equal(
      richTextToMarkdown([text("hello", { bold: true, italic: true })]),
      "**_hello_**",
    );
  });

  it("inline code wraps in backticks", () => {
    assert.equal(richTextToMarkdown([text("code", { code: true })]), "`code`");
  });

  it("strikethrough wraps in ~~", () => {
    assert.equal(richTextToMarkdown([text("gone", { strikethrough: true })]), "~~gone~~");
  });

  it("mixed runs emit minimal markers using an annotation stack", () => {
    // "a " plain, "bold italic" bold+italic, " c" plain
    // Naive emits: a **_bold italic_**  c  → correct
    // Previous bug: would emit "a ****_bold italic_**** c"
    const runs: RichText[] = [
      text("a "),
      text("bold italic", { bold: true, italic: true }),
      text(" c"),
    ];
    assert.equal(richTextToMarkdown(runs), "a **_bold italic_** c");
  });

  it("transition from bold+italic back to italic-only keeps italic open", () => {
    // "_a **b** c_" — italic continues across a bold run
    const runs: RichText[] = [
      text("a ", { italic: true }),
      text("b", { bold: true, italic: true }),
      text(" c", { italic: true }),
    ];
    assert.equal(richTextToMarkdown(runs), "_a **b** c_");
  });

  it("links wrap innermost", () => {
    const runs: RichText[] = [link("click here", "https://example.com")];
    assert.equal(richTextToMarkdown(runs), "[click here](https://example.com)");
  });

  it("bold link", () => {
    const runs: RichText[] = [link("click", "https://example.com", { bold: true })];
    assert.equal(richTextToMarkdown(runs), "**[click](https://example.com)**");
  });

  it("link inside annotated span", () => {
    const runs: RichText[] = [
      text("a ", { bold: true }),
      link("link", "https://example.com", { bold: true }),
      text(" c", { bold: true }),
    ];
    assert.equal(richTextToMarkdown(runs), "**a [link](https://example.com) c**");
  });

  it("empty run array returns empty string", () => {
    assert.equal(richTextToMarkdown([]), "");
  });
});

describe("markdownToRichText", () => {
  it("plain text returns one run", () => {
    const runs = markdownToRichText("hello world");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "hello world");
    assert.equal(runs[0]!.annotations.bold, false);
  });

  it("bold produces bold run", () => {
    const runs = markdownToRichText("**hello**");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "hello");
    assert.equal(runs[0]!.annotations.bold, true);
  });

  it("italic produces italic run", () => {
    const runs = markdownToRichText("_hello_");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.italic, true);
  });

  it("bold + italic combined", () => {
    const runs = markdownToRichText("**_hello_**");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.bold, true);
    assert.equal(runs[0]!.annotations.italic, true);
  });

  it("mixed plain and bold segments", () => {
    const runs = markdownToRichText("a **b** c");
    assert.equal(runs.length, 3);
    assert.equal(runs[0]!.plain_text, "a ");
    assert.equal(runs[0]!.annotations.bold, false);
    assert.equal(runs[1]!.plain_text, "b");
    assert.equal(runs[1]!.annotations.bold, true);
    assert.equal(runs[2]!.plain_text, " c");
  });

  it("inline code segment", () => {
    const runs = markdownToRichText("`code`");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.code, true);
    assert.equal(runs[0]!.plain_text, "code");
  });

  it("link produces text run with link set", () => {
    const runs = markdownToRichText("[click](https://example.com)");
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    assert.equal(run.type, "text");
    if (run.type === "text") {
      assert.equal(run.text.content, "click");
      assert.deepEqual(run.text.link, { url: "https://example.com" });
    }
  });

  it("annotation wrapping a link", () => {
    const runs = markdownToRichText("**[click](https://example.com)**");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.bold, true);
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://example.com" });
    }
  });

  it("strikethrough", () => {
    const runs = markdownToRichText("~~gone~~");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.strikethrough, true);
  });

  it("round-trip: runs → md → runs preserves annotations", () => {
    const original: RichText[] = [
      text("a "),
      text("bold italic", { bold: true, italic: true }),
      text(" c"),
    ];
    const md = richTextToMarkdown(original);
    const roundtripped = markdownToRichText(md);
    // Reconstructing must preserve semantic annotations, not exact run count
    assert.equal(roundtripped.length >= 3, true);
    assert.equal(roundtripped.find((r) => r.plain_text === "bold italic")?.annotations.bold, true);
  });

  it("handles backticks literally inside a link label", () => {
    const runs = markdownToRichText("[`code` label](https://example.com)");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "`code` label");
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://example.com" });
    }
  });

  it("empty string returns empty array", () => {
    assert.deepEqual(markdownToRichText(""), []);
  });
});
