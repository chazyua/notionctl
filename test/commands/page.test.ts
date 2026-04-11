import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSyncTitle, stripLeadingTitleHeading, replaceInRichText } from "../../src/commands/page.js";
import { fetchWith404Hint } from "../../src/commands/shared.js";
import { NotionCliError, ErrorCode } from "../../src/errors.js";

describe("extractSyncTitle", () => {
  it("uses frontmatter title when present", () => {
    const { title, syncBody } = extractSyncTitle({ title: "From FM" }, "# Ignored H1\n\nBody");
    assert.equal(title, "From FM");
    assert.equal(syncBody, "# Ignored H1\n\nBody");
  });

  it("extracts title from H1 and strips it from body", () => {
    const { title, syncBody } = extractSyncTitle({}, "# My Page\n\nContent here");
    assert.equal(title, "My Page");
    assert.equal(syncBody, "Content here");
  });

  it("returns Untitled when no frontmatter title and no H1", () => {
    const { title, syncBody } = extractSyncTitle({}, "Just a paragraph");
    assert.equal(title, "Untitled");
    assert.equal(syncBody, "Just a paragraph");
  });

  it("handles H1 with extra whitespace", () => {
    const { title } = extractSyncTitle({}, "#   Spaced Title  \n\nBody");
    assert.equal(title, "Spaced Title");
  });

  it("uses first H1 when multiple exist", () => {
    const { title } = extractSyncTitle({}, "# First\n\n# Second\n\nBody");
    assert.equal(title, "First");
  });

  it("marks explicit=true when title comes from frontmatter", () => {
    const { explicit } = extractSyncTitle({ title: "Foo" }, "Body");
    assert.equal(explicit, true);
  });

  it("marks explicit=true when title comes from an H1", () => {
    const { explicit } = extractSyncTitle({}, "# Foo\n\nBody");
    assert.equal(explicit, true);
  });

  it("marks explicit=false when title defaults to Untitled", () => {
    const { title, explicit } = extractSyncTitle({}, "Just a body.");
    assert.equal(title, "Untitled");
    assert.equal(explicit, false);
  });
});

describe("fetchWith404Hint", () => {
  it("passes through successful results", async () => {
    const result = await fetchWith404Hint(() => Promise.resolve({ id: "abc" }), "Page abc");
    assert.deepEqual(result, { id: "abc" });
  });

  it("converts NOT_FOUND to actionable error with Connections hint", async () => {
    await assert.rejects(
      () => fetchWith404Hint(
        () => { throw new NotionCliError(ErrorCode.NOT_FOUND, "Not found"); },
        "Page abc-123",
      ),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal(err.code, ErrorCode.NOT_FOUND);
        assert.ok(err.message.includes("Page abc-123"));
        assert.ok(err.message.includes("not connected"));
        assert.ok(err.suggestions.length > 0);
        assert.ok(err.suggestions.some((s: string) => s.includes("Connections")));
        return true;
      },
    );
  });

  it("passes through non-404 errors unchanged", async () => {
    const original = new NotionCliError(ErrorCode.AUTH_INVALID, "Bad token");
    await assert.rejects(
      () => fetchWith404Hint(() => { throw original; }, "Page x"),
      (err: unknown) => {
        assert.strictEqual(err, original);
        return true;
      },
    );
  });
});

describe("replaceInRichText (bug hunt round 5 — cross-run find-replace)", () => {
  const plain = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
  const bold = { ...plain, bold: true };
  const makeRun = (content: string, annotations: typeof plain) => ({
    type: "text",
    text: { content, link: null },
    annotations,
    plain_text: content,
    href: null,
  });

  it("finds and replaces within a single run", () => {
    const runs = [makeRun("hello world", plain)];
    const { newRuns, count } = replaceInRichText(runs, "world", "there");
    assert.equal(count, 1);
    assert.equal(newRuns.map((r) => r.plain_text).join(""), "hello there");
  });

  it("finds matches that span two runs", () => {
    // "This is **bold tar**get inline." → runs split between 'tar' (bold) and 'get' (plain)
    const runs = [
      makeRun("This is ", plain),
      makeRun("bold tar", bold),
      makeRun("get inline.", plain),
    ];
    const { newRuns, count } = replaceInRichText(runs, "target", "XYZ");
    assert.equal(count, 1);
    const flat = newRuns.map((r) => r.plain_text).join("");
    assert.equal(flat, "This is bold XYZ inline.");
  });

  it("replacement inherits annotations from run at match start", () => {
    const runs = [makeRun("bold tar", bold), makeRun("get", plain)];
    const { newRuns } = replaceInRichText(runs, "target", "XYZ");
    // The replacement 'XYZ' should carry bold (start-of-match annotations)
    const xyz = newRuns.find((r) => r.plain_text === "XYZ");
    assert.ok(xyz);
    assert.equal((xyz as any).annotations.bold, true);
  });

  it("returns unchanged runs when no match", () => {
    const runs = [makeRun("hello", plain)];
    const { newRuns, count } = replaceInRichText(runs, "missing", "X");
    assert.equal(count, 0);
    assert.deepEqual(newRuns, runs);
  });

  it("counts multiple non-overlapping matches", () => {
    const runs = [makeRun("ab ab ab", plain)];
    const { count } = replaceInRichText(runs, "ab", "xx");
    assert.equal(count, 3);
  });
});

describe("stripLeadingTitleHeading (bug hunt round 4)", () => {
  it("strips a leading # Title matching the title argument", () => {
    const body = "# My Title\n\nBody content.";
    assert.equal(stripLeadingTitleHeading(body, "My Title"), "Body content.");
  });

  it("does not strip a later H1 that matches the title", () => {
    // Regression: regex /^# .+\n?/m scanned the whole body and returned the
    // first H1. If that first H1 wasn't the title, nothing was stripped and
    // the duplicate stayed. We now only look at the very first line.
    const body = "# Intro section\n\n# My Title\n\nBody.";
    assert.equal(stripLeadingTitleHeading(body, "My Title"), body);
  });

  it("leaves the first H1 alone when it doesn't match the title", () => {
    const body = "# Other heading\n\nBody content.";
    assert.equal(stripLeadingTitleHeading(body, "My Title"), body);
  });

  it("tolerates blank lines above the leading H1", () => {
    const body = "\n\n# My Title\n\nBody.";
    assert.equal(stripLeadingTitleHeading(body, "My Title"), "Body.");
  });

  it("handles a trailing newline-free H1 at end of body", () => {
    const body = "# My Title";
    assert.equal(stripLeadingTitleHeading(body, "My Title"), "");
  });
});
