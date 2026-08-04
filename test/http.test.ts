import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { notionRequest, appendBlocksChunked, setTokenProvider, resetForTesting, isNonIdempotent, notionUploadFile } from "../src/http.js";
import { NotionCliError, ErrorCode } from "../src/errors.js";
import { AuthSource } from "../src/auth.js";

describe("http.ts base client", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({
      token: "ntn_test_token",
      source: AuthSource.ENV,
    }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("sends request to api.notion.com with Bearer header and Notion-Version", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedHeaders = Object.fromEntries(new Headers(init?.headers ?? {}));
      return new Response(JSON.stringify({ object: "user", id: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await notionRequest("GET", "/users/me");

    assert.equal(capturedUrl, "https://api.notion.com/v1/users/me");
    assert.equal(capturedHeaders["authorization"], "Bearer ntn_test_token");
    assert.equal(capturedHeaders["notion-version"], "2026-03-11");
    assert.match(capturedHeaders["user-agent"] ?? "", /^notionctl\//);
    assert.deepEqual(result, { object: "user", id: "abc" });
  });

  it("serializes body as JSON on POST/PATCH", async () => {
    let capturedBody = "";
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await notionRequest("POST", "/pages", { parent: { page_id: "abc" } });
    assert.equal(capturedBody, JSON.stringify({ parent: { page_id: "abc" } }));
  });

  it("throws NETWORK_ERROR on fetch rejection", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/users/me"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.NETWORK_ERROR);
        return true;
      },
    );
  });

  it("maps 401 to AUTH_INVALID", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ object: "error", code: "unauthorized", message: "Invalid token" }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/users/me"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.AUTH_INVALID);
        return true;
      },
    );
  });

  it("maps 404 to NOT_FOUND", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ object: "error", code: "object_not_found", message: "Not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/pages/missing"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.NOT_FOUND);
        return true;
      },
    );
  });

  it("maps 403 to PERMISSION_DENIED", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ object: "error", code: "restricted_resource", message: "Not shared" }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/pages/restricted"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.PERMISSION_DENIED);
        return true;
      },
    );
  });

  it("refuses absolute URLs as path (prevents host override)", async () => {
    await assert.rejects(
      async () => notionRequest("GET", "https://evil.com/exfil"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        return true;
      },
    );
  });

  it("never logs or returns the token in error messages", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({ object: "error", message: "Bad" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    try {
      await notionRequest("GET", "/users/me");
      assert.fail("expected error");
    } catch (err) {
      assert.ok(err instanceof NotionCliError);
      assert.ok(!err.message.includes("ntn_test_token"));
    }
  });
});

