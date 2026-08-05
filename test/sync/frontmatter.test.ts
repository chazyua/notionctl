import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter, frontmatterBody, reinsertFrontmatter } from "../../src/sync/frontmatter.js";

describe("extractFrontmatter", () => {
  it("extracts YAML delimited by triple-dashes", () => {
    const input = "---\ntitle: Hello\ncount: 3\n---\n\n# Body\n\nContent";
    const { data, body, malformed } = extractFrontmatter(input);
    assert.deepEqual(data, { title: "Hello", count: 3 });
    assert.equal(body, "# Body\n\nContent");
    assert.equal(malformed, undefined, "valid front-matter must not be flagged");
  });

  it("returns empty data when no front-matter", () => {
    const input = "# Just a heading\n\nBody text";
    const { data, body } = extractFrontmatter(input);
    assert.deepEqual(data, {});
    assert.equal(body, input);
  });

  it("handles front-matter with blank line before body", () => {
    const input = "---\nkey: value\n---\n\nBody";
    const { data, body } = extractFrontmatter(input);
    assert.deepEqual(data, { key: "value" });
    assert.equal(body, "Body");
  });

  it("ignores leading whitespace before ---", () => {
    const input = "\n---\nkey: v\n---\nbody";
    const { data } = extractFrontmatter(input);
    assert.deepEqual(data, { key: "v" });
  });
});

describe("reinsertFrontmatter", () => {
  it("prepends front-matter to body", () => {
    const out = reinsertFrontmatter({ title: "Hello" }, "# Body");
    assert.equal(out, "---\ntitle: Hello\n---\n\n# Body");
  });

  it("empty front-matter omits the delimiters", () => {
    assert.equal(reinsertFrontmatter({}, "# Body"), "# Body");
  });

  it("round-trips through extract", () => {
    const input = { title: "Hello", count: 3, tags: ["a", "b"] };
    const reinserted = reinsertFrontmatter(input, "Body");
    const { data } = extractFrontmatter(reinserted);
    assert.deepEqual(data, input);
  });
});


describe("extractFrontmatter — malformed blocks are distinguishable", () => {
  it("reports a block whose delimiters are present but whose YAML is invalid", () => {
    const input = [
      "---",
      'notion_id: "abc"',
      "this line has no colon",
      "---",
      "",
      "Body",
    ].join("\n");
    const { data, body, malformed } = extractFrontmatter(input);
    assert.ok(malformed, "a broken block must be reported, not silently swallowed");
    assert.match(malformed, /no key/);
    // The body is still the whole input so nothing is lost if a caller ignores it.
    assert.deepEqual(data, {});
    assert.equal(body, input);
  });

  it("does not flag a file that simply has no front-matter", () => {
    const { malformed } = extractFrontmatter("# Title\n\nJust prose.\n");
    assert.equal(malformed, undefined, "a first sync must stay legitimate");
  });

  it("does not flag an unclosed opening delimiter", () => {
    // Matches Jekyll/Hugo: without a closing delimiter there is no front-matter,
    // and the leading --- is just the document's first line.
    const { malformed } = extractFrontmatter("---\n\nprose with no closing rule\n");
    assert.equal(malformed, undefined);
  });

  it("reads front-matter that sits behind a UTF-8 BOM", () => {
    // PowerShell and some Windows editors write a BOM by default. Without
    // stripping it the opening delimiter never matches, valid front-matter
    // reads as none, and page sync creates a duplicate page.
    const input = '\uFEFF---\nnotion_id: "abc"\n---\n\nBody\n';
    const { data, body, malformed } = extractFrontmatter(input);
    assert.equal(malformed, undefined);
    assert.equal(data.notion_id, "abc", "a BOM must not hide the front-matter");
    assert.equal(body, "Body\n");
  });

  it("strips a BOM from the body when there is no front-matter", () => {
    const { data, body } = extractFrontmatter("\uFEFF# Title\n");
    assert.deepEqual(data, {});
    assert.equal(body, "# Title\n", "a BOM must not leak into page content");
  });

  it("a divider-first document read back from notionctl is not front-matter", () => {
    // The read path now writes a divider as ***, so its own output can never be
    // mistaken for a front-matter block — which is what used to cost such a
    // page its opening section, silently, whenever the prose parsed as YAML.
    const { data, body, malformed } = extractFrontmatter("***\n\nStatus: Done\n\n***\n\nReal content\n");
    assert.equal(malformed, undefined);
    assert.deepEqual(data, {});
    assert.match(body, /Status: Done/);
    assert.match(body, /Real content/);
  });

  it("front-matter that opens with a blank line is still front-matter", () => {
    // Legal for YAML, Jekyll and Hugo. Rejecting it would put the keys on the
    // page as content — and with no parse error, nothing would have warned.
    const { data, body } = extractFrontmatter("---\n\ntitle: My Post\ntags: [a, b]\n---\n\nBody\n");
    assert.equal(data.title, "My Post");
    assert.equal(body, "Body\n");
  });

  it("a block carrying notion_id is always front-matter, whatever its shape", () => {
    // Failing to see notion_id is what makes page sync create a duplicate and
    // orphan the original, so the id wins over the horizontal-rule heuristic.
    const { data } = extractFrontmatter("---\n\nnotion_id: abc\n---\n\nBody\n");
    assert.equal(data.notion_id, "abc");
  });

  it("every shape our own writer produces is recognised", () => {
    const written = reinsertFrontmatter({ notion_id: "abc", notion_hash: "sha256:x" }, "Body\n");
    assert.equal(extractFrontmatter(written).data.notion_id, "abc");
  });

  it("real front-matter still parses", () => {
    const { data, body } = extractFrontmatter("---\ntitle: X\nnotion_id: abc\n---\n\nBody\n");
    assert.equal(data.title, "X");
    assert.equal(body, "Body\n");
  });
});

