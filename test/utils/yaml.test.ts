import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseYaml, stringifyYaml } from "../../src/utils/yaml.js";

describe("parseYaml", () => {
  it("parses simple key-value strings", () => {
    assert.deepEqual(parseYaml("key: value"), { key: "value" });
  });

  it("parses quoted strings", () => {
    assert.deepEqual(
      parseYaml('key: "with spaces and: colons"'),
      { key: "with spaces and: colons" },
    );
  });

  it("parses numbers", () => {
    assert.deepEqual(parseYaml("count: 42"), { count: 42 });
    assert.deepEqual(parseYaml("ratio: 3.14"), { ratio: 3.14 });
  });

  it("parses booleans", () => {
    assert.deepEqual(parseYaml("done: true"), { done: true });
    assert.deepEqual(parseYaml("done: false"), { done: false });
  });

  it("parses null values", () => {
    assert.deepEqual(parseYaml("x: null"), { x: null });
    assert.deepEqual(parseYaml("x: ~"), { x: null });
  });

  it("parses flow sequences", () => {
    assert.deepEqual(parseYaml("tags: [a, b, c]"), { tags: ["a", "b", "c"] });
  });

  it("parses flow sequences with quoted items", () => {
    assert.deepEqual(
      parseYaml('tags: ["has, comma", plain, "with space"]'),
      { tags: ["has, comma", "plain", "with space"] },
    );
  });

  it("parses ISO dates as strings (preserves original format)", () => {
    assert.deepEqual(parseYaml("due: 2026-04-15"), { due: "2026-04-15" });
    assert.deepEqual(
      parseYaml("due: 2026-04-15T10:00:00Z"),
      { due: "2026-04-15T10:00:00Z" },
    );
  });

  it("parses multiple key-value pairs", () => {
    const input = "title: Hello\ncount: 3\ntags: [x, y]";
    assert.deepEqual(parseYaml(input), {
      title: "Hello",
      count: 3,
      tags: ["x", "y"],
    });
  });

  it("ignores empty lines and comments", () => {
    const input = "# top comment\ntitle: Hello\n\n# middle\ncount: 3";
    assert.deepEqual(parseYaml(input), { title: "Hello", count: 3 });
  });

  it("preserves unrecognized string values as strings", () => {
    assert.deepEqual(parseYaml('status: "In Progress"'), { status: "In Progress" });
    assert.deepEqual(parseYaml("status: In Progress"), { status: "In Progress" });
  });
});

describe("stringifyYaml", () => {
  it("writes simple key-value", () => {
    assert.equal(stringifyYaml({ key: "value" }), "key: value");
  });

  it("quotes strings with special characters", () => {
    assert.equal(
      stringifyYaml({ key: "value: with colon" }),
      'key: "value: with colon"',
    );
  });

  it("quotes strings starting with YAML special characters", () => {
    assert.equal(stringifyYaml({ key: "[not a list]" }), 'key: "[not a list]"');
  });

  it("writes numbers and booleans unquoted", () => {
    assert.equal(stringifyYaml({ count: 42, done: true }), "count: 42\ndone: true");
  });

  it("writes null values", () => {
    assert.equal(stringifyYaml({ x: null }), "x: null");
  });

  it("writes arrays as flow sequences", () => {
    assert.equal(stringifyYaml({ tags: ["a", "b"] }), "tags: [a, b]");
  });

  it("quotes array items with special characters", () => {
    assert.equal(
      stringifyYaml({ tags: ["has, comma", "plain"] }),
      'tags: ["has, comma", plain]',
    );
  });

  it("round-trips structured input", () => {
    const input = {
      title: "Implement auth",
      count: 8,
      done: false,
      tags: ["backend", "security"],
      due: "2026-04-15",
    };
    const yaml = stringifyYaml(input);
    const parsed = parseYaml(yaml);
    assert.deepEqual(parsed, input);
  });
});
