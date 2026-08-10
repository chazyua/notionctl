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

  it("aligns CJK-wide characters correctly", () => {
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

  it("replaces embedded newlines inside a cell", () => {
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

describe("unsupported format values must be catchable", () => {
  it("chooseFormat accepts md as a valid format string", () => {
    // Commands that don't support md must check AFTER chooseFormat returns.
    // chooseFormat itself should accept any valid format value.
    assert.equal(chooseFormat("md", { isTty: true, defaultFormat: "json" }), "md");
  });

  it("chooseFormat rejects truly invalid format strings", () => {
    assert.throws(
      () => chooseFormat("xml" as any, { isTty: true, defaultFormat: "json" }),
      /Unknown format/,
    );
  });

  it("commands rejecting md can test the returned format value", () => {
    const format = chooseFormat("md", { isTty: true, defaultFormat: "json" });
    // Pattern used by comment list, block get, etc.: check after chooseFormat
    assert.equal(format, "md");
    // The command would then: if (format === "md") throw USAGE error
  });

  it("commands rejecting table/csv can test the returned format value", () => {
    const format = chooseFormat("table", { isTty: true, defaultFormat: "json" });
    assert.equal(format, "table");
    // The command would then: if (format !== "json") throw USAGE error
  });
});

describe("output.renderCsv carries values through unchanged", () => {
  const cell = (v: string): string => renderCsv({ columns: ["C"], rows: [[v]] }).split("\n")[1]!;

  it("does not rewrite a value a spreadsheet might evaluate", () => {
    // The `'` prefix this used to add was not the stored data. A script reading
    // the CSV got a value the workspace never held, and feeding it back in
    // wrote the corruption to Notion.
    // No RFC 4180 quoting either: the value contains no comma, quote, or newline.
    assert.equal(cell("=cmd|'/C calc'!A0"), "=cmd|'/C calc'!A0");
    assert.equal(cell("@SUM(A1)"), "@SUM(A1)");
  });

  it("keeps an international phone number byte-for-byte", () => {
    // The common case the rewrite broke: every `+`-prefixed number.
    assert.equal(cell("+1 555 0100"), "+1 555 0100");
    assert.equal(cell("+44 20 7946 0958"), "+44 20 7946 0958");
  });

  it("keeps negative numbers and leading-dash text", () => {
    assert.equal(cell("-5"), "-5");
    assert.equal(cell("-3.14"), "-3.14");
    assert.equal(cell("-notes"), "-notes");
  });

  it("still strips control characters", () => {
    assert.ok(!cell("a\x1b[2Jb").includes("\x1b"));
  });

  it("still quotes and escapes per RFC 4180", () => {
    assert.equal(cell("a,b"), '"a,b"');
    assert.equal(cell('say "hi"'), '"say ""hi"""');
  });
});

describe("output.renderCsv warns about formula-looking cells on stderr", () => {
  const captureStderr = (fn: () => void): string => {
    const original = process.stderr.write.bind(process.stderr);
    let captured = "";
    (process.stderr as { write: unknown }).write = (chunk: string): boolean => {
      captured += chunk;
      return true;
    };
    try { fn(); } finally { (process.stderr as { write: unknown }).write = original; }
    return captured;
  };

  it("names the column when a cell would execute", () => {
    const out = captureStderr(() => {
      renderCsv({ columns: ["Name", "Notes"], rows: [["ok", "=cmd|'/C calc'!A0"]] });
    });
    assert.match(out, /Notes/);
    assert.match(out, /run as a formula/);
    assert.doesNotMatch(out, /Name/);
  });

  it("stays quiet for phone numbers and ordinary text", () => {
    const out = captureStderr(() => {
      renderCsv({
        columns: ["Phone", "Handle", "Temp"],
        rows: [["+1 555 0100", "@channel", "-3 degrees"]],
      });
    });
    assert.equal(out, "", `expected no warning, got: ${out}`);
  });

  it("writes the notice to stderr, never into the CSV", () => {
    let csv = "";
    const out = captureStderr(() => {
      csv = renderCsv({ columns: ["C"], rows: [["=1+1"]] });
    });
    assert.ok(out.length > 0);
    assert.doesNotMatch(csv, /notionctl:/);
    assert.equal(csv.split("\n")[1], "=1+1");
  });
});

describe("output.renderTable control characters", () => {
  it("strips escape sequences and lone carriage returns", () => {
    const out = renderTable({ columns: ["T"], rows: [["a\x1b[2Jb\rc"]] });
    // The ESC byte goes; the "[2J" it introduced stays as inert text, which is
    // exactly what scrub() does on the error path.
    assert.ok(!out.includes("\x1b"));
    assert.ok(!out.includes("\r"));
    assert.ok(out.includes("a[2Jb c"), JSON.stringify(out));
  });

  it("keeps a cell on one row", () => {
    const out = renderTable({ columns: ["T"], rows: [["a\nb"]] });
    assert.equal(out.split("\n").length, 3);
  });
});
