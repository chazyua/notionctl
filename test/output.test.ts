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

describe("output.renderTable — edge cases", () => {
  it("handles single-column table", () => {
    const out = renderTable({ columns: ["Name"], rows: [["Alice"], ["Bob"]] });
    const lines = out.split("\n");
    assert.equal(lines.length, 4);
    assert.match(lines[2]!, /Alice/);
  });

  it("handles cells wider than column header", () => {
    const out = renderTable({
      columns: ["A"],
      rows: [["Very long cell content"]],
    });
    const lines = out.split("\n");
    // Column width should adapt to the widest cell
    assert.ok(lines[1]!.length >= "Very long cell content".length);
  });

  it("handles empty string cells", () => {
    const out = renderTable({
      columns: ["A", "B"],
      rows: [["", "value"], ["value", ""]],
    });
    assert.ok(out.includes("value"));
  });

  it("handles many columns", () => {
    const cols = Array.from({ length: 10 }, (_, i) => `Col${i}`);
    const row = Array.from({ length: 10 }, (_, i) => `val${i}`);
    const out = renderTable({ columns: cols, rows: [row] });
    assert.ok(out.includes("Col0"));
    assert.ok(out.includes("val9"));
  });

  it("aligns CJK-wide characters correctly (BUG-C)", () => {
    const out = renderTable({
      columns: ["Name", "Value"],
      rows: [
        ["日本語", "Japanese"],
        ["plain", "abc"],
      ],
    });
    const lines = out.split("\n");
    // Count visual width (not UTF-16 length) of everything before the second column.
    const visualWidth = (s: string): number => {
      let w = 0;
      for (const ch of s) {
        const code = ch.codePointAt(0)!;
        if (
          (code >= 0x2E80 && code <= 0x9FFF) ||
          (code >= 0xFF00 && code <= 0xFF60) ||
          (code >= 0x1F300 && code <= 0x1FAFF)
        ) w += 2;
        else w += 1;
      }
      return w;
    };
    const row1 = lines[2]!;
    const row2 = lines[3]!;
    const prefix1 = row1.slice(0, row1.indexOf("Japanese"));
    const prefix2 = row2.slice(0, row2.indexOf("abc"));
    assert.equal(
      visualWidth(prefix1),
      visualWidth(prefix2),
      "column 2 must start at the same visual column on every row",
    );
  });

  it("replaces embedded newlines inside a cell (BUG-C)", () => {
    const out = renderTable({
      columns: ["A", "B"],
      rows: [["line1\nline2", "tail"]],
    });
    const lines = out.split("\n");
    // Header + separator + one data row = 3 total (no phantom rows from the \n)
    assert.equal(lines.length, 3, "embedded \\n must not spawn extra rows");
    assert.ok(lines[2]!.includes("tail"));
  });
});

describe("output.renderCsv — edge cases", () => {
  it("handles empty table", () => {
    const out = renderCsv({ columns: ["A", "B"], rows: [] });
    assert.equal(out, "A,B");
  });

  it("handles values with all special characters", () => {
    const out = renderCsv({
      columns: ["Data"],
      rows: [['He said "hello, world"\nand left']],
    });
    // Should be properly escaped
    assert.ok(out.includes('"'), "should contain quotes for escaping");
  });

  it("plain values are not quoted", () => {
    const out = renderCsv({ columns: ["A"], rows: [["simple"]] });
    assert.equal(out, "A\nsimple");
  });
});
