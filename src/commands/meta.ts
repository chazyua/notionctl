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
import { resolvePageId, parseFlags, readFileText, getBooleanFlag, rejectExtraPositionals } from "./shared.js";
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
  if (format === "md") {
    throw new NotionCliError(ErrorCode.USAGE, "whoami does not support --format md. Use json, table, or csv.");
  }
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
    body.filter = { value: typeFilter === "page" ? "page" : "data_source", property: "object" };
  }
  const res = await notionRequest<{ results: Array<{ id: string; object: string; url?: string; title?: Array<{ plain_text?: string }>; properties?: Record<string, unknown>; parent?: { database_id?: string } }> }>(
    "POST",
    "/search",
    body,
  );
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "md") {
    throw new NotionCliError(ErrorCode.USAGE, "search does not support --format md. Use json, table, or csv.");
  }
  if (format === "json") return renderJson(res);

  // For data_source results (databases), show the database_id (usable with db
  // commands) instead of the data_source id, and resolve a display title from
  // the top-level title array. For pages, extract title from properties.
  const resolveRow = (r: typeof res.results[0]): { object: string; id: string; title: string; url: string } => {
    if (r.object === "data_source") {
      const dbId = r.parent?.database_id ?? r.id;
      const title = (r.title ?? []).map((t) => t.plain_text ?? "").join("") || "";
      return { object: "database", id: dbId, title, url: r.url ?? "" };
    }
    let title = "";
    if (r.properties) {
      for (const value of Object.values(r.properties)) {
        const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
        if (prop.type === "title" && prop.title) {
          title = prop.title.map((t) => t.plain_text ?? "").join("");
          break;
        }
      }
    }
    return { object: r.object, id: r.id, title, url: r.url ?? "" };
  };

  if (res.results.length === 0) {
    const tableData = { columns: ["Object", "ID", "Title", "URL"], rows: [] as string[][] };
    if (format === "csv") return renderCsv(tableData);
    if (format === "table") {
      return renderTable(tableData) + "\n\nNo results. If you expected results, ensure the integration is connected to the page via ··· → Connections in Notion.";
    }
    return "No results. If you expected results, ensure the integration is connected to the page via ··· → Connections in Notion.";
  }
  const rows = res.results.map(resolveRow);
  const tableData = {
    columns: ["Object", "ID", "Title", "URL"],
    rows: rows.map((r) => [r.object, r.id, r.title, r.url]),
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}

export async function apiCommand(ctx: CommandContext): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length < 2) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl api <METHOD> <path> [--body @file.json]");
  }
  rejectExtraPositionals(positional, 2);
  const VALID_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
  const method = positional[0]!.toUpperCase();
  if (!VALID_METHODS.has(method)) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid HTTP method: ${method}. Use GET, POST, PATCH, or DELETE.`);
  }
  let path = positional[1]!;
  // Strip a user-supplied /v1/ prefix — it's baked into the base URL.
  if (/^\/?v1\//.test(path)) {
    path = path.replace(/^\/?v1\//, "/");
  }

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
  if (bodyFlag && method === "GET") {
    throw new NotionCliError(ErrorCode.USAGE, `GET requests cannot have a --body. Did you mean POST?`);
  }
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
  const requestPath = path.startsWith("/") ? path : `/${path}`;

  // `api` is the raw escape hatch, but it is still a write command — honour
  // --dry-run like every other one. GET is a read, so the flag is a no-op there.
  if (method !== "GET" && getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "api", method, path: requestPath, body: body ?? null });
  }

  const result = await notionRequest(method as "GET" | "POST" | "PATCH" | "DELETE", requestPath, body);
  return renderJson(result);
}