describe("http.ts retries", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_retry_test", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("retries on 429 with exponential backoff", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      if (attempts < 3) {
        return new Response("", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await notionRequest("GET", "/users/me");
    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 3);
  });

  it("retries on 5xx up to max attempts then throws", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      return new Response("", { status: 503 });
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/users/me"),
      (err: unknown) => err instanceof NotionCliError,
    );
    assert.equal(attempts, 5, "expected 5 attempts (1 initial + 4 retries)");
  });

  it("does not retry on 4xx other than 429", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      return new Response(JSON.stringify({ message: "bad" }), { status: 400 });
    }) as typeof globalThis.fetch;

    await assert.rejects(async () => notionRequest("GET", "/users/me"));
    assert.equal(attempts, 1);
  });

  it("respects Retry-After header", async () => {
    let attempts = 0;
    const timings: number[] = [];
    let last = Date.now();
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      timings.push(Date.now() - last);
      last = Date.now();
      if (attempts < 2) {
        return new Response("", { status: 429, headers: { "retry-after": "1" } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await notionRequest("GET", "/users/me");
    // Second attempt should be at least ~1000ms after first
    assert.ok(timings[1] >= 900, `retry-after not honored (gap: ${timings[1]}ms)`);
  });
});

describe("isNonIdempotent — endpoint classification", () => {
  it("treats creating endpoints as unsafe to repeat", () => {
    for (const path of ["/pages", "/comments", "/databases", "/data_sources", "/file_uploads"]) {
      assert.equal(isNonIdempotent("POST", path), true, `POST ${path} must be a write`);
    }
  });

  it("treats POST reads as safe to repeat", () => {
    for (const path of [
      "/search",
      "/databases/abc123/query",
      "/data_sources/abc123/query",
      "/data_sources/abc123/query?start_cursor=x",
    ]) {
      assert.equal(isNonIdempotent("POST", path), false, `POST ${path} is a read`);
    }
  });

  it("treats appends as unsafe even though they use PATCH", () => {
    assert.equal(isNonIdempotent("PATCH", "/blocks/abc123/children"), true);
    assert.equal(isNonIdempotent("PATCH", "/file_uploads/abc123/send"), true);
  });

  it("treats property/schema updates and deletes as safe to repeat", () => {
    assert.equal(isNonIdempotent("PATCH", "/pages/abc123"), false);
    assert.equal(isNonIdempotent("PATCH", "/blocks/abc123"), false);
    assert.equal(isNonIdempotent("PATCH", "/databases/abc123"), false);
    assert.equal(isNonIdempotent("PATCH", "/data_sources/abc123"), false);
    assert.equal(isNonIdempotent("DELETE", "/blocks/abc123"), false);
    assert.equal(isNonIdempotent("GET", "/blocks/abc123/children"), false);
  });

  it("treats unknown POST paths as writes", () => {
    assert.equal(isNonIdempotent("POST", "/some/future/endpoint"), true);
    assert.equal(isNonIdempotent("POST", "/searchlike"), true, "must not prefix-match /search");
    assert.equal(isNonIdempotent("POST", "/databases/abc/query/extra"), true);
  });
});

describe("http.ts — non-idempotent writes are not retried blind", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_retry_test", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  /** Counts how many times fetch is invoked for a given canned outcome. */
  function countingFetch(outcome: () => Promise<Response>): () => number {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      return outcome();
    }) as typeof globalThis.fetch;
    return () => attempts;
  }

  it("does not retry POST /pages on 5xx, and surfaces the hint to the user", async () => {
    const attempts = countingFetch(async () => new Response("", { status: 503 }));
    await assert.rejects(
      async () => notionRequest("POST", "/pages", { parent: {} }),
      (err: unknown) => {
        // The hint must ride on the thrown error so it reaches --format json too,
        // not just a stderr line a script would never see.
        assert.ok(err instanceof NotionCliError);
        assert.match(err.suggestions.join(" "), /cannot deduplicate a repeated write/);
        return true;
      },
    );
    assert.equal(attempts(), 1, "a 5xx on page creation must not be repeated");
  });

  it("does not retry POST /pages on a network error, and says the write may have landed", async () => {
    const attempts = countingFetch(async () => { throw new TypeError("fetch failed"); });
    await assert.rejects(
      async () => notionRequest("POST", "/pages", { parent: {} }),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal(err.code, ErrorCode.NETWORK_ERROR);
        assert.match(err.message, /may still have been applied/);
        assert.match(err.suggestions.join(" "), /cannot deduplicate a repeated write/);
        return true;
      },
    );
    assert.equal(attempts(), 1);
  });

  it("does not retry POST /pages on a self-inflicted timeout", async () => {
    const attempts = countingFetch(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await assert.rejects(
      async () => notionRequest("POST", "/pages", { parent: {} }),
      (err: unknown) => {
        assert.match((err as Error).message, /timed out/);
        assert.match((err as Error).message, /may still have been applied/);
        return true;
      },
    );
    assert.equal(attempts(), 1);
  });

  it("still retries POST /pages on 429 — the rate limiter rejects before processing", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      if (attempts < 3) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ id: "new" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    assert.deepEqual(await notionRequest("POST", "/pages", { parent: {} }), { id: "new" });
    assert.equal(attempts, 3);
  });

  it("carries the hint on the error, never through a stderr side-channel", async () => {
    // A direct process.stderr.write would bypass scrub() in src/errors.ts, letting
    // ANSI escapes in a user-supplied path reach the terminal — and would never
    // reach --format json at all. The hint must ride on the thrown error.
    const chunks: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((c: string | Uint8Array) => {
      chunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;
    countingFetch(async () => new Response("", { status: 503 }));
    try {
      await assert.rejects(async () => notionRequest("POST", "/pages", { parent: {} }));
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.equal(
      chunks.join("").includes("deduplicate"),
      false,
      "the no-retry hint must travel on the error, not an unscrubbed stderr write",
    );
  });

  it("does not retry a block append on 5xx", async () => {
    const attempts = countingFetch(async () => new Response("", { status: 503 }));
    await assert.rejects(async () => notionRequest("PATCH", "/blocks/abc/children", { children: [] }));
    assert.equal(attempts(), 1, "appending children twice duplicates blocks");
  });

  it("keeps retrying reads that use POST", async () => {
    const attempts = countingFetch(async () => new Response("", { status: 503 }));
    await assert.rejects(async () => notionRequest("POST", "/data_sources/abc/query", {}));
    assert.equal(attempts(), 5, "a query is a read and must stay resilient");
  });

  it("keeps retrying idempotent property updates", async () => {
    const attempts = countingFetch(async () => new Response("", { status: 503 }));
    await assert.rejects(async () => notionRequest("PATCH", "/pages/abc", { properties: {} }));
    assert.equal(attempts(), 5, "setting properties twice is harmless");
  });
});

describe("notionUploadFile — sending file data is not retried blind", () => {
  let originalFetch: typeof globalThis.fetch;
  let tmpFile: string;

  before(async () => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_upload_test", source: AuthSource.ENV }));
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    tmpFile = join(await mkdtemp(join(tmpdir(), "nctl-upload-")), "probe.txt");
    await writeFile(tmpFile, "probe payload");
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    resetForTesting();
    const { rm } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await rm(dirname(tmpFile), { recursive: true, force: true });
  });

  /** Stubs the two-step upload, counting only the data-send calls. */
  function stubUpload(sendOutcome: (n: number) => Promise<Response>): () => number {
    let sends = 0;
    globalThis.fetch = mock.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/send")) {
        sends++;
        return sendOutcome(sends);
      }
      return new Response(JSON.stringify({ id: "upload-1", status: "pending" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    return () => sends;
  }

  it("does not repeat the send on 5xx", async () => {
    const sends = stubUpload(async () => new Response("", { status: 503 }));
    await assert.rejects(async () => notionUploadFile(tmpFile, "probe.txt", "text/plain"));
    assert.equal(sends(), 1, "file data must not be sent twice on a 5xx");
  });

  it("does not repeat the send on a network error, and says it may have landed", async () => {
    const sends = stubUpload(async () => { throw new TypeError("socket hang up"); });
    await assert.rejects(
      async () => notionUploadFile(tmpFile, "probe.txt", "text/plain"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.match((err as Error).message, /may have partially completed/);
        return true;
      },
    );
    assert.equal(sends(), 1);
  });

  it("still retries the send on 429", async () => {
    const sends = stubUpload(async (n) =>
      n < 2
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ id: "upload-1", status: "uploaded" }), {
            status: 200, headers: { "content-type": "application/json" },
          }),
    );
    const res = await notionUploadFile(tmpFile, "probe.txt", "text/plain");
    assert.equal(res.status, "uploaded");
    assert.equal(sends(), 2);
  });
});

