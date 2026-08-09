import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { richTextToMarkdown, markdownToRichText, findReplaceRichText } from "../../src/markdown/tokenizer.js";
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

  it("asterisk italic *text* produces italic run", () => {
    const runs = markdownToRichText("*hello*");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "hello");
    assert.equal(runs[0]!.annotations.italic, true);
  });

  it("***bold italic*** with triple asterisk", () => {
    const runs = markdownToRichText("***both***");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "both");
    assert.equal(runs[0]!.annotations.bold, true);
    assert.equal(runs[0]!.annotations.italic, true);
  });

  it("mixed *italic* and **bold** in same line", () => {
    const runs = markdownToRichText("a *italic* and **bold** end");
    const italic = runs.find((r) => r.plain_text === "italic");
    const bold = runs.find((r) => r.plain_text === "bold");
    assert.ok(italic, "italic run exists");
    assert.equal(italic!.annotations.italic, true);
    assert.equal(italic!.annotations.bold, false);
    assert.ok(bold, "bold run exists");
    assert.equal(bold!.annotations.bold, true);
    assert.equal(bold!.annotations.italic, false);
  });

  it("intraword underscores are literal, not italic", () => {
    const runs = markdownToRichText("multi_select and rich_text");
    const full = runs.map((r) => r.plain_text).join("");
    assert.equal(full, "multi_select and rich_text");
    // No run should have italic
    assert.ok(runs.every((r) => !r.annotations.italic), "intraword _ must not trigger italic");
  });

  it("leading/trailing underscores still trigger italic", () => {
    const runs = markdownToRichText("_italic_ text");
    const italic = runs.find((r) => r.plain_text === "italic");
    assert.ok(italic, "italic run exists");
    assert.equal(italic!.annotations.italic, true);
  });

  it("relative link renders as plain text without href", () => {
    const runs = markdownToRichText("See [COMMANDS.md](docs/COMMANDS.md) for details");
    const linkRun = runs.find((r) => r.plain_text === "COMMANDS.md");
    assert.ok(linkRun, "link label preserved as text");
    if (linkRun!.type === "text") {
      assert.equal(linkRun!.text.link, null, "relative URL should not become a Notion link");
    }
  });

  it("absolute link still works", () => {
    const runs = markdownToRichText("[site](https://example.com)");
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://example.com" });
    }
  });

  it("link with parentheses in URL (Wikipedia-style)", () => {
    const runs = markdownToRichText("[article](https://en.wikipedia.org/wiki/Markdown_(syntax))");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "article");
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://en.wikipedia.org/wiki/Markdown_(syntax)" });
    }
  });

  it("link followed by text after closing paren", () => {
    const runs = markdownToRichText("[link](https://example.com) and more text");
    assert.equal(runs.length, 2);
    assert.equal(runs[0]!.plain_text, "link");
    assert.equal(runs[1]!.plain_text, " and more text");
  });

  it("escaped backslash before marker is literal", () => {
    const runs = markdownToRichText("not \\*bold\\*");
    const fullText = runs.map(r => r.plain_text).join("");
    assert.equal(fullText, "not *bold*");
    assert.ok(runs.every(r => !r.annotations.bold && !r.annotations.italic));
  });

  it("code inside bold: **`code`** preserves both", () => {
    const runs = markdownToRichText("**`code`**");
    // Code inside bold — the backtick scan produces a code run, but bold state wraps it
    assert.ok(runs.length >= 1);
    const codeRun = runs.find(r => r.plain_text === "code");
    assert.ok(codeRun);
    assert.equal(codeRun!.annotations.code, true);
  });

  it("unclosed bold marker is treated as literal", () => {
    const runs = markdownToRichText("open ** but never closed");
    const fullText = runs.map(r => r.plain_text).join("");
    assert.ok(fullText.includes("open"), "text before marker preserved");
  });

  it("empty bold ** ** produces empty bold run", () => {
    const runs = markdownToRichText("** **");
    // ** opens bold, space, ** closes bold — produces a bold space
    assert.ok(runs.length >= 1);
  });

  it("single * surrounded by spaces is literal (math)", () => {
    // `1 * 2 = 2` used to toggle italic on every `*`.
    const runs = markdownToRichText("1 * 2 = 2 and 3 * 4 = 12");
    assert.ok(runs.every(r => !r.annotations.italic), "no runs should be italic");
    assert.equal(runs.map(r => r.plain_text).join(""), "1 * 2 = 2 and 3 * 4 = 12");
  });

  it("unclosed single * is literal (C pointer)", () => {
    const runs = markdownToRichText("int *ptr = NULL;");
    assert.ok(runs.every(r => !r.annotations.italic));
    assert.equal(runs.map(r => r.plain_text).join(""), "int *ptr = NULL;");
  });

  it("intraword single * is literal (foo*bar with no close)", () => {
    const runs = markdownToRichText("foo*bar literal");
    assert.ok(runs.every(r => !r.annotations.italic));
    assert.equal(runs.map(r => r.plain_text).join(""), "foo*bar literal");
  });

  it("paired single * still works for italic (foo *italic* bar)", () => {
    const runs = markdownToRichText("foo *italic* bar");
    const italic = runs.find(r => r.plain_text === "italic");
    assert.ok(italic, "italic run exists");
    assert.equal(italic!.annotations.italic, true);
  });

  it("dollar sign followed by digit stays literal (currency)", () => {
    // $100 or $200 used to be parsed as equation.
    const runs = markdownToRichText("The cost is $100 or $200.");
    assert.ok(runs.every(r => r.type === "text"), "no equation runs");
    assert.equal(runs.map(r => r.plain_text).join(""), "The cost is $100 or $200.");
  });

  it("dollar sign with whitespace after is literal", () => {
    const runs = markdownToRichText("$ 5 is still literal");
    assert.ok(runs.every(r => r.type === "text"));
  });

  it("tight $x$ is still recognized as equation", () => {
    const runs = markdownToRichText("When $x > 0$ holds");
    assert.ok(runs.some(r => r.type === "equation"), "equation must still parse");
  });

  it("mailto: link is preserved", () => {
    // mailto links used to be silently dropped.
    const runs = markdownToRichText("Email [us](mailto:hi@example.com) please");
    const linkRun = runs.find(r => r.plain_text === "us");
    assert.ok(linkRun);
    if (linkRun!.type === "text") {
      assert.deepEqual(linkRun!.text.link, { url: "mailto:hi@example.com" });
    }
  });

  it("tel: link is preserved", () => {
    const runs = markdownToRichText("[call](tel:+15551234)");
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "tel:+15551234" });
    }
  });
});

