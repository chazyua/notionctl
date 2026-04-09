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
