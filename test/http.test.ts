import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { notionRequest, setTokenProvider, resetForTesting } from "../src/http.js";
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