describe("findReplaceRichText", () => {
  it("returns 0 matches when find is not present", () => {
    const runs = [text("Hello world")];
    const { runs: out, count } = findReplaceRichText(runs, "xyz", "abc");
    assert.equal(count, 0);
    assert.equal(out, runs);
  });

  it("replaces within a single run", () => {
    const runs = [text("Hello world")];
    const { runs: out, count } = findReplaceRichText(runs, "world", "everyone");
    assert.equal(count, 1);
    assert.equal(out.length, 1);
    assert.equal((out[0] as any).text.content, "Hello everyone");
  });

  it("replaces across run boundaries", () => {
    // "Hel" + "bo"(bold) + "lo rest" → find "bolo" spans runs
    const runs = [text("Hel"), text("bo", { bold: true }), text("lo rest")];
    const { runs: out, count } = findReplaceRichText(runs, "bolo", "XXXXXX");
    assert.equal(count, 1);
    const joined = out.map(r => r.plain_text).join("");
    assert.equal(joined, "HelXXXXXX rest");
  });

  it("replacement inherits the annotation of the first matched char", () => {
    const runs = [text("Hel"), text("bo", { bold: true }), text("lo rest")];
    const { runs: out } = findReplaceRichText(runs, "lbo", "Q");
    // "l" is plain (not bold), so "Q" should be plain
    const qRun = out.find(r => r.plain_text.includes("Q"));
    assert.ok(qRun);
    assert.equal(qRun!.annotations.bold, false);
  });

  it("replaces multiple occurrences", () => {
    const runs = [text("foo bar foo baz")];
    const { count } = findReplaceRichText(runs, "foo", "QUX");
    assert.equal(count, 2);
  });

  it("skips matches that cross a non-text run", () => {
    // Non-text runs (equation) are opaque
    const equation: RichText = {
      type: "equation",
      equation: { expression: "x" },
      annotations: { ...DEFAULT_ANNOTATIONS },
      plain_text: "x",
      href: null,
    } as unknown as RichText;
    const runs = [text("ab"), equation, text("cd")];
    const { count } = findReplaceRichText(runs, "bxc", "ZZZ");
    assert.equal(count, 0, "match crossing equation must be skipped");
  });
});

