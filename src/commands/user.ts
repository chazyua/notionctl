import { notionRequest } from "../http.js";
import { renderJson, renderTable, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { parseFlags } from "./shared.js";

export async function userListCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const res = await notionRequest<{ results: Array<{ id: string; name?: string; type?: string }> }>("GET", "/users");
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(res);
  return renderTable({
    columns: ["ID", "Name", "Type"],
    rows: res.results.map((u) => [u.id, u.name ?? "", u.type ?? ""]),
  });
}

export async function userMeCommand(_ctx: { args: string[] }): Promise<string> {
  const me = await notionRequest("GET", "/users/me");
  return renderJson(me);
}