describe("http.ts pagination", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_page_test", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("auto-paginates when response has has_more: true", async () => {
    let call = 0;
    globalThis.fetch = mock.fn(async (url: string | URL) => {
      call++;
      const u = typeof url === "string" ? url : url.toString();
      if (call === 1) {
        assert.ok(!u.includes("start_cursor"));
        return new Response(
          JSON.stringify({
            object: "list",
            results: [{ id: "1" }, { id: "2" }],
            has_more: true,
            next_cursor: "cursor-a",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (call === 2) {
        assert.ok(u.includes("start_cursor=cursor-a"));
        return new Response(
          JSON.stringify({
            object: "list",
            results: [{ id: "3" }],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("unexpected extra call");
    }) as typeof globalThis.fetch;

    const result = await notionRequest<{ object: string; results: Array<{ id: string }> }>(
      "GET",
      "/databases/abc/query",
    );
    assert.equal(result.results.length, 3);
    assert.deepEqual(result.results.map((r) => r.id), ["1", "2", "3"]);
  });

  it("passes start_cursor via POST body for database queries", async () => {
    const capturedBodies: string[] = [];
    let call = 0;
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      call++;
      capturedBodies.push((init?.body as string) ?? "");
      if (call === 1) {
        return new Response(
          JSON.stringify({
            object: "list",
            results: [{ id: "1" }],
            has_more: true,
            next_cursor: "cursor-b",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          object: "list",
          results: [{ id: "2" }],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await notionRequest<{ results: Array<{ id: string }> }>(
      "POST",
      "/databases/abc/query",
      { filter: { property: "Status", select: { equals: "Done" } } },
    );

    assert.equal(capturedBodies.length, 2);
    const secondBody = JSON.parse(capturedBodies[1]!) as { start_cursor?: string };
    assert.equal(secondBody.start_cursor, "cursor-b");
  });
});

describe("appendBlocksChunked", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_chunk_test", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("sends all blocks in one request when under 100", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(init?.body as string) as { children: unknown[] };
      return new Response(
        JSON.stringify({ results: body.children.map((_: unknown, i: number) => ({ id: `b${i}` })) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const blocks = Array.from({ length: 5 }, (_, i) => ({ type: "paragraph", id: `${i}` }));
    const res = await appendBlocksChunked("page-1", blocks);
    assert.equal(calls, 1);
    assert.equal(res.results.length, 5);
  });

  it("splits into multiple requests when over 100 blocks", async () => {
    const capturedChunks: number[] = [];
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { children: unknown[] };
      capturedChunks.push(body.children.length);
      return new Response(
        JSON.stringify({ results: body.children.map((_: unknown, i: number) => ({ id: `b${capturedChunks.length}-${i}` })) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const blocks = Array.from({ length: 250 }, (_, i) => ({ type: "paragraph", id: `${i}` }));
    const res = await appendBlocksChunked("page-1", blocks);
    assert.deepEqual(capturedChunks, [100, 100, 50]);
    assert.equal(res.results.length, 250);
  });

  it("passes position to first chunk and chains subsequent chunks", async () => {
    const capturedPositions: Array<unknown> = [];
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { children: unknown[]; position?: unknown };
      capturedPositions.push(body.position);
      const lastId = `last-of-chunk-${capturedPositions.length}`;
      return new Response(
        JSON.stringify({ results: [{ id: lastId }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const blocks = Array.from({ length: 150 }, (_, i) => ({ type: "paragraph", id: `${i}` }));
    await appendBlocksChunked("page-1", blocks, { after: "anchor-block" });
    assert.deepEqual(capturedPositions[0], { type: "after_block", after_block: { id: "anchor-block" } });
    assert.deepEqual(capturedPositions[1], { type: "after_block", after_block: { id: "last-of-chunk-1" } });
  });
});

describe("exchangeOAuthCode respects timeout", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes an AbortSignal to the fetch call", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Response(
        JSON.stringify({ access_token: "ntn_test_abc" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const { exchangeOAuthCode } = await import("../src/http.js");
    await exchangeOAuthCode("cid", "csecret", "code123", "http://localhost:9876/callback");
    assert.ok(capturedSignal, "AbortSignal must be passed to fetch");
    assert.equal(capturedSignal!.aborted, false, "signal should not be aborted on success");
  });
});