describe("splitLongRuns", () => {
  it("does not split surrogate pairs", () => {
    // Build a string ending with a surrogate pair exactly at the 2000 boundary.
    // 1999 ASCII chars + 1 emoji (2 UTF-16 units) = 2001 UTF-16 units, which crosses
    // the 2000 chunk boundary inside the emoji.
    const content = "a".repeat(1999) + "🌟" + "b".repeat(500);
    const runs = markdownToRichText(content);
    // Verify no chunk ends mid-surrogate by re-joining and checking the emoji survived
    const rejoined = runs.map(r => r.plain_text).join("");
    assert.equal(rejoined, content, "content round-trips without corruption");
    // Each chunk must be valid UTF-16 (no lone surrogates)
    for (const r of runs) {
      if (r.type === "text") {
        for (let i = 0; i < r.text.content.length; i++) {
          const code = r.text.content.charCodeAt(i);
          if (code >= 0xD800 && code <= 0xDBFF) {
            const next = r.text.content.charCodeAt(i + 1);
            assert.ok(next >= 0xDC00 && next <= 0xDFFF, "high surrogate must be followed by low surrogate in same chunk");
            i++;
          }
        }
      }
    }
  });

  it("emoji in text passes through unchanged", () => {
    const runs = markdownToRichText("Hello 🌍 World 🎉");
    const fullText = runs.map(r => r.plain_text).join("");
    assert.equal(fullText, "Hello 🌍 World 🎉");
  });

  it("CJK characters pass through unchanged", () => {
    const runs = markdownToRichText("日本語テスト");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "日本語テスト");
  });

  it("bold CJK text", () => {
    const runs = markdownToRichText("**日本語**のテスト");
    const boldRun = runs.find(r => r.plain_text === "日本語");
    assert.ok(boldRun);
    assert.equal(boldRun!.annotations.bold, true);
  });

  it("multiple links in one line", () => {
    const runs = markdownToRichText("[a](https://a.com) and [b](https://b.com)");
    const links = runs.filter(r => r.type === "text" && r.text.link !== null);
    assert.equal(links.length, 2);
  });
});

describe("richTextToMarkdown — annotation stack edge cases", () => {
  it("bold+strikethrough → strikethrough-only closes bold correctly", () => {
    const runs: RichText[] = [
      text("AB", { bold: true, strikethrough: true }),
      text("CD", { strikethrough: true }),
    ];
    const md = richTextToMarkdown(runs);
    // Parse back and verify CD is NOT bold
    const roundtripped = markdownToRichText(md);
    const cdRun = roundtripped.find(r => r.plain_text === "CD");
    assert.ok(cdRun, "CD run must exist");
    assert.equal(cdRun!.annotations.bold, false, "CD must not be bold");
    assert.equal(cdRun!.annotations.strikethrough, true, "CD must be strikethrough");
  });

  it("bold+italic → bold-only closes italic correctly", () => {
    const runs: RichText[] = [
      text("AB", { bold: true, italic: true }),
      text("CD", { bold: true }),
    ];
    const md = richTextToMarkdown(runs);
    const roundtripped = markdownToRichText(md);
    const cdRun = roundtripped.find(r => r.plain_text === "CD");
    assert.ok(cdRun, "CD run must exist");
    assert.equal(cdRun!.annotations.italic, false, "CD must not be italic");
    assert.equal(cdRun!.annotations.bold, true, "CD must be bold");
  });

  it("italic+code → italic-only closes code correctly", () => {
    const runs: RichText[] = [
      text("AB", { italic: true, code: true }),
      text("CD", { italic: true }),
    ];
    const md = richTextToMarkdown(runs);
    const roundtripped = markdownToRichText(md);
    const cdRun = roundtripped.find(r => r.plain_text === "CD");
    assert.ok(cdRun, "CD run must exist");
    assert.equal(cdRun!.annotations.code, false, "CD must not be code");
    assert.equal(cdRun!.annotations.italic, true, "CD must be italic");
  });

  it("bold → bold+strikethrough → strikethrough: all transitions clean", () => {
    const runs: RichText[] = [
      text("A", { bold: true }),
      text("B", { bold: true, strikethrough: true }),
      text("C", { strikethrough: true }),
    ];
    const md = richTextToMarkdown(runs);
    const rt = markdownToRichText(md);
    const aRun = rt.find(r => r.plain_text === "A");
    const bRun = rt.find(r => r.plain_text === "B");
    const cRun = rt.find(r => r.plain_text === "C");
    assert.ok(aRun && bRun && cRun);
    assert.equal(aRun!.annotations.bold, true);
    assert.equal(aRun!.annotations.strikethrough, false);
    assert.equal(bRun!.annotations.bold, true);
    assert.equal(bRun!.annotations.strikethrough, true);
    assert.equal(cRun!.annotations.bold, false);
    assert.equal(cRun!.annotations.strikethrough, true);
  });

  it("no annotations → all four → no annotations", () => {
    const runs: RichText[] = [
      text("plain "),
      text("all", { bold: true, italic: true, strikethrough: true, code: true }),
      text(" plain"),
    ];
    const md = richTextToMarkdown(runs);
    const rt = markdownToRichText(md);
    const plainRuns = rt.filter(r => !r.annotations.bold && !r.annotations.italic && !r.annotations.strikethrough && !r.annotations.code);
    assert.ok(plainRuns.length >= 2, "at least two plain runs");
    const allRun = rt.find(r => r.annotations.bold && r.annotations.italic);
    assert.ok(allRun, "all-annotated run must exist");
  });
});

