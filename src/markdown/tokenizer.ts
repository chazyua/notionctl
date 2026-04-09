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

import type { RichText, Annotations, TextRichText } from "./types.js";
import { DEFAULT_ANNOTATIONS } from "./types.js";

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

/**
 * Write path: Markdown inline → Notion rich-text runs.
 *
 * Hand-written character-by-character scanner. No regex. Maintains a
 * stack of currently-open annotations and emits a new run every time
 * the annotation set changes or a link boundary is crossed.
 *
 * Handles (in priority order):
 *   - `...`  inline code (opaque — no annotation nesting inside)
 *   - **...** bold
 *   - _..._  italic (we prefer underscore to avoid ambiguity with *)
 *   - ~~...~~ strikethrough
 *   - [text](url) link
 *
 * Escapes: a backslash before any marker character treats it literally.
 * Unmatched markers are emitted as literal text (forgiving parser).
 */

interface ScannerState {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
}

export function markdownToRichText(md: string): RichText[] {
  if (md.length === 0) return [];

  const runs: RichText[] = [];
  const state: ScannerState = {
    bold: false,
    italic: false,
    strikethrough: false,
    code: false,
  };
  let buffer = "";

  const flush = (): void => {
    if (buffer.length === 0) return;
    runs.push(makeRun(buffer, state, null));
    buffer = "";
  };

  let i = 0;
  while (i < md.length) {
    const c = md[i]!;
    const next = md[i + 1];

    // Escape
    if (c === "\\" && next !== undefined && isMarkerChar(next)) {
      buffer += next;
      i += 2;
      continue;
    }

    // Inline code — opaque, no nesting
    if (c === "`" && !state.code) {
      flush();
      const end = md.indexOf("`", i + 1);
      if (end === -1) {
        buffer += c;
        i++;
        continue;
      }
      runs.push(makeRun(md.slice(i + 1, end), { ...state, code: true }, null));
      i = end + 1;
      continue;
    }

    // Bold **
    if (c === "*" && next === "*") {
      flush();
      state.bold = !state.bold;
      i += 2;
      continue;
    }

    // Strikethrough ~~
    if (c === "~" && next === "~") {
      flush();
      state.strikethrough = !state.strikethrough;
      i += 2;
      continue;
    }

    // Italic _
    if (c === "_") {
      flush();
      state.italic = !state.italic;
      i += 1;
      continue;
    }

    // Link [text](url)
    if (c === "[") {
      flush();
      const linkEnd = findLinkEnd(md, i);
      if (linkEnd !== null) {
        const labelStart = i + 1;
        const labelEnd = linkEnd.labelEnd;
        const urlStart = linkEnd.urlStart;
        const urlEnd = linkEnd.urlEnd;
        const label = md.slice(labelStart, labelEnd);
        const url = md.slice(urlStart, urlEnd);
        runs.push(makeRun(label, state, url));
        i = urlEnd + 1;
        continue;
      }
    }

    buffer += c;
    i++;
  }

  flush();
  return runs;
}

function isMarkerChar(c: string): boolean {
  return c === "*" || c === "_" || c === "~" || c === "`" || c === "[" || c === "]" || c === "\\";
}

function findLinkEnd(md: string, startIdx: number): { labelEnd: number; urlStart: number; urlEnd: number } | null {
  // startIdx points at '['. Find matching ']', then '(' immediately after, then ')'.
  let depth = 1;
  let i = startIdx + 1;
  while (i < md.length) {
    if (md[i] === "\\") { i += 2; continue; }
    if (md[i] === "[") depth++;
    if (md[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  if (depth !== 0) return null;
  const labelEnd = i;
  if (md[i + 1] !== "(") return null;
  const urlStart = i + 2;
  const urlEnd = md.indexOf(")", urlStart);
  if (urlEnd === -1) return null;
  return { labelEnd, urlStart, urlEnd };
}

function makeRun(content: string, state: ScannerState, linkUrl: string | null): TextRichText {
  return {
    type: "text",
    text: {
      content,
      link: linkUrl ? { url: linkUrl } : null,
    },
    annotations: {
      ...DEFAULT_ANNOTATIONS,
      bold: state.bold,
      italic: state.italic,
      strikethrough: state.strikethrough,
      code: state.code,
    },
    plain_text: content,
    href: linkUrl,
  };
}
