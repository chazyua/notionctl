import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter, reinsertFrontmatter } from "../../src/sync/frontmatter.js";

describe("extractFrontmatter", () => {
  it("extracts YAML delimited by triple-dashes", () => {
    const input = "---\ntitle: Hello\ncount: 3\n---\n\n# Body\n\nContent";
    const { data, body } = extractFrontmatter(input);
    assert.deepEqual(data, { title: "Hello", count: 3 });
    assert.equal(body, "# Body\n\nContent");
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