describe("markdownToRichText — additional edge cases", () => {
  it("nested backticks in code span (single vs double)", () => {
    // Single backtick code
    const runs = markdownToRichText("`hello world`");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.code, true);
    assert.equal(runs[0]!.plain_text, "hello world");
  });

  it("unmatched backtick treated as literal", () => {
    const runs = markdownToRichText("open ` but no close");
    const fullText = runs.map(r => r.plain_text).join("");
    assert.equal(fullText, "open ` but no close");
    assert.ok(runs.every(r => !r.annotations.code), "no code annotation");
  });

  it("bold immediately followed by italic without space", () => {
    const runs = markdownToRichText("**bold**_italic_");
    const bold = runs.find(r => r.plain_text === "bold");
    const italic = runs.find(r => r.plain_text === "italic");
    assert.ok(bold, "bold run exists");
    assert.ok(italic, "italic run exists");
    assert.equal(bold!.annotations.bold, true);
    assert.equal(bold!.annotations.italic, false);
    assert.equal(italic!.annotations.italic, true);
    assert.equal(italic!.annotations.bold, false);
  });

  it("link at end of bold text", () => {
    const runs = markdownToRichText("**see [here](https://example.com)**");
    assert.ok(runs.length >= 1);
    // The link run should exist and have bold annotation
    const linkRun = runs.find(r => r.type === "text" && r.text.link !== null);
    assert.ok(linkRun, "link run exists");
    assert.equal(linkRun!.annotations.bold, true);
  });

  it("adjacent links with no space", () => {
    const runs = markdownToRichText("[a](https://a.com)[b](https://b.com)");
    const links = runs.filter(r => r.type === "text" && r.text.link !== null);
    assert.equal(links.length, 2, "two link runs");
  });

  it("underscore in URL doesn't trigger italic", () => {
    const runs = markdownToRichText("[link](https://example.com/path_name)");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.italic, false);
  });

  it("consecutive strikethrough segments", () => {
    const runs = markdownToRichText("~~a~~ ~~b~~ ~~c~~");
    const strikes = runs.filter(r => r.annotations.strikethrough);
    assert.equal(strikes.length, 3);
  });

  it("escaped marker at start of text", () => {
    const runs = markdownToRichText("\\**not bold\\**");
    const fullText = runs.map(r => r.plain_text).join("");
    assert.ok(fullText.includes("*"), "escaped asterisk preserved as literal");
  });

  it("empty input returns empty array", () => {
    assert.deepEqual(markdownToRichText(""), []);
  });

  it("whitespace-only input", () => {
    const runs = markdownToRichText("   ");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "   ");
  });

  it("long text with many formatting changes", () => {
    const md = "plain **bold** _italic_ **_both_** ~~strike~~ `code` plain";
    const runs = markdownToRichText(md);
    const fullText = runs.map(r => r.plain_text).join("");
    assert.equal(fullText, "plain bold italic both strike code plain");
    assert.ok(runs.find(r => r.plain_text === "bold" && r.annotations.bold));
    assert.ok(runs.find(r => r.plain_text === "italic" && r.annotations.italic));
    assert.ok(runs.find(r => r.plain_text === "both" && r.annotations.bold && r.annotations.italic));
    assert.ok(runs.find(r => r.plain_text === "strike" && r.annotations.strikethrough));
    assert.ok(runs.find(r => r.plain_text === "code" && r.annotations.code));
  });
});

describe("notion:// URL support", () => {
  it("preserves notion:// links in rich text", () => {
    const runs = markdownToRichText("[Page Link](notion://page/abc-123)");
    assert.equal(runs.length, 1);
    assert.equal((runs[0] as any).text.link?.url, "notion://page/abc-123");
  });
});

describe("inline equation parsing", () => {
  it("parses $expr$ as equation run", () => {
    const runs = markdownToRichText("before $x^2$ after");
    assert.equal(runs.length, 3);
    assert.equal(runs[0]!.plain_text, "before ");
    assert.equal(runs[1]!.type, "equation");
    assert.equal((runs[1] as any).equation.expression, "x^2");
    assert.equal(runs[2]!.plain_text, " after");
  });

  it("handles standalone equation", () => {
    const runs = markdownToRichText("$E = mc^2$");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.type, "equation");
    assert.equal((runs[0] as any).equation.expression, "E = mc^2");
  });

  it("does not parse unclosed $ as equation", () => {
    const runs = markdownToRichText("price is $100");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.type, "text");
  });

  it("does not parse empty $$ as equation", () => {
    const runs = markdownToRichText("$$");
    // $$ should not match single-$ equation (next !== "$" check)
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.type, "text");
  });
});

