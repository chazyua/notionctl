import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSyncTitle,
  stripLeadingTitleHeading,
  stripLeadingTitleH1,
  replaceInRichText,
  pageGetCommand,
  pageUpdateCommand,
} from "../../src/commands/page.js";
import { fetchWith404Hint, parseFlags } from "../../src/commands/shared.js";
import { setTokenProvider, resetForTesting } from "../../src/http.js";
import { AuthSource } from "../../src/auth.js";
import { NotionCliError, ErrorCode } from "../../src/errors.js";

const STUB_PAGE_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Run `fn` against a stubbed Notion API. The handler receives the method and
 * path and returns the response body; returning undefined produces a 400 so a
 * test can simulate a rejected request.
 */
async function withStubbedNotion<T>(
  handler: (method: string, path: string) => unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  setTokenProvider(async () => ({ token: "ntn_test", source: AuthSource.ENV }));
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace("https://api.notion.com/v1", "").split("?")[0]!;
    const body = handler(method, path);
    return new Response(JSON.stringify(body ?? { message: "stub rejected" }), {
      status: body === undefined ? 400 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    resetForTesting();
  }
}

const stubParagraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  has_children: false,
  paragraph: {
    rich_text: text
      ? [{ type: "text", text: { content: text }, plain_text: text, annotations: {} }]
      : [],
  },
});

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
  // Drives the real pageGetCommand rather than reconstructing its output, so
  // the assertion covers the actual bytes written to disk. `page get` used to
  // append one more newline than it hashed, which made an untouched file
  // re-read as CHANGED — and CHANGED deletes and recreates every block,
  // destroying Notion-hosted media that markdown cannot rebuild.
  const classifyAfterGet = async (blocks: unknown[]): Promise<string> => {
    const { extractFrontmatter } = await import("../../src/sync/frontmatter.js");
    const { classifySyncState } = await import("../../src/sync/sync.js");

    const output = await withStubbedNotion(
      (method, path) =>
        method === "GET" && path === `/pages/${STUB_PAGE_ID}`
          ? {
              id: STUB_PAGE_ID,
              object: "page",
              parent: { type: "page_id" },
              url: "https://notion.so/page",
              properties: { title: { type: "title", title: [{ plain_text: "My Page" }] } },
            }
          : { results: blocks, has_more: false, next_cursor: null },
      () => pageGetCommand({ args: [STUB_PAGE_ID, "--format", "md"] }),
    );

    const { data, body } = extractFrontmatter(output);
    assert.ok(typeof data.notion_hash === "string", "page get must emit a notion_hash");
    return classifySyncState({ frontmatter: data, localBody: body, remoteEditedAt: undefined });
  };

  it("is UNCHANGED for a page whose content does not end in a blank block", async () => {
    assert.equal(await classifyAfterGet([stubParagraph("b1", "Some content.")]), "UNCHANGED");
  });

  it("is UNCHANGED for a page ending in a trailing blank paragraph", async () => {
    // Notion leaves one of these behind whenever the cursor rests on an empty
    // last line, so this is the common page shape, not an exotic one.
    assert.equal(
      await classifyAfterGet([stubParagraph("b1", "See screenshot below."), stubParagraph("b2", "")]),
      "UNCHANGED",
    );
  });

  it("is UNCHANGED for a title-only page with no content blocks", async () => {
    assert.equal(await classifyAfterGet([]), "UNCHANGED");
  });

  it("still reports CHANGED once the local body is genuinely edited", async () => {
    const { extractFrontmatter } = await import("../../src/sync/frontmatter.js");
    const { classifySyncState } = await import("../../src/sync/sync.js");

    const output = await withStubbedNotion(
      (method, path) =>
        method === "GET" && path === `/pages/${STUB_PAGE_ID}`
          ? {
              id: STUB_PAGE_ID,
              object: "page",
              parent: { type: "page_id" },
              url: "https://notion.so/page",
              properties: { title: { type: "title", title: [{ plain_text: "My Page" }] } },
            }
          : { results: [stubParagraph("b1", "Some content.")], has_more: false, next_cursor: null },
      () => pageGetCommand({ args: [STUB_PAGE_ID, "--format", "md"] }),
    );

    const { data, body } = extractFrontmatter(output);
    const state = classifySyncState({
      frontmatter: data,
      localBody: body + "\nA new line the user typed.\n",
      remoteEditedAt: undefined,
    });
    assert.equal(state, "CHANGED");
  });
});

