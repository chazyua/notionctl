import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { richTextToMarkdown } from "../../src/markdown/tokenizer.js";
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