describe("richTextToMarkdown — additional edge cases", () => {
  it("single run with all annotations", () => {
    const runs: RichText[] = [
      text("all", { bold: true, italic: true, strikethrough: true, code: true }),
    ];
    const md = richTextToMarkdown(runs);
    // Should contain all markers
    assert.ok(md.includes("**"), "bold markers");
    assert.ok(md.includes("~~"), "strikethrough markers");
    // Code backtick should be present
    assert.ok(md.includes("`"), "code markers");
    // Round-trip should preserve
    const rt = markdownToRichText(md);
    const run = rt.find(r => r.plain_text === "all");
    assert.ok(run, "run preserved");
  });

  it("empty run array", () => {
    assert.equal(richTextToMarkdown([]), "");
  });

  it("single empty-string run", () => {
    const md = richTextToMarkdown([text("")]);
    assert.equal(md, "");
  });

  it("mention run renders correctly", () => {
    const mention: RichText = {
      type: "mention",
      mention: { type: "user", user: { id: "user-123" } },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
      plain_text: "John Doe",
      href: null,
    };
    const md = richTextToMarkdown([mention]);
    // The display name stays visible and the id moves into the link, matching
    // how page and database mentions have always rendered.
    assert.equal(md, "[John Doe](notion://user/user-123)");
  });

  it("equation run renders with dollar signs", () => {
    const eq: RichText = {
      type: "equation",
      equation: { expression: "x^2" },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
      plain_text: "x^2",
      href: null,
    };
    const md = richTextToMarkdown([eq]);
    assert.equal(md, "$x^2$");
  });

  it("mixed text and mention runs", () => {
    const runs: RichText[] = [
      text("Hello "),
      {
        type: "mention",
        mention: { type: "user", user: { id: "abc" } },
        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
        plain_text: "Alice",
        href: null,
      },
      text(", welcome!"),
    ];
    const md = richTextToMarkdown(runs);
    assert.equal(md, "Hello [Alice](notion://user/abc), welcome!");
  });
});

describe("inline equation and emphasis edge cases", () => {
  it("does not parse currency as equation when closing $ is preceded by whitespace", () => {
    const runs = markdownToRichText("I paid $5 for coffee and $10 for lunch.");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.type, "text");
    assert.equal((runs[0] as any).text.content, "I paid $5 for coffee and $10 for lunch.");
  });

  it("does not parse currency as equation across multiple amounts", () => {
    const runs = markdownToRichText("Prices: $100 and $200.");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.type, "text");
  });

  it("still parses genuine inline math with non-whitespace delimiters", () => {
    const runs = markdownToRichText("before $x^2$ after");
    assert.equal(runs.length, 3);
    assert.equal(runs[1]!.type, "equation");
    assert.equal((runs[1] as any).equation.expression, "x^2");
  });

  it("treats bare * between alphanumerics as literal (CommonMark intraword rule)", () => {
    const runs = markdownToRichText("Compute 2*3 = 6.");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.type, "text");
    assert.equal((runs[0] as any).annotations.italic, false);
    assert.equal((runs[0] as any).text.content, "Compute 2*3 = 6.");
  });

  it("treats glob pattern *.md as literal, not italic opener", () => {
    const runs = markdownToRichText("Files matching *.md here.");
    const joined = runs.map(r => (r as any).text?.content ?? "").join("");
    assert.equal(joined, "Files matching *.md here.");
    for (const r of runs) {
      assert.equal(r.annotations.italic, false, "no run should be italic");
    }
  });

  it("still parses proper *italic* with word-boundary asterisks", () => {
    const runs = markdownToRichText("This is *important* here.");
    const italicRun = runs.find(r => r.annotations.italic);
    assert.ok(italicRun, "should have an italic run");
    assert.equal((italicRun as any).text.content, "important");
  });

  it("preserves mailto: links", () => {
    const runs = markdownToRichText("Email [us](mailto:hi@example.com).");
    const linkRun = runs.find(r => (r as any).text?.link?.url);
    assert.ok(linkRun, "link run should exist");
    assert.equal((linkRun as any).text.link.url, "mailto:hi@example.com");
  });

  it("preserves tel: links", () => {
    const runs = markdownToRichText("Call [now](tel:+15551234567).");
    const linkRun = runs.find(r => (r as any).text?.link?.url);
    assert.ok(linkRun);
    assert.equal((linkRun as any).text.link.url, "tel:+15551234567");
  });

  it("strips CommonMark link title from URL", () => {
    // Regression: `[label](url "title")` passed the whole `url "title"` as
    // the URL to Notion, which rejects it as invalid. CommonMark titles
    // are metadata-only and Notion has no link-title field, so we strip them.
    const runs = markdownToRichText('[docs](https://example.com "API Reference")');
    const linkRun = runs.find(r => (r as any).text?.link?.url);
    assert.ok(linkRun, "link run exists");
    assert.equal((linkRun as any).text.link.url, "https://example.com");
  });

  it("strips single-quoted link title", () => {
    const runs = markdownToRichText("[label](https://example.com 'Title')");
    const linkRun = runs.find(r => (r as any).text?.link?.url);
    assert.ok(linkRun);
    assert.equal((linkRun as any).text.link.url, "https://example.com");
  });

  it("preserves URL that only looks like it has a title but doesn't", () => {
    const runs = markdownToRichText("[label](https://example.com/path)");
    const linkRun = runs.find(r => (r as any).text?.link?.url);
    assert.ok(linkRun);
    assert.equal((linkRun as any).text.link.url, "https://example.com/path");
  });
});

