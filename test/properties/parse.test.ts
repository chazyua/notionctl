import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseProperty, parsePropertyFlag } from "../../src/properties/parse.js";
import type { PropertySchema } from "../../src/properties/parse.js";

const schema: Record<string, PropertySchema> = {
  Title: { type: "title" },
  Description: { type: "rich_text" },
  Points: { type: "number" },
  Status: { type: "select" },
  State: { type: "status" },
  Tags: { type: "multi_select" },
  Due: { type: "date" },
  Done: { type: "checkbox" },
  Website: { type: "url" },
  Email: { type: "email" },
  Phone: { type: "phone_number" },
  Assignee: { type: "people" },
  Assignees: { type: "people" },
  Blocks: { type: "relation" },
  Attachment: { type: "files" },
};

describe("parseProperty — writable types", () => {
  it("title as plain string", () => {
    const out = parseProperty(schema, "Title", "Implement auth");
    assert.deepEqual(out, {
      title: [{ type: "text", text: { content: "Implement auth", link: null } }],
    });
  });

  it("rich_text as plain string", () => {
    const out = parseProperty(schema, "Description", "see docs");
    assert.deepEqual(out, {
      rich_text: [{ type: "text", text: { content: "see docs", link: null } }],
    });
  });

  it("number integer", () => {
    assert.deepEqual(parseProperty(schema, "Points", "8"), { number: 8 });
  });

  it("number float", () => {
    assert.deepEqual(parseProperty(schema, "Points", "8.5"), { number: 8.5 });
  });

  it("select by name", () => {
    assert.deepEqual(parseProperty(schema, "Status", "Done"), { select: { name: "Done" } });
  });

  it("status by name", () => {
    assert.deepEqual(parseProperty(schema, "State", "In Progress"), {
      status: { name: "In Progress" },
    });
  });

  it("multi_select flow sequence", () => {
    assert.deepEqual(parseProperty(schema, "Tags", "[backend,security]"), {
      multi_select: [{ name: "backend" }, { name: "security" }],
    });
  });

  it("multi_select with quoted values containing commas", () => {
    assert.deepEqual(parseProperty(schema, "Tags", '["has, comma",plain]'), {
      multi_select: [{ name: "has, comma" }, { name: "plain" }],
    });
  });

  it("date single day", () => {
    assert.deepEqual(parseProperty(schema, "Due", "2026-04-15"), {
      date: { start: "2026-04-15", end: null },
    });
  });

  it("date range", () => {
    assert.deepEqual(parseProperty(schema, "Due", "2026-04-15..2026-04-30"), {
      date: { start: "2026-04-15", end: "2026-04-30" },
    });
  });

  it("date with time", () => {
    assert.deepEqual(parseProperty(schema, "Due", "2026-04-15T10:00:00Z"), {
      date: { start: "2026-04-15T10:00:00Z", end: null },
    });
  });

  it("checkbox true/false", () => {
    assert.deepEqual(parseProperty(schema, "Done", "true"), { checkbox: true });
    assert.deepEqual(parseProperty(schema, "Done", "false"), { checkbox: false });
  });

  it("checkbox accepts lenient truthy values", () => {
    for (const v of ["true", "TRUE", "True", "yes", "YES", "y", "1", "on"]) {
      assert.deepEqual(parseProperty(schema, "Done", v), { checkbox: true }, `value=${v}`);
    }
  });

  it("checkbox accepts lenient falsy values", () => {
    for (const v of ["false", "FALSE", "False", "no", "NO", "n", "0", "off"]) {
      assert.deepEqual(parseProperty(schema, "Done", v), { checkbox: false }, `value=${v}`);
    }
  });

  it("url, email, phone_number", () => {
    assert.deepEqual(parseProperty(schema, "Website", "https://x.com"), { url: "https://x.com" });
    assert.deepEqual(parseProperty(schema, "Email", "a@b.com"), { email: "a@b.com" });
    assert.deepEqual(parseProperty(schema, "Phone", "+1-555-0100"), { phone_number: "+1-555-0100" });
  });

  it("people with user: prefix (canonical)", () => {
    assert.deepEqual(parseProperty(schema, "Assignee", "user:abc-123"), {
      people: [{ id: "abc-123" }],
    });
  });

  it("people list with canonical ids", () => {
    assert.deepEqual(
      parseProperty(schema, "Assignees", "[user:abc-123,user:def-456]"),
      { people: [{ id: "abc-123" }, { id: "def-456" }] },
    );
  });

  it("relation by page: prefix", () => {
    assert.deepEqual(parseProperty(schema, "Blocks", "[page:abc-123]"), {
      relation: [{ id: "abc-123" }],
    });
  });

  it("files with url: prefix", () => {
    assert.deepEqual(parseProperty(schema, "Attachment", 'url:"https://ex.com/f.pdf"'), {
      files: [{ name: "f.pdf", external: { url: "https://ex.com/f.pdf" } }],
    });
  });

  it("unknown property name throws", () => {
    assert.throws(() => parseProperty(schema, "Nonexistent", "x"));
  });
});