describe("frontmatterBody — a block that will not parse is kept, not refused", () => {
  const broken = '---\ntitle: Test\nnotion_id: "abc123"\nbroken line without colon\n---\n\nReal body.\n';
  const dividerFirst = "---\n\nprose paragraph\n\n---\n\nmore prose\n";

  function captureStderr(fn: () => string): { body: string; warned: string } {
    const original = process.stderr.write.bind(process.stderr);
    let warned = "";
    (process.stderr as any).write = (chunk: any) => { warned += String(chunk); return true; };
    try {
      return { body: fn(), warned };
    } finally {
      (process.stderr as any).write = original;
    }
  }

  it("keeps a document that opens with a horizontal rule", () => {
    // This is the shape `block get` emits for a page starting with a divider,
    // and what any document underlining its first heading with --- looks like.
    // Refusing it broke round-tripping notionctl's own output.
    const { body } = captureStderr(() => frontmatterBody(dividerFirst, "notes.md"));
    assert.equal(body, dividerFirst, "content must not be dropped or refused");
  });

  it("reports the parse failure rather than staying silent", () => {
    const { warned } = captureStderr(() => frontmatterBody(broken, "test.md"));
    assert.match(warned, /not valid YAML/);
    assert.match(warned, /test\.md/);
    assert.match(warned, /broken line without colon/, "names the offending line");
    assert.match(warned, /\*\*\*/, "offers the horizontal-rule workaround");
  });

  it("refuses for a command that replaces what is already there", () => {
    // page update deletes every existing block first, so writing an ambiguous
    // file would destroy remote content that the file cannot restore.
    assert.throws(
      () => frontmatterBody(broken, "notes.md", true),
      (err: any) => {
        assert.equal(err.code, "USAGE");
        assert.match(err.message, /not valid YAML/);
        assert.ok(err.suggestions.some((x: string) => /replaces/.test(x)));
        return true;
      },
    );
  });

  it("still keeps the file for a command that only adds", () => {
    const { body } = captureStderr(() => frontmatterBody(dividerFirst, "notes.md", false));
    assert.equal(body, dividerFirst);
  });

  it("never loses content, whichever way the block was meant", () => {
    const { body } = captureStderr(() => frontmatterBody(broken, "test.md"));
    assert.match(body, /Real body\./);
  });

  it("valid front-matter returns only the body", () => {
    assert.equal(frontmatterBody("---\ntitle: Fine\n---\n\nBody here.\n", "t.md"), "Body here.\n");
  });

  it("a file with no front-matter is returned unchanged", () => {
    assert.equal(frontmatterBody("Just prose.\n", "t.md"), "Just prose.\n");
  });

  it("an unclosed opener is not front-matter and is not refused", () => {
    const input = "---\nunclosed: opener\n\nstill body\n";
    assert.equal(frontmatterBody(input, "t.md"), input);
  });
});
