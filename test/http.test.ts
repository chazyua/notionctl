import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { notionRequest, appendBlocksChunked, notionUploadFile, setTokenProvider, resetForTesting } from "../src/http.js";
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
    assert.equal(capturedHeaders["notion-version"], "2022-06-28");
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

describe("notionUploadFile", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_upload_test", source: AuthSource.ENV }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("uploads a provided Buffer without touching the filesystem", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const payload = Buffer.from("hello notion", "utf8");

    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push({ url: u, method: init?.method ?? "GET" });

      if (u.endsWith("/file_uploads")) {
        return new Response(
          JSON.stringify({ id: "upload-123", status: "pending" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/file_uploads/upload-123/send")) {
        // verify we sent multipart FormData (body is a FormData/ReadableStream)
        return new Response(
          JSON.stringify({ id: "upload-123", status: "uploaded" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const result = await notionUploadFile(payload, "hello.txt", "text/plain");

    assert.equal(result.id, "upload-123");
    assert.equal(result.status, "uploaded");
    assert.equal(calls.length, 2);
    assert.ok(calls[0]!.url.endsWith("/file_uploads"));
    assert.ok(calls[1]!.url.endsWith("/file_uploads/upload-123/send"));
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

  it("passes after ID to first chunk and chains subsequent chunks", async () => {
    const capturedAfters: Array<string | undefined> = [];
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { children: unknown[]; after?: string };
      capturedAfters.push(body.after);
      const lastId = `last-of-chunk-${capturedAfters.length}`;
      return new Response(
        JSON.stringify({ results: [{ id: lastId }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const blocks = Array.from({ length: 150 }, (_, i) => ({ type: "paragraph", id: `${i}` }));
    await appendBlocksChunked("page-1", blocks, { after: "anchor-block" });
    assert.equal(capturedAfters[0], "anchor-block");
    assert.equal(capturedAfters[1], "last-of-chunk-1");
  });
});