describe("round-trip marker escaping — richTextToMarkdown escapes literals", () => {
  it("skips escaping asterisks between alphanums (e.g. 2*3)", () => {
    const md = richTextToMarkdown([text("2*3 = 6")]);
    assert.equal(md, "2*3 = 6");
    // Round-trip: write path treats alphanum*alphanum as literal
    const rt = markdownToRichText(md);
    assert.equal(rt.length, 1);
    assert.equal(rt[0]!.plain_text, "2*3 = 6");
    assert.equal((rt[0] as any).annotations.italic, false);
  });

  it("escapes asterisks that could trigger emphasis", () => {
    const md = richTextToMarkdown([text("use *star* marks")]);
    assert.equal(md, "use \\*star\\* marks");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "use *star* marks");
  });

  it("skips escaping intraword underscores (e.g. multi_select)", () => {
    const md = richTextToMarkdown([text("multi_select_value")]);
    assert.equal(md, "multi_select_value");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "multi_select_value");
  });

  it("escapes underscores at word boundaries", () => {
    const md = richTextToMarkdown([text("_italic_")]);
    assert.equal(md, "\\_italic\\_");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "_italic_");
  });

  it("escapes all underscores when any could trigger emphasis", () => {
    const md = richTextToMarkdown([text("__init__")]);
    assert.equal(md, "\\_\\_init\\_\\_");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "__init__");
  });

  it("escapes literal tildes in plain text", () => {
    const md = richTextToMarkdown([text("use ~~tilde~~ marks")]);
    assert.equal(md, "use \\~\\~tilde\\~\\~ marks");
    const rt = markdownToRichText(md);
    const full = rt.map(r => r.plain_text).join("");
    assert.equal(full, "use ~~tilde~~ marks");
  });

  it("escapes literal backticks in plain text", () => {
    const md = richTextToMarkdown([text("use `code` syntax")]);
    assert.equal(md, "use \\`code\\` syntax");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "use `code` syntax");
    assert.equal((rt[0] as any).annotations.code, false);
  });

  it("escapes literal brackets in plain text", () => {
    const md = richTextToMarkdown([text("array[0] access")]);
    // Both brackets are escaped: `]` closes a link label, so leaving it bare
    // let bracketed text terminate a link early and lose it.
    assert.equal(md, "array\\[0\\] access");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "array[0] access");
  });

  it("does not double-escape backslashes on round-trip", () => {
    // Plain text with a literal backslash
    const md = richTextToMarkdown([text("path\\to\\file")]);
    assert.equal(md, "path\\\\to\\\\file");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "path\\to\\file");
  });

  it("bold text with literal asterisks inside round-trips correctly", () => {
    // Bold run containing a literal asterisk in its content
    const md = richTextToMarkdown([text("a*b", { bold: true })]);
    assert.match(md, /\*\*a\\\*b\*\*/);
    const rt = markdownToRichText(md);
    const full = rt.map(r => r.plain_text).join("");
    assert.equal(full, "a*b");
    const boldRun = rt.find(r => (r as any).annotations.bold);
    assert.ok(boldRun, "bold annotation must survive round-trip");
  });

  it("preserves formatted text alongside escaped literals", () => {
    // Mix of real bold and literal asterisks
    const runs = [
      text("Use "),
      text("bold", { bold: true }),
      text(" not *literal*"),
    ];
    const md = richTextToMarkdown(runs);
    assert.match(md, /\*\*bold\*\*/); // real bold
    assert.match(md, /\\[*]/); // escaped literal
    // Round-trip
    const rt = markdownToRichText(md);
    const fullText = rt.map(r => r.plain_text).join("");
    assert.equal(fullText, "Use bold not *literal*");
  });

  it("code run content is NOT escaped (backticks prevent reinterpretation)", () => {
    const md = richTextToMarkdown([text("**not bold**", { code: true })]);
    assert.equal(md, "`**not bold**`");
    const rt = markdownToRichText(md);
    assert.equal(rt[0]!.plain_text, "**not bold**");
    assert.equal((rt[0] as any).annotations.code, true);
  });

  it("code run with underscores is NOT escaped", () => {
    const md = richTextToMarkdown([text("my_func_name", { code: true })]);
    assert.equal(md, "`my_func_name`");
  });

  it("bold run with asterisks still escapes (emphasis context)", () => {
    const md = richTextToMarkdown([text("a*b", { bold: true })]);
    assert.match(md, /\*\*a\\\*b\*\*/);
    const rt = markdownToRichText(md);
    const full = rt.map(r => r.plain_text).join("");
    assert.equal(full, "a*b");
    assert.ok(rt.find(r => (r as any).annotations.bold));
  });

  it("purely intraword underscores are clean (no escaping)", () => {
    // Common in API field names, database property names
    for (const s of ["multi_select", "rich_text", "has_children", "a_b_c"]) {
      const md = richTextToMarkdown([text(s)]);
      assert.equal(md, s, `"${s}" should not be escaped`);
      const rt = markdownToRichText(md);
      assert.equal(rt[0]!.plain_text, s, `"${s}" must round-trip`);
    }
  });

  it("alphanum-surrounded asterisks survive a round-trip", () => {
    // Common in maths and wildcards. A single `*` with no partner stays bare;
    // a pair is escaped, because the parser now reads `5*x*2` as emphasis the
    // way CommonMark does, and leaving it bare would drop the asterisks.
    for (const s of ["2*3", "a*b", "5*x*2"]) {
      const md = richTextToMarkdown([text(s)]);
      const rt = markdownToRichText(md);
      assert.equal(rt.map((r) => r.plain_text).join(""), s, `"${s}" must round-trip`);
    }
    assert.equal(richTextToMarkdown([text("2*3")]), "2*3", "a lone * needs no escape");
  });
});

