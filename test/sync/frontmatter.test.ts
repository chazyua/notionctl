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

  it("flags a divider-first document, because it is indistinguishable from broken front-matter", () => {
    // Deliberate: the leading --- is a front-matter delimiter in every major
    // static-site generator, and the sync path cannot tell this apart from a
    // corrupted block that still carries notion_id. page sync refuses and tells
    // the user to write the rule as *** instead.
    const { malformed } = extractFrontmatter("---\n\nprose\n\n---\n\nmore\n");
    assert.ok(malformed);
  });
});

describe("frontmatterBody — a block that will not parse is refused", () => {
  const broken = '---\ntitle: Test\nnotion_id: "abc123"\nbroken line without colon\n---\n\nReal body.\n';

  it("throws instead of returning the raw file as the body", () => {
    // On the parse-failure path `body` is the whole input, so a caller that
    // ignores `malformed` writes the delimiters and every YAML line — notion_id
    // included — onto the page as visible content.
    assert.throws(
      () => frontmatterBody(broken, "test.md"),
      (err: any) => {
        assert.equal(err.code, "USAGE");
        assert.match(err.message, /not valid YAML/);
        assert.match(err.message, /test\.md/);
        return true;
      },
    );
  });

  it("names the offending line so it can be fixed", () => {
    assert.throws(() => frontmatterBody(broken, "test.md"), /broken line without colon/);
  });

  it("offers the *** workaround for a file opening with a rule", () => {
    assert.throws(() => frontmatterBody(broken, "test.md"), (err: any) => {
      assert.ok(err.suggestions.some((s: string) => s.includes("***")));
      return true;
    });
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
