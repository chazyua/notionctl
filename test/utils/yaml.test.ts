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

  it("quotes empty strings", () => {
    assert.equal(stringifyYaml({ key: "" }), 'key: ""');
  });

  it("quotes string 'true' to avoid boolean ambiguity", () => {
    const yaml = stringifyYaml({ val: "true" });
    assert.equal(yaml, 'val: "true"');
    const parsed = parseYaml(yaml);
    assert.equal(parsed.val, "true");
    assert.equal(typeof parsed.val, "string");
  });

  it("quotes string 'null' to avoid null ambiguity", () => {
    const yaml = stringifyYaml({ val: "null" });
    assert.equal(yaml, 'val: "null"');
    const parsed = parseYaml(yaml);
    assert.equal(parsed.val, "null");
    assert.equal(typeof parsed.val, "string");
  });

  it("round-trips strings with colons", () => {
    const input = { notion_id: "abc-123:def-456" };
    const yaml = stringifyYaml(input);
    const parsed = parseYaml(yaml);
    assert.equal(parsed.notion_id, "abc-123:def-456");
  });

  it("round-trips strings with hash symbols", () => {
    const input = { url: "https://example.com/page#section" };
    const yaml = stringifyYaml(input);
    const parsed = parseYaml(yaml);
    assert.equal(parsed.url, "https://example.com/page#section");
  });

  it("round-trips negative numbers", () => {
    const input = { score: -42 };
    const yaml = stringifyYaml(input);
    const parsed = parseYaml(yaml);
    assert.equal(parsed.score, -42);
  });

  it("round-trips float numbers", () => {
    const input = { score: 3.14 };
    const yaml = stringifyYaml(input);
    const parsed = parseYaml(yaml);
    assert.equal(parsed.score, 3.14);
  });

  it("escapes newlines and round-trips them", () => {
    const input = { title: "line1\nline2" };
    const yaml = stringifyYaml(input);
    assert.equal(yaml, 'title: "line1\\nline2"');
    assert.equal(yaml.split("\n").length, 1);
    assert.deepEqual(parseYaml(yaml), input);
  });

  it("escapes carriage returns and round-trips them", () => {
    const input = { title: "a\rb" };
    assert.deepEqual(parseYaml(stringifyYaml(input)), input);
  });

  it("escapes embedded double quotes and round-trips them", () => {
    const input = { title: 'she said "hi"' };
    assert.deepEqual(parseYaml(stringifyYaml(input)), input);
  });

  it("escapes literal backslashes and round-trips them", () => {
    const input = { path: "C:\\Users\\foo" };
    assert.deepEqual(parseYaml(stringifyYaml(input)), input);
  });

  it("unescapes quoted items inside flow sequences", () => {
    // regression: parseFlowSequence used to keep raw \" and \n characters
    assert.deepEqual(
      parseYaml('tags: ["one", "two\\"quoted", "three"]'),
      { tags: ["one", 'two"quoted', "three"] },
    );
    assert.deepEqual(
      parseYaml('tags: ["a\\nb", "c"]'),
      { tags: ["a\nb", "c"] },
    );
  });

  it("prevents YAML key injection via newline-bearing values", () => {
    // Attacker-controlled Notion title containing a newline + fake key
    const input = { title: "Hello\nnotion_token: injected" };
    const yaml = stringifyYaml(input);
    // Output must be a single physical line — no bare newline in value
    assert.equal(yaml.split("\n").length, 1, "newline must be escaped, not emitted bare");
    const parsed = parseYaml(yaml);
    assert.deepEqual(parsed, input);
    // Injected key must not appear as a separate top-level key
    assert.equal((parsed as Record<string, unknown>).notion_token, undefined);
  });
});

describe("YAML single-quoted string escaping", () => {
  it("unescapes doubled single quotes per YAML spec", () => {
    // YAML spec: 'O''Brien' → O'Brien
    const result = parseYaml("name: 'O''Brien'");
    assert.deepEqual(result, { name: "O'Brien" });
  });

  it("single-quoted string without escapes", () => {
    const result = parseYaml("name: 'simple'");
    assert.deepEqual(result, { name: "simple" });
  });

  it("single-quoted string with multiple doubled quotes", () => {
    const result = parseYaml("name: 'it''s a ''test'''");
    assert.deepEqual(result, { name: "it's a 'test'" });
  });
});