describe("page update replaces content without ever emptying the page", () => {
  // Deleting the old blocks before writing the new ones meant any failure in
  // the append — a block Notion rejects, a dropped connection, exhausted
  // retries — left the page empty with the original content already gone.
  const runUpdate = async (opts: { failAppend: boolean }): Promise<{ calls: string[]; threw: boolean }> => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "notionctl-page-update-"));
    const mdPath = join(dir, "body.md");
    await writeFile(mdPath, "New body text.\n", "utf8");

    const calls: string[] = [];
    let threw = false;
    await withStubbedNotion(
      (method, path) => {
        calls.push(`${method} ${path}`);
        if (method === "GET" && path === `/blocks/${STUB_PAGE_ID}/children`) {
          return {
            results: [stubParagraph("old-1", "Original one."), stubParagraph("old-2", "Original two.")],
            has_more: false,
            next_cursor: null,
          };
        }
        if (method === "PATCH" && path === `/blocks/${STUB_PAGE_ID}/children`) {
          return opts.failAppend ? undefined : { results: [] };
        }
        return { id: STUB_PAGE_ID, results: [] };
      },
      async () => {
        try {
          await pageUpdateCommand({ args: [STUB_PAGE_ID, "--from", mdPath] });
        } catch {
          threw = true;
        }
      },
    );
    return { calls, threw };
  };

  it("appends the new content before deleting the old blocks", async () => {
    const { calls } = await runUpdate({ failAppend: false });
    const appendIdx = calls.indexOf(`PATCH /blocks/${STUB_PAGE_ID}/children`);
    const firstDeleteIdx = calls.findIndex((c) => c.startsWith("DELETE /blocks/old-"));
    assert.ok(appendIdx !== -1, `expected an append call, got: ${calls.join(", ")}`);
    assert.ok(firstDeleteIdx !== -1, `expected delete calls, got: ${calls.join(", ")}`);
    assert.ok(
      appendIdx < firstDeleteIdx,
      `append must precede delete so a failure cannot empty the page — got: ${calls.join(", ")}`,
    );
  });

  it("leaves the original blocks intact when the append fails", async () => {
    const { calls, threw } = await runUpdate({ failAppend: true });
    assert.ok(threw, "a failing append should surface as an error");
    const deletes = calls.filter((c) => c.startsWith("DELETE /blocks/old-"));
    assert.equal(deletes.length, 0, `no original block may be deleted when the append failed — got: ${calls.join(", ")}`);
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


describe("pageSyncCommand — malformed front-matter is refused, not treated as a new page", () => {
  it("refuses instead of classifying CREATE and orphaning the linked page", async () => {
    const { pageSyncCommand } = await import("../../src/commands/page.js");
    const { writeFile, mkdir, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { NotionCliError, ErrorCode } = await import("../../src/errors.js");

    // page sync refuses files outside the working directory, so stage it in temp/.
    const dir = join(process.cwd(), "temp");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `broken-fm-${process.pid}.md`);
    await writeFile(
      file,
      ['---', 'notion_id: "3b2944f0-98c0-8183-9921-d7b2405d0ab3"', "no colon on this line", "---", "", "Body"].join("\n"),
    );

    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    try {
      // --parent matters: without it the CREATE path stops at its own
      // "requires --parent" guard, so requests===0 would prove nothing.
      await assert.rejects(
        () => pageSyncCommand({ args: [file, "--parent", "33e944f0-98c0-8148-84ee-f6d15234a203"] }),
        (err: unknown) => {
          assert.ok(err instanceof NotionCliError);
          assert.equal(err.code, ErrorCode.USAGE);
          assert.match(err.message, /not valid YAML/);
          assert.match(err.suggestions.join(" "), /orphaned/);
          return true;
        },
      );
      assert.equal(requests, 0, "nothing may be created before the file is understood");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(file, { force: true });
    }
  });
});


describe("pageSyncCommand — an unusable notion_id is refused, not treated as a new page", () => {
  // parseYaml only throws on a line with no colon, so `notion_id:` (blank),
  // `null`, `~` and numbers all parse cleanly — and classifySyncState reads a
  // non-string id as absent, silently creating a duplicate and orphaning the
  // page the file already tracked.
  const BAD_IDS = ["notion_id:", "notion_id: null", "notion_id: ~", "notion_id: 123", 'notion_id: ""'];

  for (const line of BAD_IDS) {
    it(`refuses ${JSON.stringify(line)}`, async () => {
      const { pageSyncCommand } = await import("../../src/commands/page.js");
      const { writeFile, mkdir, rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { NotionCliError, ErrorCode } = await import("../../src/errors.js");

      const dir = join(process.cwd(), "temp");
      await mkdir(dir, { recursive: true });
      const file = join(dir, `bad-id-${process.pid}-${BAD_IDS.indexOf(line)}.md`);
      await writeFile(file, ["---", line, "---", "", "Body"].join("\n"));

      const originalFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = (async () => {
        requests++;
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof globalThis.fetch;

      try {
        await assert.rejects(
          () => pageSyncCommand({ args: [file] }),
          (err: unknown) => {
            assert.ok(err instanceof NotionCliError);
            assert.equal(err.code, ErrorCode.USAGE);
            assert.match(err.message, /notion_id with no usable value/);
            return true;
          },
        );
        assert.equal(requests, 0, "nothing may be created for a file with a broken id");
      } finally {
        globalThis.fetch = originalFetch;
        await rm(file, { force: true });
      }
    });
  }

  it("still creates when the notion_id key is absent entirely", async () => {
    const { classifySyncState, SyncState } = await import("../../src/sync/sync.js");
    // The guard keys off the presence of the key, so a genuine first sync —
    // no key at all — must still classify as CREATE.
    assert.equal(
      classifySyncState({ frontmatter: { title: "x" }, localBody: "b", remoteEditedAt: undefined }),
      SyncState.CREATE,
    );
  });
});
