import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { notionRequest, setTokenProvider } from "../../src/http.js";
import { AuthSource } from "../../src/auth.js";

const token = process.env.NOTION_TEST_TOKEN;
const testPageId = process.env.NOTION_TEST_PAGE_ID;
const testDbId = process.env.NOTION_TEST_DB_ID;

describe("integration: happy path", { skip: !token || !testPageId }, () => {
  before(() => {
    setTokenProvider(async () => ({ token: token!, source: AuthSource.ENV }));
  });

  it("whoami returns a bot user", async () => {
    const me = await notionRequest<{ type?: string }>("GET", "/users/me");
    assert.equal(me.type, "bot");
  });

  it("page get returns the test page", async () => {
    const page = await notionRequest<{ id: string }>("GET", `/pages/${testPageId}`);
    assert.ok(page.id);
  });

  it("search returns a results array", async () => {
    const res = await notionRequest<{ results: unknown[] }>("POST", "/search", { query: "" });
    assert.ok(Array.isArray(res.results));
  });

  it("block children fetches without error", async () => {
    const res = await notionRequest<{ results: unknown[] }>("GET", `/blocks/${testPageId}/children`);
    assert.ok(Array.isArray(res.results));
  });

  it("db query runs if test db is configured", { skip: !testDbId }, async () => {
    const res = await notionRequest<{ results: unknown[] }>("POST", `/databases/${testDbId}/query`, {});
    assert.ok(Array.isArray(res.results));
  });
});
