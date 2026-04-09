/**
 * Rich-text tokenizer — read path (runs → markdown) and write path
 * (markdown → runs).
 *
 * Notion's rich_text is a flat array of annotated runs. Markdown's
 * annotations nest. The bidirectional conversion has to handle nesting
 * correctly using a stack of open annotations, or you get bugs like
 * "**a**_b_**c**" instead of "**a _b_ c**".
 *
 * This file implements only the rich-text (inline) conversion. Block-level
 * conversion lives in read.ts and write.ts.
 */

import type { RichText, Annotations } from "./types.js";

type MarkerKey = "bold" | "italic" | "strikethrough" | "code";
const MARKER_ORDER: MarkerKey[] = ["bold", "italic", "strikethrough", "code"];
const MARKERS: Record<MarkerKey, string> = {
  bold: "**",
  italic: "_",
  strikethrough: "~~",
  code: "`",
};

export function richTextToMarkdown(runs: RichText[]): string {
  let out = "";
  const openStack: MarkerKey[] = [];

  for (const run of runs) {
    const desired = activeMarkers(run.annotations);
    const hasLink = isLinkRun(run);

    // Determine which open markers must close (any currently open that
    // are not in `desired`) — close them in reverse order.
    while (openStack.length > 0 && !desired.includes(openStack[openStack.length - 1]!)) {
      const top = openStack.pop()!;
      out += MARKERS[top];
    }

    // Open any markers in `desired` that are not currently open.
    for (const marker of desired) {
      if (!openStack.includes(marker)) {
        out += MARKERS[marker];
        openStack.push(marker);
      }
    }

    // Emit the run content
    const content = runContent(run);
    if (hasLink) {
      const url = linkUrl(run);
      out += `[${content}](${url})`;
    } else {
      out += content;
    }
  }

  // Close any remaining open markers
  while (openStack.length > 0) {
    out += MARKERS[openStack.pop()!];
  }

  return out;
}

function activeMarkers(annotations: Annotations): MarkerKey[] {
  const markers: MarkerKey[] = [];
  for (const key of MARKER_ORDER) {
    if (annotations[key]) markers.push(key);
  }
  return markers;
}

function isLinkRun(run: RichText): boolean {
  if (run.type !== "text") return false;
  return run.text.link !== null && run.text.link !== undefined;
}

function linkUrl(run: RichText): string {
  if (run.type !== "text" || !run.text.link) return "";
  return run.text.link.url;
}

function runContent(run: RichText): string {
  if (run.type === "text") return run.text.content;
  if (run.type === "equation") return `$${run.equation.expression}$`;
  if (run.type === "mention") {
    const m = run.mention;
    if (m.type === "user") return `@user:${m.user.id}`;
    if (m.type === "page") return `[${run.plain_text}](notion://page/${m.page.id})`;
    if (m.type === "database") return `[${run.plain_text}](notion://database/${m.database.id})`;
    if (m.type === "date") {
      const range = m.date.end ? `${m.date.start}..${m.date.end}` : m.date.start;
      return `<${range}>`;
    }
    if (m.type === "link_preview") return `[${run.plain_text}](${m.link_preview.url})`;
  }
  return run.plain_text;
}
