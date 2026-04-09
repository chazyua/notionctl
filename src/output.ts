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

export type Format = "md" | "json" | "table" | "csv";

export interface ChooseFormatOpts {
  isTty: boolean;
  defaultFormat: Format;
}

export function chooseFormat(
  explicit: Format | undefined,
  opts: ChooseFormatOpts,
): Format {
  if (explicit !== undefined) return explicit;
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

export function renderTable(input: TableInput): string {
  const widths = input.columns.map((col, i) => {
    let w = col.length;
    for (const row of input.rows) {
      const cell = row[i] ?? "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ").trimEnd();

  const lines: string[] = [];
  lines.push(renderRow(input.columns));
  lines.push(widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of input.rows) {
    lines.push(renderRow(row));
  }
  return lines.join("\n");
}

export function renderMarkdown(content: string): string {
  return content;
}

export function renderCsv(input: TableInput): string {
  const esc = (v: string): string => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
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
