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

/**
 * Block types we recurse into in "content" mode. This is every block type
 * that can legitimately carry nested children in Notion AND that our
 * renderer / find-replace walkers know how to unfold. Headings and
 * paragraphs are included because `is_toggleable` headings and deeply
 * appended paragraphs both carry children, and leaving them out silently
 * drops content from `page get` and misses matches in find-replace.
 */
const CONTENT_BLOCK_TYPES = new Set([
  "bulleted_list_item", "numbered_list_item", "to_do", "table",
  "toggle", "callout", "quote",
  "heading_1", "heading_2", "heading_3",
  "paragraph",
]);

export type FetchBlockTreeMode = "content" | "all";

const MAX_RECURSION_DEPTH = 20;

export async function fetchBlockTree(
  blockId: string,
  mode: FetchBlockTreeMode = "content",
  depth: number = 0,
): Promise<Block[]> {
  const res = await notionRequest<{ results: Block[] }>("GET", `/blocks/${blockId}/children`);
  if (depth >= MAX_RECURSION_DEPTH) return res.results;
  for (const block of res.results) {
    if (!block.has_children) continue;
    const shouldRecurse = mode === "all" || CONTENT_BLOCK_TYPES.has(block.type);
    if (shouldRecurse) {
      (block as unknown as { _children: Block[] })._children = await fetchBlockTree(block.id, mode, depth + 1);
    }
  }
  return res.results;
}
