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

/**
 * Set by the CLI entry so tokenizer warnings (e.g. dropped link schemes)
 * surface on stderr without coupling this module to process.stderr.
 * Tests leave it unset so test output stays clean.
 */
let warnHandler: ((msg: string) => void) | null = null;
export function setTokenizerWarnHandler(fn: ((msg: string) => void) | null): void {
  warnHandler = fn;
}

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

    // Inline equation $...$  (single $, not $$)
    // Uses a pandoc-style tightness rule so currency like "$5 and $10" is not
    // misparsed: the opening $ must be followed by non-whitespace, the closing
    // $ must be preceded by non-whitespace, and the closing $ must not be
    // followed by an alphanumeric (so "$5$45" isn't two concatenated "equations").
    if (c === "$" && next !== "$" && next !== undefined && !/\s/.test(next)) {
      const end = md.indexOf("$", i + 1);
      if (end !== -1 && end > i + 1 && !/\s/.test(md[end - 1]!)) {
        const afterClose = md[end + 1];
        if (afterClose === undefined || !/[A-Za-z0-9]/.test(afterClose)) {
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
    // Pragmatic rule: a lone * toggles italic only when it sits at a word
    // boundary or inside an existing bold span. This preserves literals like
    // "2*3", "*.md", and "$5 * $10" without requiring escapes, while still
    // parsing proper "*word*" emphasis and "**word*italic***" nesting.
    if (c === "*" && isAsteriskEmphasis(md, i, state)) {
      flush();
      state.italic = !state.italic;
      i += 1;
      continue;
    }
    if (c === "*") {
      // Not an emphasis delimiter — treat as literal text.
      buffer += c;
      i++;
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

    // Link [text](url) — CommonMark also supports [text](url "title") where
    // the title is surrounded by double-quotes, single-quotes, or parens.
    // Notion's API doesn't have a title field on links, so we strip it.
    if (c === "[") {
      flush();
      const linkEnd = findLinkEnd(md, i);
      if (linkEnd !== null) {
        const labelStart = i + 1;
        const labelEnd = linkEnd.labelEnd;
        const urlStart = linkEnd.urlStart;
        const urlEnd = linkEnd.urlEnd;
        const label = md.slice(labelStart, labelEnd);
        const url = stripLinkTitle(md.slice(urlStart, urlEnd));
        if (url.length > 0 && !isAllowedLinkUrl(url) && warnHandler) {
          warnHandler(
            `notionctl: link URL '${url}' has an unsupported scheme — kept label '${label}' as plain text. Notion accepts: https, http, mailto, tel, notion, ftp, sms.`,
          );
        }
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

/**
 * Strip an optional CommonMark link title from the raw URL portion of a
 * `[text](url "title")` construct. The title can be wrapped in `"..."`,
 * `'...'`, or `(...)`. We trim trailing whitespace + the title if present,
 * returning just the URL.
 */
function stripLinkTitle(raw: string): string {
  const trimmed = raw.trimEnd();
  if (trimmed.length === 0) return raw;
  const last = trimmed[trimmed.length - 1]!;
  if (last === '"' || last === "'") {
    const open = trimmed.lastIndexOf(last, trimmed.length - 2);
    if (open > 0 && /\s/.test(trimmed[open - 1]!)) {
      return trimmed.slice(0, open).trimEnd();
    }
  }
  if (last === ")") {
    const open = trimmed.lastIndexOf("(", trimmed.length - 2);
    if (open > 0 && /\s/.test(trimmed[open - 1]!) && !trimmed.slice(open + 1, -1).includes("(")) {
      return trimmed.slice(0, open).trimEnd();
    }
  }
  return raw;
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

/**
 * Word-boundary rule for * emphasis. We apply it asymmetrically:
 *   - Closing (italic currently open): accept any *. Once italic is open,
 *     the next * closes it — matching CommonMark's balancing behavior and
 *     keeping ***bold italic*** working.
 *   - Inside bold (state.bold true): accept any *. The surrounding ** already
 *     establishes emphasis context, so nested "word*italic*" is fine.
 *   - Otherwise (italic closed, bold closed): require a non-alphanumeric
 *     before and an alphanumeric after — the classic word-boundary opener
 *     that rejects 2*3, *.md, $5 * $10.
 */
function isAsteriskEmphasis(md: string, idx: number, state: ScannerState): boolean {
  if (state.italic) return true;
  if (state.bold) return true;
  const prev = idx > 0 ? md[idx - 1]! : "";
  const next = idx < md.length - 1 ? md[idx + 1]! : "";
  return !/[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next);
}

/**
 * Link URL safelist for rich-text conversion. Notion's API only accepts a
 * small set of URL schemes in `text.link.url`; anything else is rejected at
 * write time with "Invalid URL for link". The schemes below are the ones
 * verified to work against the live API. Fragment-only (#anchor) and
 * relative (/path) URLs are NOT in this list — Notion rejects both — so
 * those links degrade gracefully to plain text.
 */
const ALLOWED_LINK_SCHEMES = /^(https?|mailto|tel|notion|ftp|sms):/i;
function isAllowedLinkUrl(url: string): boolean {
  if (url.length === 0) return false;
  return ALLOWED_LINK_SCHEMES.test(url);
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
    for (let offset = 0; offset < content.length; offset += MAX_RICH_TEXT_LENGTH) {
      const chunk = content.slice(offset, offset + MAX_RICH_TEXT_LENGTH);
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
    }
  }
  return result;
}

function makeRun(content: string, state: ScannerState, linkUrl: string | null): TextRichText {
  return {
    type: "text",
    text: {
      content,
      link: linkUrl && isAllowedLinkUrl(linkUrl) ? { url: linkUrl } : null,
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
