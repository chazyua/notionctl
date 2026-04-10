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

  it("DRIFT when remote edited after last sync and hash differs", () => {
    const state = classifySyncState({
      frontmatter: {
        notion_id: "abc",
        notion_hash: "sha256:stale",
        notion_synced_at: "2026-04-01T10:00:00Z",
      },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T12:00:00Z",  // remote newer than sync
    });
    assert.equal(state, SyncState.DRIFT);
  });

  it("CHANGED (not DRIFT) when remote edited before last sync", () => {
    const state = classifySyncState({
      frontmatter: {
        notion_id: "abc",
        notion_hash: "sha256:stale",
        notion_synced_at: "2026-04-01T12:00:00Z",
      },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T10:00:00Z",  // remote older than sync
    });
    assert.equal(state, SyncState.CHANGED);
  });

  it("CHANGED (not DRIFT) when no notion_synced_at in frontmatter", () => {
    const state = classifySyncState({
      frontmatter: { notion_id: "abc", notion_hash: "sha256:stale" },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T12:00:00Z",
    });
    assert.equal(state, SyncState.CHANGED);
  });

  it("CHANGED (not DRIFT) when remoteEditedAt is undefined", () => {
    const state = classifySyncState({
      frontmatter: {
        notion_id: "abc",
        notion_hash: "sha256:stale",
        notion_synced_at: "2026-04-01T10:00:00Z",
      },
      localBody: "# Updated",
      remoteEditedAt: undefined,
    });
    assert.equal(state, SyncState.CHANGED);
  });
});
