import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContentHash, classifySyncState, SyncState } from "../../src/sync/sync.js";

describe("computeContentHash", () => {
  it("produces deterministic sha256 prefixed hash", () => {
    const h1 = computeContentHash("# Hello\n\nBody");
    const h2 = computeContentHash("# Hello\n\nBody");
    assert.equal(h1, h2);
    assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  });

  it("different content produces different hashes", () => {
    assert.notEqual(computeContentHash("a"), computeContentHash("b"));
  });
});

describe("classifySyncState", () => {
  it("CREATE when no notion_id present", () => {
    const state = classifySyncState({
      frontmatter: {},
      localBody: "# New",
      remoteEditedAt: undefined,
    });
    assert.equal(state, SyncState.CREATE);
  });

  it("UNCHANGED when hash matches", () => {
    const body = "# Body";
    const hash = computeContentHash(body);
    const state = classifySyncState({
      frontmatter: { notion_id: "abc", notion_hash: hash },
      localBody: body,
      remoteEditedAt: "2026-04-01T00:00:00Z",
    });
    assert.equal(state, SyncState.UNCHANGED);
  });

  it("CHANGED when hash differs", () => {
    const state = classifySyncState({
      frontmatter: { notion_id: "abc", notion_hash: "sha256:stale" },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T00:00:00Z",
    });
    assert.equal(state, SyncState.CHANGED);
  });
});
