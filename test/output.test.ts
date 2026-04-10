import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseFormat,
  renderJson,
  renderTable,
  renderCsv,
  renderMarkdown,
} from "../src/output.js";

describe("output.chooseFormat", () => {
  it("honors explicit --format when provided", () => {
    assert.equal(chooseFormat("json", { isTty: true, defaultFormat: "table" }), "json");
    assert.equal(chooseFormat("md", { isTty: false, defaultFormat: "json" }), "md");
  });

  it("uses default when TTY and no explicit format", () => {
    assert.equal(chooseFormat(undefined, { isTty: true, defaultFormat: "table" }), "table");
    assert.equal(chooseFormat(undefined, { isTty: true, defaultFormat: "md" }), "md");
  });

  it("forces JSON when piped (non-TTY)", () => {
    assert.equal(chooseFormat(undefined, { isTty: false, defaultFormat: "table" }), "json");
    assert.equal(chooseFormat(undefined, { isTty: false, defaultFormat: "md" }), "md");
    // md stays md because it's machine-readable for our use
  });
});

describe("output.renderJson", () => {
  it("produces pretty-printed JSON with 2-space indent", () => {
    const out = renderJson({ id: "abc", name: "Test" });
    assert.equal(out, '{\n  "id": "abc",\n  "name": "Test"\n}');
  });
});

describe("output.renderTable", () => {
  it("renders rows as aligned table", () => {
    const out = renderTable({
      columns: ["ID", "Name"],
      rows: [
        ["abc-12", "Alpha"],
        ["xyz-34", "Bravo bravo"],
      ],
    });
    const lines = out.split("\n");
    assert.equal(lines.length, 4);  // header, separator, 2 rows
    assert.match(lines[0]!, /ID\s+Name/);
    assert.match(lines[2]!, /abc-12\s+Alpha/);
    assert.match(lines[3]!, /xyz-34\s+Bravo bravo/);
  });

  it("handles empty rows", () => {
    const out = renderTable({ columns: ["A", "B"], rows: [] });
    const lines = out.split("\n");
    assert.equal(lines.length, 2);  // header + separator only
  });
});

describe("output.renderCsv", () => {
  it("escapes values containing commas", () => {
    const out = renderCsv({ columns: ["Name", "Notes"], rows: [["Alice", "foo, bar"]] });
    assert.equal(out, 'Name,Notes\nAlice,"foo, bar"');
  });

  it("escapes values containing double quotes", () => {
    const out = renderCsv({ columns: ["Name"], rows: [['He said "hi"']] });
    assert.equal(out, 'Name\n"He said ""hi"""');
  });

  it("escapes values containing newlines", () => {
    const out = renderCsv({ columns: ["Name"], rows: [["line1\nline2"]] });
    assert.equal(out, 'Name\n"line1\nline2"');
  });
});

describe("output.renderMarkdown", () => {
  it("passes through markdown content unchanged", () => {
    const md = "# Heading\n\nSome **bold** text.";
    assert.equal(renderMarkdown(md), md);
  });
});
