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
  // Track whether italic was opened with _ or * so we close with the same char.
  // We switch to * when the preceding char is a word char (intraword _ would be
  // parsed as literal by the write-path CommonMark scanner).
  let italicChar = "_";

  for (const run of runs) {
    const desired = activeMarkers(run.annotations);
    const hasLink = isLinkRun(run);

    // Find the deepest stack marker that must close (not in desired).
    // Everything above it must also close, even if still desired — we'll
    // re-open those after the unwanted marker is gone.
    let mustCloseFrom = openStack.length;
    for (let j = 0; j < openStack.length; j++) {
      if (!desired.includes(openStack[j]!)) {
        mustCloseFrom = j;
        break;
      }
    }

    // Close from top down to mustCloseFrom, collecting markers that
    // need to re-open because they're still in `desired`.
    const toReopen: MarkerKey[] = [];
    while (openStack.length > mustCloseFrom) {
      const top = openStack.pop()!;
      out += top === "italic" ? italicChar : MARKERS[top];
      if (desired.includes(top)) {
        toReopen.push(top);
      }
    }

    // Re-open markers that were closed prematurely (reverse to restore order).
    for (let j = toReopen.length - 1; j >= 0; j--) {
      const m = toReopen[j]!;
      const openChar = (m === "italic")
        ? (/\w/.test(out[out.length - 1] ?? "") ? "*" : "_")
        : MARKERS[m];
      if (m === "italic") italicChar = openChar;
      out += openChar;
      openStack.push(m);
    }

    // Open any markers in `desired` that are not currently open.
    for (const marker of desired) {
      if (!openStack.includes(marker)) {
        const openChar = (marker === "italic")
          ? (/\w/.test(out[out.length - 1] ?? "") ? "*" : "_")
          : MARKERS[marker];
        if (marker === "italic") italicChar = openChar;
        out += openChar;
        openStack.push(marker);
      }
    }

    // Guard against intraword underscore: if italic just closed with `_` and
    // the next content starts with a word char, switch the already-emitted `_`
    // to `*`. This handles the close side; the open side uses italicChar above.
    const content = runContent(run);
    const firstContentChar = hasLink ? "[" : (content[0] ?? "");
    if (
      out.length >= 2 &&
      out[out.length - 1] === "_" &&
      /\w/.test(out[out.length - 2]!) &&
      /\w/.test(firstContentChar)
    ) {
      if (openStack.length > 0) {
        // There are still open markers — close and reopen them to bracket the _
        const remaining = [...openStack];
        while (openStack.length > 0) {
          const top = openStack.pop()!;
          out += top === "italic" ? italicChar : MARKERS[top];
        }
        for (const m of remaining) {
          const openChar = (m === "italic")
            ? (/\w/.test(out[out.length - 1] ?? "") ? "*" : "_")
            : MARKERS[m];
          if (m === "italic") italicChar = openChar;
          out += openChar;
          openStack.push(m);
        }
      } else {
        // No remaining open markers — switch the trailing _ to * to avoid
        // the intraword rule treating it as literal.
        out = out.slice(0, -1) + "*";
        // Also fix the matching open _
        for (let k = out.length - 2; k >= 0; k--) {
          if (out[k] === "_" && (k === 0 || out[k - 1] !== "_") && (out[k + 1] !== "_")) {
            out = out.slice(0, k) + "*" + out.slice(k + 1);
            break;
          }
        }
      }
    }

    // Emit the run content
    if (hasLink) {
      const url = linkUrl(run);
      out += `[${content}](${url})`;
    } else {
      out += content;
    }
  }

  // Close any remaining open markers
  while (openStack.length > 0) {
    const top = openStack.pop()!;
    out += top === "italic" ? italicChar : MARKERS[top];
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

/**
 * Find-and-replace across a rich-text array, treating the runs as a single
 * flat string. A match that spans multiple text runs is replaced with the
 * annotations of the match's first character. Non-text runs (equation,
 * mention) are opaque — any match that would cross them is skipped.
 *
 * Regression fix: BUG-09 (find-replace could not span run boundaries).
 */
export function findReplaceRichText(
  runs: RichText[],
  find: string,
  replace: string,
): { runs: RichText[]; count: number } {
  if (find.length === 0) return { runs, count: 0 };

  interface FlatChar {
    c: string;
    ref: RichText;
  }
  const flat: FlatChar[] = [];
  for (const run of runs) {
    const content = run.type === "text" ? run.text.content : run.plain_text;
    for (const c of content) flat.push({ c, ref: run });
  }

  let full = flat.map((f) => f.c).join("");
  let count = 0;
  let searchStart = 0;

  while (searchStart <= full.length) {
    const idx = full.indexOf(find, searchStart);
    if (idx === -1) break;

    let crossesNonText = false;
    for (let k = idx; k < idx + find.length; k++) {
      if (flat[k]!.ref.type !== "text") {
        crossesNonText = true;
        break;
      }
    }
    if (crossesNonText) {
      searchStart = idx + 1;
      continue;
    }

    const firstRef = flat[idx]!.ref;
    const replacementChars: FlatChar[] = [];
    for (const c of replace) replacementChars.push({ c, ref: firstRef });
    flat.splice(idx, find.length, ...replacementChars);
    full = flat.map((f) => f.c).join("");
    searchStart = idx + replace.length;
    count++;
  }

  if (count === 0) return { runs, count: 0 };

  const result: RichText[] = [];
  let i = 0;
  while (i < flat.length) {
    const currentRef = flat[i]!.ref;
    const start = i;
    while (i < flat.length && flat[i]!.ref === currentRef) i++;
    if (currentRef.type === "text") {
      const content = flat.slice(start, i).map((f) => f.c).join("");
      const linked = (currentRef as TextRichText).text.link;
      result.push({
        type: "text",
        text: { content, link: linked },
        annotations: { ...currentRef.annotations },
        plain_text: content,
        href: currentRef.href,
      } as RichText);
    } else {
      // Non-text runs are never split by find (we skip matches that cross them)
      result.push(currentRef);
    }
  }

  return { runs: result, count };
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

    // Inline equation $...$  (single $, not $$).
    // Tight-flanking heuristic (BUG-03): only treat $...$ as an equation when
    // the opener is followed by non-whitespace non-digit, and the closer is
    // preceded by non-whitespace. This avoids mangling currency like "$100".
    if (
      c === "$" &&
      next !== undefined &&
      next !== "$" &&
      /\S/.test(next) &&
      !/[0-9]/.test(next)
    ) {
      let end = -1;
      for (let j = i + 1; j < md.length; j++) {
        if (md[j] === "\\") { j++; continue; }
        if (md[j] === "$" && j > i + 1 && /\S/.test(md[j - 1]!)) {
          end = j;
          break;
        }
      }
      if (end !== -1) {
        flush();
        const expr = md.slice(i + 1, end);
        runs.push({
          type: "equation",
          equation: { expression: expr },
          annotations: { ...DEFAULT_ANNOTATIONS },
          plain_text: `$${expr}$`,
          href: null,
        } as unknown as RichText);
        i = end + 1;
        continue;
      }
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

    // Italic * (single asterisk — checked after ** so bold is consumed first).
    // Lightweight CommonMark flanking (BUG-02): the opener must be followed by
    // non-whitespace, and there must be a matching closer preceded by
    // non-whitespace. Otherwise emit as literal — this keeps things like
    // "1 * 2", "int *ptr", and "foo*bar" (with no pair) out of italic runs.
    if (c === "*") {
      if (state.italic) {
        const prev = md[i - 1];
        if (prev !== undefined && /\S/.test(prev)) {
          flush();
          state.italic = false;
          i += 1;
          continue;
        }
      } else if (next !== undefined && /\S/.test(next) && next !== "*") {
        let foundCloser = false;
        for (let j = i + 1; j < md.length; j++) {
          if (md[j] === "\\") { j++; continue; }
          if (md[j] === "`") {
            const codeEnd = md.indexOf("`", j + 1);
            if (codeEnd === -1) break;
            j = codeEnd;
            continue;
          }
          if (md[j] === "*" && /\S/.test(md[j - 1] ?? "")) {
            foundCloser = true;
            break;
          }
        }
        if (foundCloser) {
          flush();
          state.italic = true;
          i += 1;
          continue;
        }
      }
      // Fall-through: treat the * as literal.
      buffer += c;
      i += 1;
      continue;
    }

    // Strikethrough ~~
    if (c === "~" && next === "~") {
      flush();
      state.strikethrough = !state.strikethrough;
      i += 2;
      continue;
    }

    // Italic _ — only when not surrounded by word characters (CommonMark intraword rule)
    if (c === "_" && !isIntraword(md, i)) {
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
  return splitLongRuns(runs);
}

function isMarkerChar(c: string): boolean {
  return c === "*" || c === "_" || c === "~" || c === "`" || c === "[" || c === "]" || c === "\\";
}

/** CommonMark rule: _ is not emphasis when both sides are word characters (e.g. multi_select) */
function isIntraword(md: string, idx: number): boolean {
  const prev = idx > 0 ? md[idx - 1]! : "";
  const next = idx < md.length - 1 ? md[idx + 1]! : "";
  return /\w/.test(prev) && /\w/.test(next);
}

function findLinkEnd(md: string, startIdx: number): { labelEnd: number; urlStart: number; urlEnd: number } | null {
  // startIdx points at '['. Find matching ']', then '(' immediately after, then matching ')'.
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
  // Match balanced parentheses in the URL (e.g. Wikipedia links)
  let parenDepth = 1;
  let j = urlStart;
  while (j < md.length && parenDepth > 0) {
    if (md[j] === "\\") { j += 2; continue; }
    if (md[j] === "(") parenDepth++;
    else if (md[j] === ")") parenDepth--;
    if (parenDepth > 0) j++;
  }
  if (parenDepth !== 0) return null;
  return { labelEnd, urlStart, urlEnd: j };
}

const MAX_RICH_TEXT_LENGTH = 2000;

/**
 * Split any rich-text runs whose content exceeds Notion's 2000-character
 * limit into multiple runs with identical annotations.
 *
 * Splits at UTF-16 code-unit boundaries but never in the middle of a
 * surrogate pair (BUG-B), so emoji and astral-plane characters stay intact.
 */
function splitLongRuns(runs: RichText[]): RichText[] {
  const result: RichText[] = [];
  for (const run of runs) {
    if (run.type !== "text" || run.text.content.length <= MAX_RICH_TEXT_LENGTH) {
      result.push(run);
      continue;
    }
    const content = run.text.content;
    const textRun = run as TextRichText;
    let offset = 0;
    while (offset < content.length) {
      let end = Math.min(offset + MAX_RICH_TEXT_LENGTH, content.length);
      if (end < content.length) {
        const code = content.charCodeAt(end - 1);
        if (code >= 0xD800 && code <= 0xDBFF) {
          end -= 1;  // don't split a surrogate pair
        }
      }
      const chunk = content.slice(offset, end);
      result.push({
        type: "text",
        text: {
          content: chunk,
          link: textRun.text.link,
        },
        annotations: { ...textRun.annotations },
        plain_text: chunk,
        href: textRun.href,
      });
      offset = end;
    }
  }
  return result;
}

const LINK_SCHEME_RE = /^(https?:\/\/|notion:\/\/|mailto:|tel:)/i;

function makeRun(content: string, state: ScannerState, linkUrl: string | null): TextRichText {
  return {
    type: "text",
    text: {
      content,
      link: linkUrl && LINK_SCHEME_RE.test(linkUrl) ? { url: linkUrl } : null,
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
