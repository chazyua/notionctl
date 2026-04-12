/**
 * Output formatting and TTY detection.
 *
 * Rule: when stdout is a TTY, commands emit pretty output (tables, colored
 * text, human status lines). When piped, commands emit machine-parseable
 * output (JSON by default, md for commands where md is the natural form).
 *
 * Individual commands declare their default format. If --format is passed
 * explicitly, it wins. If stdout is piped and default is "table", we
 * coerce to JSON so scripts never receive ANSI-decorated text.
 */

import { NotionCliError, ErrorCode } from "./errors.js";

export type Format = "md" | "json" | "table" | "csv";

export interface ChooseFormatOpts {
  isTty: boolean;
  defaultFormat: Format;
}

const VALID_FORMATS = new Set<string>(["md", "json", "table", "csv"]);

export function chooseFormat(
  explicit: Format | undefined,
  opts: ChooseFormatOpts,
): Format {
  if (explicit !== undefined) {
    if (!VALID_FORMATS.has(explicit)) {
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Unknown format: ${explicit}. Valid formats: md, json, table, csv`,
      );
    }
    return explicit;
  }
  if (!opts.isTty && opts.defaultFormat === "table") return "json";
  return opts.defaultFormat;
}

export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export interface TableInput {
  columns: string[];
  rows: string[][];
}

/**
 * Approximate visual width of a string, ignoring ANSI but counting CJK,
 * full-width, and emoji code points as 2 cells. Zero-width combining marks
 * and joiners count as 0. Good enough for human-readable terminal tables.
 */
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 0) continue;
    if (
      (code >= 0x0300 && code <= 0x036F) ||  // combining diacritics
      (code >= 0x200B && code <= 0x200F) ||  // zero-width spaces / direction
      code === 0x202A || code === 0x202B || code === 0x202C || code === 0x202D || code === 0x202E ||
      code === 0xFEFF ||                     // BOM
      (code >= 0xFE00 && code <= 0xFE0F)     // variation selectors
    ) {
      continue;
    }
    if (
      (code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
      (code >= 0x2E80 && code <= 0x9FFF) ||  // CJK (incl. ext A)
      (code >= 0xA000 && code <= 0xA4CF) ||  // Yi
      (code >= 0xAC00 && code <= 0xD7A3) ||  // Hangul Syllables
      (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compat
      (code >= 0xFE30 && code <= 0xFE4F) ||  // CJK Compat Forms
      (code >= 0xFF00 && code <= 0xFF60) ||  // Fullwidth Latin
      (code >= 0xFFE0 && code <= 0xFFE6) ||  // Fullwidth signs
      (code >= 0x1F300 && code <= 0x1FAFF) || // Emoji
      (code >= 0x20000 && code <= 0x3FFFD)   // CJK Ext B-G
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padVisual(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

/** Collapse embedded newlines so a cell never spans multiple rows. */
function sanitizeCell(cell: string | undefined): string {
  if (!cell) return "";
  return cell.replace(/\r?\n/g, " ");
}

export function renderTable(input: TableInput): string {
  const sanitizedRows = input.rows.map((row) => row.map(sanitizeCell));
  const sanitizedColumns = input.columns.map(sanitizeCell);

  const widths = sanitizedColumns.map((col, i) => {
    let w = visualWidth(col);
    for (const row of sanitizedRows) {
      const cell = row[i] ?? "";
      const cw = visualWidth(cell);
      if (cw > w) w = cw;
    }
    return w;
  });

  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => padVisual(c ?? "", widths[i] ?? 0)).join("  ").trimEnd();

  const lines: string[] = [];
  lines.push(renderRow(sanitizedColumns));
  lines.push(widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of sanitizedRows) {
    lines.push(renderRow(row));
  }
  return lines.join("\n");
}

export function renderMarkdown(content: string): string {
  return content;
}

export function renderCsv(input: TableInput): string {
  const esc = (v: string): string => {
    // Coerce non-strings defensively — JSON.stringify may feed us numbers/booleans.
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [];
  lines.push(input.columns.map(esc).join(","));
  for (const row of input.rows) {
    lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}

export function isStdoutTty(): boolean {
  return Boolean(process.stdout.isTTY);
}
