import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { extractSyncTitle, stripLeadingTitleH1, pageUpdateCommand } from "../../src/commands/page.js";
import { fetchWith404Hint } from "../../src/commands/shared.js";
import { NotionCliError, ErrorCode } from "../../src/errors.js";
import { setTokenProvider, resetForTesting } from "../../src/http.js";
import { AuthSource } from "../../src/auth.js";

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

  it("ignores H1-looking lines inside a backtick fenced code block", () => {
    const body = "```\n# Not a title\n```\n\n# Real Title\n\nBody";
    const { title, syncBody } = extractSyncTitle({}, body);
    assert.equal(title, "Real Title");
    assert.ok(syncBody.includes("# Not a title"), "code block contents must be preserved");
    assert.ok(!/^# Real Title/m.test(syncBody), "real H1 must be stripped from body");
  });

  it("ignores H1 inside a tilde fenced code block", () => {
    const body = "~~~\n# Pretend Title\n~~~\n\n# Real One";
    const { title } = extractSyncTitle({}, body);
    assert.equal(title, "Real One");
  });

  it("finds H1 that appears after a closed fence", () => {
    const body = "```js\nconsole.log(1);\n```\n# After Fence\n\nBody";
    const { title } = extractSyncTitle({}, body);
    assert.equal(title, "After Fence");
  });

  it("returns Untitled when the only H1 lives entirely inside a fence", () => {
    const body = "```\n# Inside\n```\n\nJust body";
    const { title } = extractSyncTitle({}, body);
    assert.equal(title, "Untitled");
  });

  it("handles fences with language hints", () => {
    const body = "```typescript\n# import { x } from 'y';\n```\n\n# Actual Title";
    const { title } = extractSyncTitle({}, body);
    assert.equal(title, "Actual Title");
  });
});

describe("pageUpdateCommand title patch", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_test_token", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("uses the DB row's actual title column name ('Name') in the PATCH body", async () => {
    const pageId = "abcd1234-ef56-7890-abcd-1234567890ab";
    const patchBodies: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && u.endsWith(`/pages/${pageId}`)) {
        return new Response(JSON.stringify({
          id: pageId,
          properties: {
            Status: { type: "select", select: null },
            Name: { type: "title", title: [] },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "PATCH" && u.endsWith(`/pages/${pageId}`)) {
        patchBodies.push({ url: u, body: JSON.parse((init?.body as string) ?? "{}") });
        return new Response(JSON.stringify({ id: pageId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    await pageUpdateCommand({ args: [pageId, "--title", "New Title"] });

    assert.equal(patchBodies.length, 1, "expected one PATCH /pages/{id} call");
    const body = patchBodies[0]!.body as { properties: Record<string, unknown> };
    assert.ok(
      "Name" in body.properties,
      `PATCH body should use the DB title key "Name", got keys: ${Object.keys(body.properties).join(",")}`,
    );
    assert.ok(!("title" in body.properties), 'PATCH body should NOT use hardcoded "title" key for DB rows');
  });

  it("uses 'title' key for standalone (non-database) pages", async () => {
    const pageId = "11111111-2222-3333-4444-555555555555";
    const patchBodies: Array<{ body: unknown }> = [];

    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && u.endsWith(`/pages/${pageId}`)) {
        return new Response(JSON.stringify({
          id: pageId,
          properties: { title: { type: "title", title: [] } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "PATCH" && u.endsWith(`/pages/${pageId}`)) {
        patchBodies.push({ body: JSON.parse((init?.body as string) ?? "{}") });
        return new Response(JSON.stringify({ id: pageId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    await pageUpdateCommand({ args: [pageId, "--title", "Renamed"] });

    assert.equal(patchBodies.length, 1);
    const body = patchBodies[0]!.body as { properties: Record<string, unknown> };
    assert.ok("title" in body.properties, "standalone page should use 'title' key");
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
