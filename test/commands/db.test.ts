import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSimpleFilter, parseColumnSpec } from "../../src/commands/db.js";
import type { PropertySchema } from "../../src/properties/parse.js";

function schema(overrides: Record<string, Partial<PropertySchema>>): Record<string, PropertySchema> {
  const out: Record<string, PropertySchema> = {};
  for (const [name, override] of Object.entries(overrides)) {
    out[name] = { id: name, name, type: "rich_text", ...override } as PropertySchema;
  }
  return out;
}

describe("parseSimpleFilter — number comparisons", () => {
  const s = schema({ Count: { type: "number" } });

  it("= becomes equals", () => {
    assert.deepEqual(parseSimpleFilter("Count=10", s), {
      property: "Count",
      number: { equals: 10 },
    });
  });

  it("> becomes greater_than", () => {
    assert.deepEqual(parseSimpleFilter("Count>5", s), {
      property: "Count",
      number: { greater_than: 5 },
    });
  });

  it("< becomes less_than", () => {
    assert.deepEqual(parseSimpleFilter("Count<5", s), {
      property: "Count",
      number: { less_than: 5 },
    });
  });

  it(">= becomes greater_than_or_equal_to", () => {
    assert.deepEqual(parseSimpleFilter("Count>=5", s), {
      property: "Count",
      number: { greater_than_or_equal_to: 5 },
    });
  });

  it("<= becomes less_than_or_equal_to", () => {
    assert.deepEqual(parseSimpleFilter("Count<=5", s), {
      property: "Count",
      number: { less_than_or_equal_to: 5 },
    });
  });

  it("rejects non-numeric values", () => {
    assert.throws(() => parseSimpleFilter("Count=abc", s), /Invalid number/);
  });
});

describe("parseSimpleFilter — date comparisons", () => {
  const s = schema({ Due: { type: "date" } });

  it("= becomes equals", () => {
    assert.deepEqual(parseSimpleFilter("Due=2026-04-01", s), {
      property: "Due",
      date: { equals: "2026-04-01" },
    });
  });

  it("> becomes after", () => {
    assert.deepEqual(parseSimpleFilter("Due>2026-04-01", s), {
      property: "Due",
      date: { after: "2026-04-01" },
    });
  });

  it("< becomes before", () => {
    assert.deepEqual(parseSimpleFilter("Due<2026-04-01", s), {
      property: "Due",
      date: { before: "2026-04-01" },
    });
  });

  it(">= becomes on_or_after", () => {
    assert.deepEqual(parseSimpleFilter("Due>=2026-04-01", s), {
      property: "Due",
      date: { on_or_after: "2026-04-01" },
    });
  });

  it("<= becomes on_or_before", () => {
    assert.deepEqual(parseSimpleFilter("Due<=2026-04-01", s), {
      property: "Due",
      date: { on_or_before: "2026-04-01" },
    });
  });
});

describe("parseSimpleFilter — multi_select", () => {
  const s = schema({ Tags: { type: "multi_select" } });

  it("single value uses contains", () => {
    assert.deepEqual(parseSimpleFilter("Tags=urgent", s), {
      property: "Tags",
      multi_select: { contains: "urgent" },
    });
  });

  it("comma-separated values become AND of contains", () => {
    assert.deepEqual(parseSimpleFilter("Tags=urgent,important", s), {
      and: [
        { property: "Tags", multi_select: { contains: "urgent" } },
        { property: "Tags", multi_select: { contains: "important" } },
      ],
    });
  });

  it("trims whitespace around values", () => {
    assert.deepEqual(parseSimpleFilter("Tags=a, b , c", s), {
      and: [
        { property: "Tags", multi_select: { contains: "a" } },
        { property: "Tags", multi_select: { contains: "b" } },
        { property: "Tags", multi_select: { contains: "c" } },
      ],
    });
  });

  it("rejects comparison operators", () => {
    assert.throws(() => parseSimpleFilter("Tags>urgent", s), /only supports =/);
  });
});

describe("parseSimpleFilter — type errors", () => {
  it("unknown property throws INVALID_PROPERTY", () => {
    assert.throws(
      () => parseSimpleFilter("Nope=x", schema({ Real: { type: "select" } })),
      /Unknown property/,
    );
  });

  it("select rejects > operator", () => {
    assert.throws(
      () => parseSimpleFilter("Status>Done", schema({ Status: { type: "select" } })),
      /only supports =/,
    );
  });

  it("missing operator throws", () => {
    assert.throws(
      () => parseSimpleFilter("JustAKey", schema({ JustAKey: { type: "number" } })),
      /Invalid filter/,
    );
  });
});

describe("parseColumnSpec", () => {
  it("parses text column", () => {
    assert.deepEqual(parseColumnSpec("Notes=text"), {
      name: "Notes",
      schema: { rich_text: {} },
    });
  });

  it("parses number column with default format", () => {
    assert.deepEqual(parseColumnSpec("Count=number"), {
      name: "Count",
      schema: { number: { format: "number" } },
    });
  });

  it("parses checkbox column", () => {
    assert.deepEqual(parseColumnSpec("Done=checkbox"), {
      name: "Done",
      schema: { checkbox: {} },
    });
  });

  it("parses date column", () => {
    assert.deepEqual(parseColumnSpec("Due=date"), {
      name: "Due",
      schema: { date: {} },
    });
  });

  it("parses select with options", () => {
    const result = parseColumnSpec("Status=select:Todo,Doing,Done");
    assert.equal(result.name, "Status");
    assert.deepEqual((result.schema as any).select.options, [
      { name: "Todo" },
      { name: "Doing" },
      { name: "Done" },
    ]);
  });

  it("parses select with no options", () => {
    assert.deepEqual(parseColumnSpec("Status=select"), {
      name: "Status",
      schema: { select: { options: [] } },
    });
  });

  it("parses multi_select with options", () => {
    const result = parseColumnSpec("Tags=multi_select:urgent,important");
    assert.equal(result.name, "Tags");
    assert.deepEqual((result.schema as any).multi_select.options, [
      { name: "urgent" },
      { name: "important" },
    ]);
  });

  it("parses url, email, phone", () => {
    assert.deepEqual(parseColumnSpec("Link=url"), { name: "Link", schema: { url: {} } });
    assert.deepEqual(parseColumnSpec("Contact=email"), { name: "Contact", schema: { email: {} } });
    assert.deepEqual(parseColumnSpec("Phone=phone"), { name: "Phone", schema: { phone_number: {} } });
  });

  it("parses people and files", () => {
    assert.deepEqual(parseColumnSpec("Assignee=people"), { name: "Assignee", schema: { people: {} } });
    assert.deepEqual(parseColumnSpec("Attachments=files"), { name: "Attachments", schema: { files: {} } });
  });

  it("rejects unknown type", () => {
    assert.throws(() => parseColumnSpec("Foo=formula"), /Unsupported column type/);
  });

  it("rejects spec without =", () => {
    assert.throws(() => parseColumnSpec("JustName"), /Invalid column spec/);
  });
});
