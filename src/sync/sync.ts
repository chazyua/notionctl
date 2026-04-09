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

  // V1 does not implement remote-edit drift detection (requires
  // storing a remote snapshot). Stub returns CHANGED — V2 adds DRIFT.
  return SyncState.CHANGED;
}
