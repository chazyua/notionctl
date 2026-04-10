/**
 * Meta commands: whoami, resolve, search, api.
 *
 * These wrap thin Notion API calls and format output per the standard
 * format-switching rules in output.ts. The `api` command is the raw
 * escape hatch — it passes through any method and path to Notion with
 * the CLI's auth and retry behavior, but nothing else.
 */

import { notionRequest } from "../http.js";
import { renderJson, renderTable, renderCsv, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { resolvePageId, parseFlags } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { readFile } from "node:fs/promises";

export interface CommandContext {
  args: string[];
}

export async function whoamiCommand(ctx: CommandContext): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const me = await notionRequest<{ bot?: { owner?: { user?: { name?: string } } }; name?: string }>("GET", "/users/me");
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(me);
  const tableData = {
    columns: ["Field", "Value"],
    rows: [
      ["Integration name", me.name ?? ""],
      ["Owner user", me.bot?.owner?.user?.name ?? "(workspace)"],
    ],
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}

export async function resolveCommand(ctx: CommandContext): Promise<string> {
  const { positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl resolve <url>");
  }
  return resolvePageId(positional[0]!);
}

export async function searchCommand(ctx: CommandContext): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl search <query>");
  }
  const query = positional.join(" ");
  const typeFilter = flags.get("type");
  const body: Record<string, unknown> = { query };
  if (typeFilter === "page" || typeFilter === "db") {
    body.filter = { value: typeFilter === "page" ? "page" : "database", property: "object" };
  }
  const res = await notionRequest<{ results: Array<{ id: string; object: string; url?: string; properties?: Record<string, unknown> }> }>(
    "POST",
    "/search",
    body,
  );
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(res);
  if (res.results.length === 0) {
    return "No results. If you expected results, ensure the integration is connected to the page via ··· → Connections in Notion.";
  }
  const tableData = {
    columns: ["Object", "ID", "URL"],
    rows: res.results.map((r) => [r.object, r.id, r.url ?? ""]),
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}

export async function apiCommand(ctx: CommandContext): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length < 2) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl api <METHOD> <path> [--body @file.json]");
  }
  const method = positional[0]!.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  const path = positional[1]!;
  let body: unknown;
  const bodyFlag = flags.get("body");
  if (bodyFlag) {
    try {
      if (bodyFlag.startsWith("@")) {
        const content = await readFile(bodyFlag.slice(1), "utf8");
        body = JSON.parse(content);
      } else {
        body = JSON.parse(bodyFlag);
      }
    } catch {
      throw new NotionCliError(ErrorCode.USAGE, `--body is not valid JSON`);
    }
  }
  const result = await notionRequest(method, path.startsWith("/") ? path : `/${path}`, body);
  return renderJson(result);
}
