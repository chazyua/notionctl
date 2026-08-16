import { notionRequest } from "../http.js";
import { markdownToRichText } from "../markdown/index.js";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, renderTable, renderCsv, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function commentListCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl comment list <page-id>");
  }
  const id = resolvePageId(positional[0]!);
  const res = await fetchWith404Hint(
    () => notionRequest<{ results: Array<{ id: string; created_time: string; rich_text: Array<{ plain_text: string }>; created_by: { id: string } }> }>("GET", `/comments?block_id=${encodeURIComponent(id)}`),
    `Page ${id}`,
  );
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "md") {
    throw new NotionCliError(ErrorCode.USAGE, "comment list does not support --format md. Use json, table, or csv.");
  }
  if (format === "json") return renderJson(res);
  const tableData = {
    columns: ["ID", "Author", "Text", "Created"],
    rows: res.results.map((c) => [
      c.id,
      c.created_by.id,
      (c.rich_text ?? []).map((r) => r.plain_text).join(""),
      c.created_time,
    ]),
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}

export async function commentAddCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl comment add <page-id> --text \"...\"");
  }
  const id = resolvePageId(positional[0]!);
  const text = flags.get("text");
  if (!text) {
    throw new NotionCliError(ErrorCode.USAGE, "comment add requires --text");
  }
  const payload = {
    parent: { page_id: id },
    rich_text: markdownToRichText(text),
  };
  if (getBooleanFlag(flags, "dry-run")) return renderJson({ action: "comment add", payload });
  const res = await fetchWith404Hint(
    () => notionRequest("POST", "/comments", payload),
    `Page ${id}`,
  );
  return renderJson(res);
}
