import { notionRequest } from "../http.js";
import { renderJson, renderTable, renderCsv, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { parseFlags } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";

export async function userListCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const res = await notionRequest<{ results: Array<{ id: string; name?: string; type?: string }> }>("GET", "/users");
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "md") {
    throw new NotionCliError(ErrorCode.USAGE, "user list does not support --format md. Use json, table, or csv.");
  }
  if (format === "json") return renderJson(res);
  const tableData = {
    columns: ["ID", "Name", "Type"],
    rows: res.results.map((u) => [u.id, u.name ?? "", u.type ?? ""]),
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}

export async function userMeCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const me = await notionRequest<{ id: string; name?: string; type?: string }>("GET", "/users/me");
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "json",
  });
  if (format === "md") {
    throw new NotionCliError(ErrorCode.USAGE, "user me does not support --format md. Use json, table, or csv.");
  }
  if (format === "json") return renderJson(me);
  const tableData = {
    columns: ["ID", "Name", "Type"],
    rows: [[me.id, me.name ?? "", me.type ?? ""]],
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}