describe("parsePropertyFlag", () => {
  it("splits on first unquoted =", () => {
    assert.deepEqual(parsePropertyFlag("Title=Hello"), { key: "Title", value: "Hello" });
  });

  it("handles = inside quoted value", () => {
    assert.deepEqual(
      parsePropertyFlag('Desc="a=b"'),
      { key: "Desc", value: '"a=b"' },
    );
  });

  it("throws on flag without =", () => {
    assert.throws(() => parsePropertyFlag("Title"));
  });

  it("handles value with spaces", () => {
    assert.deepEqual(
      parsePropertyFlag("Title=Hello World"),
      { key: "Title", value: "Hello World" },
    );
  });

  it("handles key with spaces (trimmed)", () => {
    assert.deepEqual(
      parsePropertyFlag("  Title  = Value "),
      { key: "Title", value: "Value" },
    );
  });

  it("handles empty value", () => {
    assert.deepEqual(
      parsePropertyFlag("Title="),
      { key: "Title", value: "" },
    );
  });
});

describe("parseProperty — error cases", () => {
  it("invalid number throws", () => {
    assert.throws(
      () => parseProperty(schema, "Points", "not-a-number"),
      /must be a number/,
    );
  });

  it("people without user: prefix throws", () => {
    assert.throws(
      () => parseProperty(schema, "Assignee", "john"),
      /user:<id>/,
    );
  });

  it("relation without page: prefix throws", () => {
    assert.throws(
      () => parseProperty(schema, "Blocks", "some-id"),
      /page:<id>/,
    );
  });

  it("files without url: or file: prefix throws", () => {
    assert.throws(
      () => parseProperty(schema, "Attachment", "https://example.com/file.pdf"),
      /url: or file:/,
    );
  });

  it("near-miss property name suggests correction", () => {
    try {
      parseProperty(schema, "Statis", "Done");
      assert.fail("should throw");
    } catch (e: any) {
      assert.ok(e.suggestions?.some((s: string) => s.includes("Status")), "should suggest Status");
    }
  });

  it("checkbox rejects ambiguous values with a clear error", () => {
    assert.throws(
      () => parseProperty(schema, "Done", "maybe"),
      /checkbox/,
    );
  });

  it("checkbox with unrecognized string throws", () => {
    assert.throws(
      () => parseProperty(schema, "Done", "banana"),
      /must be true\/false/,
    );
  });
});

