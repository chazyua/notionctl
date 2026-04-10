/**
 * Page sync state machine.
 *
 * The sync command treats a local Markdown file as the source of truth
 * and Notion as the mirror. The local file carries `notion_id` (the
 * page UUID) and `notion_hash` (sha256 of the body at last sync) in
 * its YAML front-matter. On each invocation:
 *
 *   - No notion_id         → CREATE  → create new page, write id + hash
 *   - Local hash matches   → UNCHANGED → no-op (idempotent)
 *   - Local hash differs   → CHANGED   → push update, refresh hash
 *   - Remote edited newer  → DRIFT     → error by default; --force to overwrite
 *
 * This file owns the classification logic. The command layer
 * (commands/page.ts) calls these functions and issues the HTTP ops.
 */

import { createHash } from "node:crypto";
import type { YamlObject } from "../utils/yaml.js";

export enum SyncState {
  CREATE = "CREATE",
  UNCHANGED = "UNCHANGED",
  CHANGED = "CHANGED",
  DRIFT = "DRIFT",
}

export function computeContentHash(body: string): string {
  const h = createHash("sha256");
  h.update(body, "utf8");
  return `sha256:${h.digest("hex")}`;
}

export interface ClassifyInput {
  frontmatter: YamlObject;
  localBody: string;
  remoteEditedAt: string | undefined;
  remoteHashFromLastSync?: string;
}

export function classifySyncState(input: ClassifyInput): SyncState {
  const notionId = input.frontmatter.notion_id;
  if (!notionId || typeof notionId !== "string") return SyncState.CREATE;

  const storedHash = input.frontmatter.notion_hash;
  const currentHash = computeContentHash(input.localBody);

  if (typeof storedHash === "string" && storedHash === currentHash) {
    return SyncState.UNCHANGED;
  }

  // Drift detection: if remote was edited after our last sync, the remote
  // has diverged and we refuse to blindly overwrite without --force.
  // LIMITATION: Notion's last_edited_time has minute precision (truncated to :00.000Z).
  // Edits within the same minute as our last sync cannot be detected as drift because
  // the timestamp doesn't change. This is at most a ~59-second window.
  const lastSyncedAt = input.frontmatter.notion_synced_at;
  if (input.remoteEditedAt && typeof lastSyncedAt === "string") {
    const remoteTime = new Date(input.remoteEditedAt).getTime();
    const syncTime = new Date(lastSyncedAt).getTime();
    if (Number.isFinite(remoteTime) && Number.isFinite(syncTime) && remoteTime > syncTime) {
      return SyncState.DRIFT;
    }
  }

  return SyncState.CHANGED;
}
