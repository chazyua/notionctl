import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  parseFlags,
  resolvePageId,
  getBooleanFlag,
  detectParentType,
  resolveTitlePropertyKey,
  readStdinBounded,
} from "../../src/commands/shared.js";
import { setTokenProvider, resetForTesting } from "../../src/http.js";
import { AuthSource } from "../../src/auth.js";
import { NotionCliError, ErrorCode } from "../../src/errors.js";

describe("parseFlags", () => {
  it("parses --flag value pairs", () => {
    const { flags, positional } = parseFlags(["--parent", "abc", "--title", "Hello"]);
    assert.equal(flags.get("parent"), "abc");
    assert.equal(flags.get("title"), "Hello");
    assert.deepEqual(positional, []);
  });

  it("parses --flag=value form", () => {
    const { flags } = parseFlags(["--parent=abc", "--title=Hello"]);
    assert.equal(flags.get("parent"), "abc");
    assert.equal(flags.get("title"), "Hello");
  });

  it("collects repeated flags as arrays", () => {
    const { repeated } = parseFlags(["--prop", "a=1", "--prop", "b=2"]);
    assert.deepEqual(repeated.get("prop"), ["a=1", "b=2"]);
  });

  it("collects repeated --filter flags as arrays", () => {
    const { repeated } = parseFlags(["--filter", "Status=Done", "--filter", "Count>=10"]);
    assert.deepEqual(repeated.get("filter"), ["Status=Done", "Count>=10"]);
  });

  it("treats boolean flags without value as true", () => {
    const { flags } = parseFlags(["--dry-run", "--quiet"]);
    assert.equal(flags.get("dry-run"), "true");
    assert.equal(flags.get("quiet"), "true");
  });

  it("separates positional args", () => {
    const { positional } = parseFlags(["page", "get", "abc-123", "--format", "json"]);
    assert.deepEqual(positional, ["page", "get", "abc-123"]);
  });

  it("throws when a non-boolean flag's value is another flag", () => {
    // Regression: --title with missing value used to silently consume --from as its value.
    assert.throws(
      () => parseFlags(["--title", "--from", "body.md"]),
      /--title requires a value/,
    );
  });

  it("throws when a non-boolean flag is the last arg", () => {
    assert.throws(() => parseFlags(["--title"]), /--title requires a value/);
  });

  it("allows --flag=-- style explicit values", () => {
    // An explicit = binds the value, even if it looks like a flag.
    const { flags } = parseFlags(["--title=--from"]);
    assert.equal(flags.get("title"), "--from");
  });
});

