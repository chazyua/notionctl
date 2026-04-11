import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSyncTitle, stripLeadingTitleHeading } from "../../src/commands/page.js";
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
