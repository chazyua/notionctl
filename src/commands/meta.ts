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
import { resolvePageId, parseFlags, readFileText, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";

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
  if (typeFilter && typeFilter !== "page" && typeFilter !== "db") {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid --type value: '${typeFilter}'. Valid values: page, db`);
  }
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
    const tableData = { columns: ["Object", "ID", "URL"], rows: [] as string[][] };
    if (format === "csv") return renderCsv(tableData);
    if (format === "table") {
      return renderTable(tableData) + "\n\nNo results. If you expected results, ensure the integration is connected to the page via ··· → Connections in Notion.";
    }
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
  const VALID_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
  const method = positional[0]!.toUpperCase();
  if (!VALID_METHODS.has(method)) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid HTTP method: ${method}. Use GET, POST, PATCH, or DELETE.`);
  }
  const path = positional[1]!;

  // `api` is the raw escape hatch: it bypasses the schema-aware command
  // surface and talks to Notion directly. `DELETE` therefore needs the
  // same confirmation gate as the typed delete commands (page delete,
  // db row delete, block delete) — a fat-fingered `api DELETE /blocks/X`
  // should not silently tombstone a block.
  //
  // We don't gate PATCH here even though PATCH can archive a page
  // (`{"archived": true}`), because PATCH is also the normal update
  // verb and the user explicitly supplies the body — they already know
  // what they're sending. Gating DELETE alone is the minimum viable
  // guard that matches the rest of the CLI's --yes convention.
  if (method === "DELETE" && !getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Refusing to perform api DELETE without --yes confirmation",
      {
        suggestions: [
          "Re-run with --yes if you really intend to DELETE this resource.",
          "Prefer the schema-aware commands (page delete, db row delete, block delete) — they carry richer guardrails.",
        ],
      },
    );
  }

  let body: unknown;
  const bodyFlag = flags.get("body");
  if (bodyFlag) {
    let content: string;
    if (bodyFlag.startsWith("@")) {
      content = await readFileText(bodyFlag.slice(1), "request body");
    } else {
      content = bodyFlag;
    }
    try {
      body = JSON.parse(content);
    } catch {
      throw new NotionCliError(ErrorCode.USAGE, `--body is not valid JSON`);
    }
  }
  const result = await notionRequest(method as "GET" | "POST" | "PATCH" | "DELETE", path.startsWith("/") ? path : `/${path}`, body);
  return renderJson(result);
}
