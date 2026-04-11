import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSyncTitle, stripLeadingTitleH1 } from "../../src/commands/page.js";
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
});

describe("stripLeadingTitleH1 (BUG-07)", () => {
  it("strips top-level H1 that matches the title", () => {
    const body = "# My Title\n\nContent";
    assert.equal(stripLeadingTitleH1(body, "My Title"), "Content");
  });

  it("leaves body alone when H1 text differs", () => {
    const body = "# Different\n\nContent";
    assert.equal(stripLeadingTitleH1(body, "Expected"), body);
  });

  it("does not strip H1 inside a fenced code block", () => {
    const body = "```markdown\n# BUG-07\n```\n\nReal body.";
    const out = stripLeadingTitleH1(body, "BUG-07");
    assert.ok(out.includes("# BUG-07"), "H1 inside fence must be preserved");
  });

  it("does not strip H1 inside a tilde-fenced code block", () => {
    const body = "~~~\n# BUG-07\n~~~\n\nReal body.";
    const out = stripLeadingTitleH1(body, "BUG-07");
    assert.ok(out.includes("# BUG-07"));
  });

  it("strips real top-level H1 even when a fence follows later", () => {
    const body = "# Real Title\n\n```\n# not touched\n```\n";
    const out = stripLeadingTitleH1(body, "Real Title");
    assert.ok(!out.match(/^# Real Title$/m), "leading H1 removed");
    assert.ok(out.includes("# not touched"), "fence content untouched");
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