describe("escaping decided across the whole line", () => {
  it("does not invent emphasis from asterisks in adjacent runs", () => {
    // Neither run pairs up alone; the concatenation does.
    const md = richTextToMarkdown([text("5*x"), text(" and 2*3")]);
    const back = markdownToRichText(md);
    assert.ok(back.every((r) => !r.annotations.italic), md);
    assert.equal(back.map((r) => r.plain_text).join(""), "5*x and 2*3");
  });

  it("still leaves a lone literal asterisk unescaped", () => {
    assert.equal(richTextToMarkdown([text("2*3 = 6")]), "2*3 = 6");
  });

  it("keeps real emphasis working", () => {
    const back = markdownToRichText(richTextToMarkdown([text("hi", { italic: true })]));
    assert.equal(back.length, 1);
    assert.ok(back[0]!.annotations.italic);
  });
});

describe("literal dollars vs inline equations", () => {
  it("does not retype $x$ in prose as an equation", () => {
    const md = richTextToMarkdown([text("The variable $n$ is the count.")]);
    const back = markdownToRichText(md);
    assert.ok(back.every((r) => r.type !== "equation"), md);
    assert.equal(back.map((r) => r.plain_text).join(""), "The variable $n$ is the count.");
  });

  it("leaves currency alone", () => {
    assert.equal(richTextToMarkdown([text("$5 and $10")]), "$5 and $10");
  });

  it("still parses a real inline equation", () => {
    const back = markdownToRichText("before $x^2$ after");
    assert.ok(back.some((r) => r.type === "equation"));
  });
});

describe("inline code delimiters", () => {
  it("survives content containing a backtick", () => {
    const back = markdownToRichText(richTextToMarkdown([text("a`b", { code: true })]));
    assert.equal(back.length, 1);
    assert.equal(back[0]!.plain_text, "a`b");
    assert.ok(back[0]!.annotations.code);
  });

  it("keeps the plain form a single backtick", () => {
    assert.equal(richTextToMarkdown([text("x", { code: true })]), "`x`");
  });

  it("preserves leading and trailing spaces", () => {
    const back = markdownToRichText(richTextToMarkdown([text(" pad ", { code: true })]));
    assert.equal(back[0]!.plain_text, " pad ");
  });

  it("keeps annotations outside the code span", () => {
    const md = richTextToMarkdown([text("x", { code: true, bold: true })]);
    assert.equal(md, "**`x`**");
  });
});

