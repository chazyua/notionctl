import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContentHash, classifySyncState, SyncState, RESERVED_FRONTMATTER_KEYS } from "../../src/sync/sync.js";

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

  it("DRIFT detected when remote edited in a later minute", () => {
    // Notion's last_edited_time has minute precision.
    // sync at 10:05:45, remote edit in a later minute (10:06:00) → DRIFT
    const state = classifySyncState({
      frontmatter: {
        notion_id: "abc",
        notion_hash: "sha256:stale",
        notion_synced_at: "2026-04-01T10:05:45.000Z",
      },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T10:06:00.000Z",
    });
    assert.equal(state, SyncState.DRIFT);
  });

  it("CHANGED (not DRIFT) when remote time is same minute as sync (Notion API limitation)", () => {
    // Notion truncates to minute precision, so remote edit at 10:05:50 shows as 10:05:00
    // which is less than sync time 10:05:45 → cannot detect drift (known limitation)
    const state = classifySyncState({
      frontmatter: {
        notion_id: "abc",
        notion_hash: "sha256:stale",
        notion_synced_at: "2026-04-01T10:05:45.000Z",
      },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T10:05:00.000Z",
    });
    assert.equal(state, SyncState.CHANGED);
  });
});

describe("RESERVED_FRONTMATTER_KEYS", () => {
  it("contains all three sync metadata keys", () => {
    assert.ok(RESERVED_FRONTMATTER_KEYS.has("notion_id"));
    assert.ok(RESERVED_FRONTMATTER_KEYS.has("notion_hash"));
    assert.ok(RESERVED_FRONTMATTER_KEYS.has("notion_synced_at"));
  });

  it("does not leak unrelated keys", () => {
    assert.equal(RESERVED_FRONTMATTER_KEYS.has("title"), false);
    assert.equal(RESERVED_FRONTMATTER_KEYS.has("status"), false);
  });
});

describe("an unreadable notion_synced_at must not disable drift detection", () => {
  // A truncated or hand-mangled timestamp is still valid YAML, so nothing
  // upstream rejects it. Parsing it to NaN silently skipped the comparison and
  // the push overwrote real remote edits with no warning and no --force.
  for (const bad of ["2026-04-01T10:0", "not-a-date", "", "2026-13-45T99:99:99Z"]) {
    it(`fails closed on notion_synced_at: ${JSON.stringify(bad)}`, () => {
      const state = classifySyncState({
        frontmatter: { notion_id: "abc", notion_hash: "sha256:stale", notion_synced_at: bad },
        localBody: "# Local edit",
        remoteEditedAt: "2026-04-01T10:05:00.000Z",
      });
      assert.equal(state, SyncState.DRIFT, `expected DRIFT for ${JSON.stringify(bad)}`);
    });
  }

  it("still treats a genuinely absent baseline as CHANGED, not drift", () => {
    // No notion_synced_at at all is the "never synced before" case and must
    // keep pushing — only a present-but-unreadable value fails closed.
    const state = classifySyncState({
      frontmatter: { notion_id: "abc", notion_hash: "sha256:stale" },
      localBody: "# Local edit",
      remoteEditedAt: "2026-04-01T10:05:00.000Z",
    });
    assert.equal(state, SyncState.CHANGED);
  });

  it("still reports UNCHANGED when the hash matches, whatever the timestamp says", () => {
    const body = "# Same";
    const state = classifySyncState({
      frontmatter: {
        notion_id: "abc",
        notion_hash: computeContentHash(body),
        notion_synced_at: "garbage",
      },
      localBody: body,
      remoteEditedAt: "2026-04-01T10:05:00.000Z",
    });
    assert.equal(state, SyncState.UNCHANGED);
  });
});