describe("property parsing edge cases", () => {
  it("checkbox accepts True/TRUE/1/yes/on as true", () => {
    for (const v of ["True", "TRUE", "1", "yes", "YES", "on", "y"]) {
      assert.deepEqual(parseProperty(schema, "Done", v), { checkbox: true }, `expected ${v} to be true`);
    }
  });

  it("checkbox accepts False/FALSE/0/no/off as false", () => {
    for (const v of ["False", "FALSE", "0", "no", "NO", "off", "n"]) {
      assert.deepEqual(parseProperty(schema, "Done", v), { checkbox: false }, `expected ${v} to be false`);
    }
  });

  it("date range with more than one '..' is rejected", () => {
    assert.throws(
      () => parseProperty(schema, "Due", "2026-04-10..2026-04-15..2026-04-20"),
      /date range/i,
    );
  });

  it("empty select value becomes null to clear the property", () => {
    assert.deepEqual(parseProperty(schema, "Status", ""), { select: null });
  });

  it("empty date value becomes null to clear the property", () => {
    assert.deepEqual(parseProperty(schema, "Due", ""), { date: null });
  });

  it("empty number value becomes null to clear the property", () => {
    // Number("") is 0 and passes isFinite, so this used to overwrite the real
    // value with 0 — and left no way to clear a number at all.
    assert.deepEqual(parseProperty(schema, "Points", ""), { number: null });
  });

  it("number still parses zero as a real value", () => {
    assert.deepEqual(parseProperty(schema, "Points", "0"), { number: 0 });
  });

  it("date range with missing start is rejected", () => {
    assert.throws(
      () => parseProperty(schema, "Due", "..2026-04-20"),
      /needs both start and end/i,
    );
  });

  it("date range with missing end is rejected", () => {
    assert.throws(
      () => parseProperty(schema, "Due", "2026-04-10.."),
      /needs both start and end/i,
    );
  });

  it("parsePropertyFlag strips quotes from the key", () => {
    assert.deepEqual(parsePropertyFlag('"Title"=Hello'), { key: "Title", value: "Hello" });
    assert.deepEqual(parsePropertyFlag("'Title'=Hello"), { key: "Title", value: "Hello" });
  });
});

describe("files property url: with trailing slash", () => {
  it("uses 'file' as name when URL ends with /", () => {
    const result = parseProperty(schema, "Attachment", "url:https://example.com/");
    assert.deepEqual(result, {
      files: [{ name: "file", external: { url: "https://example.com/" } }],
    });
  });

  it("extracts filename from URL path", () => {
    const result = parseProperty(schema, "Attachment", "url:https://example.com/doc.pdf");
    assert.deepEqual(result, {
      files: [{ name: "doc.pdf", external: { url: "https://example.com/doc.pdf" } }],
    });
  });
});

describe("people and relation accept several values without brackets", () => {
  const schema: Record<string, PropertySchema> = {
    Assignee: { type: "people" },
    Blocks: { type: "relation" },
  };
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  it("an unbracketed people list is split, not swallowed into one id", () => {
    // A greedy `^user:(.+)$` used to produce a single id of "A,user:B",
    // which Notion rejected with a confusing error.
    const out = parseProperty(schema, "Assignee", `user:${A},user:${B}`) as any;
    assert.deepEqual(out.people, [{ id: A }, { id: B }]);
  });

  it("an unbracketed relation list is split too", () => {
    const out = parseProperty(schema, "Blocks", `page:${A},page:${B}`) as any;
    assert.deepEqual(out.relation, [{ id: A }, { id: B }]);
  });

  it("the bracketed form still works", () => {
    const out = parseProperty(schema, "Assignee", `[user:${A}, user:${B}]`) as any;
    assert.deepEqual(out.people, [{ id: A }, { id: B }]);
  });

  it("a single value still works", () => {
    assert.deepEqual((parseProperty(schema, "Assignee", `user:${A}`) as any).people, [{ id: A }]);
    assert.deepEqual((parseProperty(schema, "Blocks", `page:${A}`) as any).relation, [{ id: A }]);
  });

  it("an empty value clears the property, as it does for multi_select", () => {
    assert.deepEqual((parseProperty(schema, "Assignee", "") as any).people, []);
    assert.deepEqual((parseProperty(schema, "Blocks", "") as any).relation, []);
  });

  it("a value missing its prefix reports the offending item and how to fix it", () => {
    assert.throws(
      () => parseProperty(schema, "Assignee", `user:${A},${B}`),
      (err: any) => {
        assert.match(err.message, new RegExp(B), "names the item that failed");
        assert.ok(err.suggestions.some((s: string) => s.includes("user:<id>,user:<id>")));
        return true;
      },
    );
  });
});
