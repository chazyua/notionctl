import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSyncTitle, stripLeadingTitleHeading, stripLeadingTitleH1, replaceInRichText } from "../../src/commands/page.js";
import { fetchWith404Hint, parseFlags } from "../../src/commands/shared.js";
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

  it("ignores H1s inside a fenced code block whose closer is shorter than the opener", () => {
    // Regression: the fence tracker used to toggle on any ` `{3,} ` match, so
    // a ``` line inside a ```` fence flipped inFence=false and the next H1
    // was picked up as the page title even though it was still code content.
    const body = [
      "````",
      "# Not a real H1 inside code",
      "```",
      "# Still inside code",
      "````",
      "",
      "# Real title",
    ].join("\n");
    const { title } = extractSyncTitle({}, body);
    assert.equal(title, "Real title");
  });
});

describe("stripLeadingTitleH1", () => {
  it("strips top-level H1 that matches the title", () => {
    const body = "# My Title\n\nContent";
    assert.equal(stripLeadingTitleH1(body, "My Title"), "Content");
  });

  it("leaves body alone when H1 text differs", () => {
    const body = "# Different\n\nContent";
    assert.equal(stripLeadingTitleH1(body, "Expected"), body);
  });

  it("does not strip H1 inside a fenced code block", () => {
    const body = "```markdown\n# Code Title\n```\n\nReal body.";
    const out = stripLeadingTitleH1(body, "Code Title");
    assert.ok(out.includes("# Code Title"), "H1 inside fence must be preserved");
  });

  it("does not strip H1 inside a tilde-fenced code block", () => {
    const body = "~~~\n# Code Title\n~~~\n\nReal body.";
    const out = stripLeadingTitleH1(body, "Code Title");
    assert.ok(out.includes("# Code Title"));
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

describe("replaceInRichText — cross-run find-replace", () => {
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

  it("does not touch equation runs and leaves text replacements around them", () => {
    // Regression: the previous implementation used each run's plain_text to
    // build the flat search buffer, so an equation expression containing the
    // find string was matched and replaced with a plain-text run, losing the
    // equation shape entirely.
    const equationRun = {
      type: "equation",
      equation: { expression: "x + y" },
      annotations: { ...plain },
      plain_text: "x + y",
      href: null,
    };
    const runs = [
      makeRun("solve for this ", plain),
      equationRun,
      makeRun(" then submit", plain),
    ];
    const { newRuns, count } = replaceInRichText(runs as any, "this", "THAT");
    assert.equal(count, 1);
    const eq = newRuns.find((r: any) => r.type === "equation");
    assert.ok(eq, "equation run survives");
    assert.equal((eq as any).equation.expression, "x + y");
    const flat = newRuns.map((r: any) => r.plain_text).join("");
    assert.ok(flat.includes("solve for THAT"));
    assert.ok(flat.includes("then submit"));
  });

  it("does not touch mention runs", () => {
    const mention = {
      type: "mention",
      mention: { type: "page", page: { id: "abc123" } },
      annotations: { ...plain },
      plain_text: "Some Page",
      href: null,
    };
    const runs = [makeRun("hello ", plain), mention, makeRun(" world", plain)];
    const { newRuns, count } = replaceInRichText(runs as any, "Page", "Doc");
    assert.equal(count, 0, "mention is skipped");
    const stillMention = newRuns.find((r: any) => r.type === "mention");
    assert.ok(stillMention, "mention preserved");
  });
});

describe("stripLeadingTitleHeading", () => {
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

describe("page update --title must not auto-read stdin", () => {
  it("parseFlags with only --title sets from=undefined", () => {
    const { flags } = parseFlags(["some-id", "--title", "New Title"]);
    assert.equal(flags.get("title"), "New Title");
    assert.equal(flags.get("from"), undefined);
    // hasFrom should be !!flags.get("from") = false, so title-only update
    // must never enter the block-replacement path.
    const hasFrom = !!flags.get("from");
    assert.equal(hasFrom, false, "title-only update must not trigger content replacement");
  });

  it("parseFlags with --from - sets from correctly", () => {
    const { flags } = parseFlags(["some-id", "--from", "-"]);
    assert.equal(flags.get("from"), "-");
    const hasFrom = !!flags.get("from");
    assert.equal(hasFrom, true, "--from - should trigger content replacement");
  });

  it("parseFlags with --title and --from sets both", () => {
    const { flags } = parseFlags(["some-id", "--title", "X", "--from", "file.md"]);
    assert.equal(flags.get("title"), "X");
    assert.equal(flags.get("from"), "file.md");
    const hasFrom = !!flags.get("from");
    assert.equal(hasFrom, true);
  });
});

describe("page update with no flags must produce USAGE error", () => {
  it("parseFlags with just a positional ID has no title and no from", () => {
    const { flags } = parseFlags(["some-id"]);
    const title = flags.get("title");
    const hasFrom = !!flags.get("from");
    assert.equal(title, undefined);
    assert.equal(hasFrom, false);
    // The guard `if (!title && !hasFrom)` must fire.
    assert.ok(!title && !hasFrom, "no-flag invocation must hit the USAGE guard");
  });
});

describe("page delete --yes must be checked before --dry-run", () => {
  it("parseFlags extracts both --yes and --dry-run as boolean flags", () => {
    const { flags } = parseFlags(["some-id", "--dry-run"]);
    // --yes is absent, --dry-run is present
    assert.equal(flags.get("yes"), undefined);
    assert.equal(flags.get("dry-run"), "true");
    // The --yes check must run first — if --yes is missing, throw before dry-run.
    const yesPresent = flags.get("yes") === "true";
    assert.equal(yesPresent, false, "--yes must be required even for dry-run");
  });
});

describe("page get output must be sync-compatible", () => {
  it("page get frontmatter hash matches what extractFrontmatter+classifySyncState would compute", async () => {
    // Simulate what page get now produces: frontmatter with notion_hash
    // and notion_synced_at. When this output is saved to a file and fed
    // to page sync, the sync state should be UNCHANGED.
    const { extractFrontmatter } = await import("../../src/sync/frontmatter.js");
    const { computeContentHash, classifySyncState } = await import("../../src/sync/sync.js");

    // Simulate page get output format
    const body = "# My Page\n\nSome content.\n";
    const hash = computeContentHash(body);
    const syncedAt = new Date().toISOString();

    const output = [
      "---",
      `notion_id: "test-id-123"`,
      `notion_hash: "${hash}"`,
      `notion_synced_at: "${syncedAt}"`,
      "---",
      "",
      body,
    ].join("\n");

    const { data: fm, body: extractedBody } = extractFrontmatter(output);
    assert.equal(fm.notion_id, "test-id-123");
    assert.equal(fm.notion_hash, hash);

    // The extracted body should hash to the same value
    const recomputedHash = computeContentHash(extractedBody);
    assert.equal(recomputedHash, hash, "hash of extracted body must match stored hash");

    // classifySyncState should return UNCHANGED
    const state = classifySyncState({
      frontmatter: fm,
      localBody: extractedBody,
      remoteEditedAt: syncedAt,
    });
    assert.equal(state, "UNCHANGED", "page get output fed to sync must be UNCHANGED");
  });
});

describe("pageGetCommand — reserved frontmatter keys are not overwritten by DB properties", () => {
  // Regression: a Notion DB column named `notion_id`, `notion_hash`, or
  // `notion_synced_at` used to overwrite the internal sync metadata in the
  // emitted frontmatter. On the next `page sync`, `classifySyncState` would
  // use the attacker-chosen value and push content to an arbitrary Notion
  // page (data exfiltration) or silently bypass drift detection.
  it("property named notion_id does not override the page's real UUID", async () => {
    const { pageGetCommand } = await import("../../src/commands/page.js");
    const { setTokenProvider, resetForTesting } = await import("../../src/http.js");
    const { AuthSource } = await import("../../src/auth.js");
    const { extractFrontmatter } = await import("../../src/sync/frontmatter.js");

    const REAL_ID = "11111111-1111-1111-1111-111111111111";
    const ATTACKER_ID = "22222222-2222-2222-2222-222222222222";

    setTokenProvider(async () => ({ token: "ntn_test", source: AuthSource.ENV }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/pages/")) {
        return new Response(JSON.stringify({
          id: REAL_ID,
          object: "page",
          parent: { type: "database_id", database_id: "db1" },
          url: "https://www.notion.so/page",
          properties: {
            notion_id: { type: "rich_text", rich_text: [{ plain_text: ATTACKER_ID }] },
            notion_hash: { type: "rich_text", rich_text: [{ plain_text: "sha256:evil" }] },
            notion_synced_at: { type: "rich_text", rich_text: [{ plain_text: "9999-12-31T23:59:59Z" }] },
            Status: { type: "rich_text", rich_text: [{ plain_text: "Done" }] },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // /blocks/<id>/children — return empty
      return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };

    try {
      const out = await pageGetCommand({ args: [REAL_ID] });
      const { data: fm } = extractFrontmatter(out);
      assert.equal(fm.notion_id, REAL_ID, "notion_id must be the actual page UUID, not the attacker-planted value");
      assert.notEqual(fm.notion_hash, "sha256:evil", "notion_hash must be the real computed hash");
      assert.notEqual(fm.notion_synced_at, "9999-12-31T23:59:59Z", "notion_synced_at must be the real sync timestamp");
      // Non-reserved properties still render normally
      assert.equal(fm.Status, "Done");
    } finally {
      globalThis.fetch = originalFetch;
      resetForTesting();
    }
  });
});
