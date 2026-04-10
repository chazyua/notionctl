/**
 * Block tree utilities. The Notion API returns blocks flat (with
 * has_children: true but no inline children), so anywhere we want to
 * render or serialize a nested block subtree we have to pre-fetch the
 * tree manually. This module is the single place that does that.
 *
 * Two modes:
 *   - "lists-only" (default): recurses only into list blocks, which is
 *     what the markdown read path needs to render nested lists.
 *   - "all": recurses into every block with has_children, used by
 *     `block children --recursive` to dump a full subtree.
 *
 * Children are attached to the block as `_children` so consumers that
 * don't need nesting can ignore them (the field is non-standard and
 * never sent to the Notion API).
 */

import { notionRequest } from "./http.js";
import type { Block } from "./markdown/types.js";

const LIST_BLOCK_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do", "table"]);

export type FetchBlockTreeMode = "lists-only" | "all";

export async function fetchBlockTree(
  blockId: string,
  mode: FetchBlockTreeMode = "lists-only",
): Promise<Block[]> {
  const res = await notionRequest<{ results: Block[] }>("GET", `/blocks/${blockId}/children`);
  for (const block of res.results) {
    if (!block.has_children) continue;
    const shouldRecurse = mode === "all" || LIST_BLOCK_TYPES.has(block.type);
    if (shouldRecurse) {
      (block as unknown as { _children: Block[] })._children = await fetchBlockTree(block.id, mode);
    }
  }
  return res.results;
}