describe("resolvePageId", () => {
  it("returns UUID unchanged when already in UUID form", () => {
    const id = "abcd1234-ef56-7890-abcd-1234567890ab";
    assert.equal(resolvePageId(id), id);
  });

  it("extracts ID from notion.so URL", () => {
    const url = "https://www.notion.so/Workspace/Page-Title-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("handles IDs without dashes", () => {
    assert.equal(resolvePageId("abcd1234ef567890abcd1234567890ab"), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("extracts ID from multi-segment notion.so URL", () => {
    const url = "https://www.notion.so/team/area/Page-Title-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("extracts ID from notion.site URL (public pages)", () => {
    const url = "https://mysite.notion.site/Page-Title-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("extracts ID from notion.site URL with subpath", () => {
    const url = "https://team.notion.site/area/Page-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("strips URL fragment (#block-anchor)", () => {
    const url = "https://www.notion.so/Page-abcd1234ef567890abcd1234567890ab#block-anchor";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("strips trailing slash on URL", () => {
    const url = "https://www.notion.so/Page-abcd1234ef567890abcd1234567890ab/";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("strips trailing slash before query string", () => {
    const url = "https://www.notion.so/Page-abcd1234ef567890abcd1234567890ab/?pvs=4";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("throws on invalid ID", () => {
    assert.throws(() => resolvePageId("not-a-valid-id"), /Could not parse/);
  });

  it("throws on too-short hex string", () => {
    assert.throws(() => resolvePageId("abcd1234"), /Could not parse/);
  });
});

describe("getBooleanFlag", () => {
  it("returns true when flag is set and false when absent", () => {
    const { flags } = parseFlags(["--dry-run"]);
    assert.equal(getBooleanFlag(flags, "dry-run"), true);
    assert.equal(getBooleanFlag(flags, "quiet"), false);
  });
});

describe("detectParentType", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_test_token", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("returns database_id when GET /databases/{id} succeeds", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock.fn(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push(u);
      return new Response(JSON.stringify({ object: "database", id: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const kind = await detectParentType("abcd1234-ef56-7890-abcd-1234567890ab");
    assert.equal(kind, "database_id");
    assert.ok(calls[0]!.includes("/databases/abcd1234-ef56-7890-abcd-1234567890ab"));
  });

  it("returns page_id when GET /databases/{id} returns 404", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({ object: "error", status: 404, code: "object_not_found", message: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const kind = await detectParentType("abcd1234-ef56-7890-abcd-1234567890ab");
    assert.equal(kind, "page_id");
  });
});

describe("readStdinBounded", () => {
  it("reads full payload under the limit", async () => {
    const payload = "hello world";
    const stream = Readable.from([Buffer.from(payload, "utf8")]);
    const result = await readStdinBounded(100, stream);
    assert.equal(result, payload);
  });

  it("rejects when payload exceeds the limit", async () => {
    const stream = Readable.from([Buffer.from("x".repeat(50), "utf8")]);
    await assert.rejects(
      readStdinBounded(10, stream),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal(err.code, ErrorCode.USAGE);
        assert.ok(err.message.includes("exceeds maximum size"));
        return true;
      },
    );
  });

  it("does not double-settle when over-limit data is followed by stream end", async () => {
    // Craft a stream that pushes data past the limit AND emits 'end' naturally.
    // The old implementation left the 'end' listener attached after destroy(),
    // which silently dropped a second settlement — harmless with native Promise
    // but a hazard for refactors. This test asserts only ONE settle happens.
    const chunks = [Buffer.from("aaaa", "utf8"), Buffer.from("bbbbbb", "utf8")];
    const stream = new Readable({
      read() {
        for (const c of chunks) this.push(c);
        this.push(null);
      },
    });

    let rejections = 0;
    let resolutions = 0;
    try {
      const result = await readStdinBounded(5, stream);
      resolutions++;
      assert.fail(`expected rejection, got resolved value: ${result}`);
    } catch (err) {
      rejections++;
      assert.ok(err instanceof NotionCliError);
      assert.equal(err.code, ErrorCode.USAGE);
    }

    // Give any straggler event listeners a tick to (incorrectly) fire.
    await new Promise((r) => setImmediate(r));

    assert.equal(rejections, 1);
    assert.equal(resolutions, 0);
    assert.equal(stream.listenerCount("data"), 0, "data listener must be removed after settle");
    assert.equal(stream.listenerCount("end"), 0, "end listener must be removed after settle");
    assert.equal(stream.listenerCount("error"), 0, "error listener must be removed after settle");
  });
});

describe("resolveTitlePropertyKey", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_test_token", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("returns the DB title property key (e.g. Name) for a database row", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({
        id: "abcd1234-ef56-7890-abcd-1234567890ab",
        properties: {
          Status: { type: "select", select: null },
          Name: { type: "title", title: [] },
          Created: { type: "created_time", created_time: "2026-01-01T00:00:00Z" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    const key = await resolveTitlePropertyKey("abcd1234-ef56-7890-abcd-1234567890ab");
    assert.equal(key, "Name");
  });

  it("returns 'title' for a standalone (non-database) page", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({
        id: "abcd1234-ef56-7890-abcd-1234567890ab",
        properties: {
          title: { type: "title", title: [] },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    const key = await resolveTitlePropertyKey("abcd1234-ef56-7890-abcd-1234567890ab");
    assert.equal(key, "title");
  });

  it("returns a custom DB title column name", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({
        id: "abcd1234-ef56-7890-abcd-1234567890ab",
        properties: {
          "Task Title": { type: "title", title: [] },
          Priority: { type: "select", select: null },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    const key = await resolveTitlePropertyKey("abcd1234-ef56-7890-abcd-1234567890ab");
    assert.equal(key, "Task Title");
  });
});