describe("date mentions", () => {
  const dateMention = (start: string, end: string | null): RichText => ({
    type: "mention",
    mention: { type: "date", date: { start, end, time_zone: null } },
    annotations: { ...DEFAULT_ANNOTATIONS },
    plain_text: start,
    href: null,
  }) as RichText;

  it("round-trips a single date", () => {
    const back = markdownToRichText(richTextToMarkdown([dateMention("2024-01-01", null)]));
    assert.equal(back[0]!.type, "mention");
    assert.deepEqual((back[0] as { mention: { date: { start: string } } }).mention.date.start, "2024-01-01");
  });

  it("round-trips a range", () => {
    const back = markdownToRichText(richTextToMarkdown([dateMention("2024-01-01", "2024-01-05")]));
    const m = (back[0] as { mention: { date: { start: string; end: string } } }).mention;
    assert.equal(m.date.start, "2024-01-01");
    assert.equal(m.date.end, "2024-01-05");
  });

  it("leaves an angle-bracketed date in prose as text", () => {
    const back = markdownToRichText(richTextToMarkdown([text("due <2024-01-01> ok")]));
    assert.ok(back.every((r) => r.type === "text"));
    assert.equal(back.map((r) => r.plain_text).join(""), "due <2024-01-01> ok");
  });
});

describe("regressions found reviewing the escaping/code-span fixes", () => {
  it("does not inject delimiters between adjacent code runs", () => {
    // Notion caps a run at 2000 chars, so a longer inline code span arrives
    // split. One delimiter pair per run turned `a` + `b` into `a``b`.
    const md = richTextToMarkdown([text("a", { code: true }), text("b", { code: true })]);
    assert.equal(md, "`ab`");
    const back = markdownToRichText(md);
    assert.equal(back.length, 1);
    assert.equal(back[0]!.plain_text, "ab");
    assert.ok(back[0]!.annotations.code);
  });

  it("keeps a split code span byte-identical across repeated round-trips", () => {
    let runs: RichText[] = [text("x".repeat(2000), { code: true }), text("yz", { code: true })];
    for (let cycle = 0; cycle < 3; cycle++) {
      runs = markdownToRichText(richTextToMarkdown(runs));
      const content = runs.filter((r) => r.annotations.code).map((r) => r.plain_text).join("");
      assert.equal(content.length, 2002, `cycle ${cycle}`);
      assert.ok(content.endsWith("xyz"), `cycle ${cycle}: ${JSON.stringify(content.slice(-8))}`);
    }
  });

  it("still separates adjacent code runs that differ in annotation", () => {
    const md = richTextToMarkdown([text("a", { code: true, bold: true }), text("b", { code: true })]);
    assert.equal(md, "**`a`**`b`");
    const back = markdownToRichText(md);
    assert.equal(back.length, 2);
    assert.ok(back[0]!.annotations.bold && back[0]!.annotations.code);
    assert.ok(!back[1]!.annotations.bold && back[1]!.annotations.code);
  });

  for (const content of [" ", "  ", "\t"]) {
    it(`round-trips a code span of only whitespace: ${JSON.stringify(content)}`, () => {
      // CommonMark only strips the padding pair when the content is not all
      // spaces, so padding one was never taken back: " " came back as "   ".
      const back = markdownToRichText(richTextToMarkdown([text(content, { code: true })]));
      assert.equal(back.length, 1);
      assert.equal(back[0]!.plain_text, content);
      assert.ok(back[0]!.annotations.code);
    });
  }

  it("does not let an escaped dollar close an inline equation", () => {
    const runs: RichText[] = [
      text("a $b"),
      { type: "equation", equation: { expression: "c" }, annotations: { ...DEFAULT_ANNOTATIONS }, plain_text: "$c$", href: null } as unknown as RichText,
      text("d$ e"),
    ];
    const back = markdownToRichText(richTextToMarkdown(runs));
    // The equation degrades to text here (a closing $ cannot be followed by an
    // alphanumeric), but every character must survive. Previously the escaped
    // `\$` was taken as a closer, producing an equation whose expression was
    // `d\` and dropping the real one.
    assert.equal(back.map((r) => r.plain_text).join(""), "a $b$c$d$ e");
    assert.ok(back.every((r) => r.type !== "equation" || r.plain_text !== "$d\\$"));
  });

  it("still parses a real equation whose closer is followed by a space", () => {
    const back = markdownToRichText("cost $5 and $x^2$ more");
    const eq = back.filter((r) => r.type === "equation");
    assert.equal(eq.length, 1);
    assert.equal((eq[0] as unknown as { equation: { expression: string } }).equation.expression, "x^2");
  });

  it("scans asterisk emphasis in linear time", () => {
    // Every '*' followed by an alphanumeric and preceded by a space: no early
    // exit, no closer. The nested scan this replaced took 2.5s here.
    const chunk = "The handler takes *ctx and *req and *buf, then returns. ".repeat(4);
    const runs: RichText[] = [];
    for (let k = 0; k < 100; k++) { runs.push(text(chunk)); runs.push(text("term", { bold: true })); }
    const started = process.hrtime.bigint();
    richTextToMarkdown(runs);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 500, `took ${ms.toFixed(0)}ms for ${runs.length} runs`);
  });
});
