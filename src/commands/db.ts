/**
 * Database commands: query, schema, row get/create/update/delete.
 *
 * db query supports --filter "Status=Done" --sort "Date:desc" for
 * ergonomic filter construction, and --filter-json @file.json for the
 * full Notion filter language escape hatch. Schema is fetched once per
 * invocation and used to type-check property flags.
 */

import { notionRequest } from "../http.js";
import { parseProperty, parsePropertyFlag, type PropertySchema } from "../properties/parse.js";
import { renderProperty } from "../properties/render.js";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint, parseJsonObject, readStdinBounded, readFileText } from "./shared.js";
import { markdownToBlocks, blocksToMarkdown } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { fetchBlockTree } from "../blocks.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, renderTable, renderCsv, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { extractFrontmatter } from "../sync/frontmatter.js";

/**
 * Resolve a database ID to its primary data source ID. Since API version
 * 2025-09-03, `GET /databases/{id}` returns a `data_sources` array instead
 * of an inline `properties` schema. All schema operations (query, update
 * properties, get schema) now go through `/data_sources/{dsId}`.
 */
async function resolveDataSourceId(dbId: string): Promise<string> {
  const db = await fetchWith404Hint(
    () => notionRequest<{ data_sources?: Array<{ id: string }> }>(
      "GET",
      `/databases/${dbId}`,
    ),
    `Database ${dbId}`,
  );
  const ds = db.data_sources?.[0];
  if (!ds) {
    throw new NotionCliError(
      ErrorCode.API_ERROR,
      `Database ${dbId} has no data sources — cannot resolve schema.`,
    );
  }
  return ds.id;
}

async function fetchSchema(dbId: string): Promise<{ schema: Record<string, PropertySchema>; dataSourceId: string }> {
  const dataSourceId = await resolveDataSourceId(dbId);
  const ds = await notionRequest<{ properties: Record<string, PropertySchema> }>(
    "GET",
    `/data_sources/${dataSourceId}`,
  );
  return { schema: ds.properties, dataSourceId };
}

export async function dbSchemaCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db schema <id>");
  }
  const id = resolvePageId(positional[0]!);
  const { schema } = await fetchSchema(id);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(schema);
  const tableData = {
    columns: ["Name", "Type"],
    rows: Object.entries(schema).map(([name, s]) => [name, s.type]),
  };
  if (format === "csv") return renderCsv(tableData);
  return renderTable(tableData);
}

/**
 * Split a comma-separated list while respecting double/single quoted
 * segments. Used by multi_select filters so values with embedded commas
 * ("Design, Review") can be passed literally.
 */
function splitQuotedCsv(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (inQuote) {
      if (c === inQuote && raw[i - 1] !== "\\") { inQuote = null; continue; }
      current += c;
      continue;
    }
    if (c === '"' || c === "'") { inQuote = c; continue; }
    if (c === ",") {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = "";
      continue;
    }
    current += c;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) out.push(trimmed);
  return out;
}

/**
 * Find the leftmost comparison operator in an expression. Longer operators
 * (>=, <=) are preferred at the same position over shorter (>, <, =).
 */
function findOperator(expr: string): { op: "=" | ">" | "<" | ">=" | "<="; index: number } | null {
  const twoChar: Array<">=" | "<="> = [">=", "<="];
  const oneChar: Array<"=" | ">" | "<"> = [">", "<", "="];
  let best: { op: "=" | ">" | "<" | ">=" | "<="; index: number } | null = null;
  for (const op of twoChar) {
    const idx = expr.indexOf(op);
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { op, index: idx };
    }
  }
  for (const op of oneChar) {
    const idx = expr.indexOf(op);
    if (idx === -1) continue;
    // Skip the second char of a two-char operator we already found
    if (best && idx === best.index + 1) continue;
    if (best === null || idx < best.index) {
      best = { op, index: idx };
    }
  }
  return best;
}

// Exported for unit testing. Callers inside the module use this directly.
export function parseSimpleFilter(expr: string, schema: Record<string, PropertySchema>): unknown {
  const match = findOperator(expr);
  if (!match) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid filter: ${expr} (expected Key=value, Key>value, etc.)`);
  }
  const { op, index } = match;
  const key = expr.slice(0, index).trim();
  const value = expr.slice(index + op.length).trim();
  const prop = schema[key];
  if (!prop) {
    throw new NotionCliError(ErrorCode.INVALID_PROPERTY, `Unknown property: ${key}`);
  }
  switch (prop.type) {
    case "select":
      if (op !== "=") throw new NotionCliError(ErrorCode.USAGE, `select filter only supports =`);
      return { property: key, select: { equals: value } };
    case "status":
      if (op !== "=") throw new NotionCliError(ErrorCode.USAGE, `status filter only supports =`);
      return { property: key, status: { equals: value } };
    case "multi_select": {
      if (op !== "=") throw new NotionCliError(ErrorCode.USAGE, `multi_select filter only supports =`);
      const values = splitQuotedCsv(value);
      if (values.length === 0) {
        throw new NotionCliError(ErrorCode.USAGE, `multi_select filter needs at least one value`);
      }
      if (values.length === 1) {
        return { property: key, multi_select: { contains: values[0] } };
      }
      return { and: values.map((v) => ({ property: key, multi_select: { contains: v } })) };
    }
    case "checkbox": {
      if (op !== "=") throw new NotionCliError(ErrorCode.USAGE, `checkbox filter only supports =`);
      const v = value.trim().toLowerCase();
      const truthy = new Set(["true", "1", "yes", "y", "on"]);
      const falsy = new Set(["false", "0", "no", "n", "off"]);
      if (!truthy.has(v) && !falsy.has(v)) {
        throw new NotionCliError(
          ErrorCode.USAGE,
          `checkbox filter value must be true/false, yes/no, 1/0, or on/off — got: ${value}`,
        );
      }
      return { property: key, checkbox: { equals: truthy.has(v) } };
    }
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new NotionCliError(ErrorCode.USAGE, `Invalid number in filter: ${value}`);
      }
      const numberOp = {
        "=": "equals",
        ">": "greater_than",
        "<": "less_than",
        ">=": "greater_than_or_equal_to",
        "<=": "less_than_or_equal_to",
      }[op];
      return { property: key, number: { [numberOp]: n } };
    }
    case "title":
      if (op !== "=") throw new NotionCliError(ErrorCode.USAGE, `title filter only supports =`);
      return { property: key, title: { contains: value } };
    case "rich_text":
      if (op !== "=") throw new NotionCliError(ErrorCode.USAGE, `rich_text filter only supports =`);
      return { property: key, rich_text: { contains: value } };
    case "date": {
      const dateOp = {
        "=": "equals",
        ">": "after",
        "<": "before",
        ">=": "on_or_after",
        "<=": "on_or_before",
      }[op];
      return { property: key, date: { [dateOp]: value } };
    }
    default:
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Filter on property type '${prop.type}' not supported in simple form; use --filter-json`,
      );
  }
}

// Exported for unit testing.
export function parseSimpleSort(expr: string, schema: Record<string, PropertySchema>): unknown {
  const [prop, dir] = expr.split(":");
  if (!prop) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid sort: '${expr}' (expected Name or Name:asc / Name:desc)`,
    );
  }
  if (!schema[prop]) {
    throw new NotionCliError(ErrorCode.INVALID_PROPERTY, `Unknown sort property: ${prop}`);
  }
  if (dir !== undefined && dir !== "asc" && dir !== "desc") {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid sort direction: '${dir}' (use asc or desc)`,
    );
  }
  return {
    property: prop,
    direction: dir === "desc" ? "descending" : "ascending",
  };
}

export async function dbQueryCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db query <id> [--filter ...] [--sort ...]");
  }
  const id = resolvePageId(positional[0]!);
  const { schema, dataSourceId } = await fetchSchema(id);

  const body: Record<string, unknown> = {};
  const filterFlags = repeated.get("filter") ?? [];
  const filterJsonFlag = flags.get("filter-json");
  if (filterJsonFlag) {
    const raw = filterJsonFlag.startsWith("@")
      ? await readFileText(filterJsonFlag.slice(1), "filter JSON")
      : filterJsonFlag;
    body.filter = parseJsonObject(raw, "--filter-json");
  } else if (filterFlags.length === 1) {
    body.filter = parseSimpleFilter(filterFlags[0]!, schema);
  } else if (filterFlags.length > 1) {
    body.filter = { and: filterFlags.map((f) => parseSimpleFilter(f, schema)) };
  }

  const sorts = repeated.get("sort") ?? [];
  if (sorts.length > 0) {
    body.sorts = sorts.map((s) => parseSimpleSort(s, schema));
  }

  const res = await notionRequest<{ results: Array<{ id: string; properties: Record<string, unknown> }> }>(
    "POST",
    `/data_sources/${dataSourceId}/query`,
    body,
  );

  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(res);

  const columns = ["ID", ...Object.keys(schema)];
  const rows = res.results.map((r) => {
    const row: string[] = [r.id];
    for (const name of Object.keys(schema)) {
      const rendered = renderProperty(r.properties[name]);
      row.push(rendered === null || rendered === undefined ? "" : typeof rendered === "string" ? rendered : JSON.stringify(rendered));
    }
    return row;
  });
  if (format === "csv") return renderCsv({ columns, rows });
  return renderTable({ columns, rows });
}

/**
 * Split a select / multi_select option list while dropping empty segments
 * (from trailing commas like `Todo,Doing,`) and rejecting duplicates. The
 * Notion API rejects schemas with duplicate option names, so catching them
 * client-side gives a clean error instead of a cryptic API failure.
 */
function parseOptionList(raw: string, propName: string): Array<{ name: string }> {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: Array<{ name: string }> = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name.length === 0) continue;
    if (seen.has(name)) {
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Duplicate option '${name}' in property '${propName}' — select and multi_select option names must be unique.`,
      );
    }
    seen.add(name);
    out.push({ name });
  }
  return out;
}

/**
 * Parse a column spec like "Status=select:Todo,Doing,Done" into a Notion
 * property schema object. Supports the common types; unusual ones should
 * use --schema-json for the full escape hatch.
 */
// Exported for unit testing. Used by both db create and db update.
export function parseColumnSpec(spec: string): { name: string; schema: Record<string, unknown> } {
  const eqIdx = spec.indexOf("=");
  if (eqIdx === -1) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid column spec: ${spec} (expected Name=type[:options])`);
  }
  const name = spec.slice(0, eqIdx).trim();
  const rest = spec.slice(eqIdx + 1).trim();
  const colonIdx = rest.indexOf(":");
  const type = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
  const options = colonIdx === -1 ? "" : rest.slice(colonIdx + 1);

  switch (type) {
    case "title":
      return { name, schema: { title: {} } };
    case "text":
    case "rich_text":
      return { name, schema: { rich_text: {} } };
    case "number":
      return { name, schema: { number: { format: "number" } } };
    case "checkbox":
      return { name, schema: { checkbox: {} } };
    case "date":
      return { name, schema: { date: {} } };
    case "url":
      return { name, schema: { url: {} } };
    case "email":
      return { name, schema: { email: {} } };
    case "phone":
    case "phone_number":
      return { name, schema: { phone_number: {} } };
    case "people":
      return { name, schema: { people: {} } };
    case "files":
      return { name, schema: { files: {} } };
    case "select": {
      const opts = parseOptionList(options, name);
      return { name, schema: { select: { options: opts } } };
    }
    case "multi_select": {
      const opts = parseOptionList(options, name);
      return { name, schema: { multi_select: { options: opts } } };
    }
    default:
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Unsupported column type: ${type} (use --schema-json for unusual types)`,
      );
  }
}

export async function dbCreateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated } = parseFlags(ctx.args);
  const parent = flags.get("parent");
  const title = flags.get("title");
  if (!parent || !title) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl db create --parent <page-id> --title <text> [--prop Name=type[:options] ...] [--schema-json '...']",
    );
  }
  const parentId = resolvePageId(parent);

  // Default title column is "Name". If a --prop X=title spec is supplied,
  // it overrides the default so users can rename the title column at create
  // time (e.g. --prop Task=title).
  const properties: Record<string, unknown> = {
    Name: { title: {} },
  };

  // --schema-json: wholesale replacement (escape hatch)
  const schemaJson = flags.get("schema-json");
  if (schemaJson) {
    const raw = schemaJson.startsWith("@")
      ? await readFileText(schemaJson.slice(1), "schema JSON")
      : schemaJson;
    Object.assign(properties, parseJsonObject(raw, "--schema-json"));
  }

  // --prop Name=type[:options]: individual columns added on top
  let titleOverride: string | null = null;
  for (const raw of repeated.get("prop") ?? []) {
    const { name, schema } = parseColumnSpec(raw);
    if ((schema as { title?: unknown }).title !== undefined) {
      titleOverride = name;
    }
    properties[name] = schema;
  }
  if (titleOverride && titleOverride !== "Name") {
    delete properties.Name;
  }

  const payload = {
    parent: { type: "page_id", page_id: parentId },
    title: [{ type: "text", text: { content: title, link: null } }],
    initial_data_source: { properties },
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db create", payload });
  }
  const created = await notionRequest<{ id: string; url: string }>("POST", "/databases", payload);
  return renderJson({ id: created.id, url: created.url });
}

export async function dbUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl db update <id> [--title X] [--add-prop Name=type[:opts] ...] [--remove-prop Name ...] [--rename-prop Old=New ...] [--schema-json '...']",
    );
  }
  const id = resolvePageId(positional[0]!);

  const payload: Record<string, unknown> = {};

  const title = flags.get("title");
  if (title) {
    payload.title = [{ type: "text", text: { content: title, link: null } }];
  }

  const properties: Record<string, unknown> = {};

  for (const raw of repeated.get("add-prop") ?? []) {
    const { name, schema } = parseColumnSpec(raw);
    properties[name] = schema;
  }

  for (const name of repeated.get("remove-prop") ?? []) {
    properties[name.trim()] = null;
  }

  for (const raw of repeated.get("rename-prop") ?? []) {
    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) {
      throw new NotionCliError(ErrorCode.USAGE, `--rename-prop expects Old=New, got: ${raw}`);
    }
    const oldName = raw.slice(0, eqIdx).trim();
    const newName = raw.slice(eqIdx + 1).trim();
    if (!oldName || !newName) {
      throw new NotionCliError(ErrorCode.USAGE, `--rename-prop expects Old=New with non-empty values`);
    }
    properties[oldName] = { name: newName };
  }

  const schemaJson = flags.get("schema-json");
  if (schemaJson) {
    const raw = schemaJson.startsWith("@")
      ? await readFileText(schemaJson.slice(1), "schema JSON")
      : schemaJson;
    Object.assign(properties, parseJsonObject(raw, "--schema-json"));
  }

  const hasPropertyChanges = Object.keys(properties).length > 0;

  if (!hasPropertyChanges && Object.keys(payload).length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Nothing to update. Provide at least one of: --title, --add-prop, --remove-prop, --rename-prop, --schema-json",
    );
  }

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db update", dbId: id, payload: { ...payload, ...(hasPropertyChanges ? { properties } : {}) } });
  }

  const result: Record<string, unknown> = {};

  // Database-level changes (title, icon, etc.) go to /databases/{id}
  if (Object.keys(payload).length > 0) {
    const res = await notionRequest<{ id: string; url?: string }>("PATCH", `/databases/${id}`, payload);
    result.id = res.id;
    result.url = res.url;
  }

  // Schema changes (add/remove/rename properties) go to /data_sources/{dsId}
  if (hasPropertyChanges) {
    const dsId = await resolveDataSourceId(id);
    const res = await notionRequest<{ id: string }>("PATCH", `/data_sources/${dsId}`, { properties });
    result.dataSourceId = res.id;
    if (!result.id) result.id = id;
  }

  return renderJson(result);
}

export async function dbRowGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row get <page-id>");
  }
  const id = resolvePageId(positional[0]!);
  const page = await fetchWith404Hint(
    () => notionRequest<{ properties: Record<string, unknown> }>("GET", `/pages/${id}`),
    `Database row ${id}`,
  );
  const childBlocks = await fetchBlockTree(id);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") return renderJson({ page, children: childBlocks });
  if (format !== "md") {
    throw new NotionCliError(ErrorCode.USAGE, `db row get does not support --format ${format}. Use md or json.`);
  }

  const frontmatter: YamlObject = { notion_id: id };
  for (const [name, value] of Object.entries(page.properties)) {
    const rendered = renderProperty(value);
    if (rendered !== null && rendered !== undefined) frontmatter[name] = rendered;
  }
  return `---\n${stringifyYaml(frontmatter)}\n---\n\n${blocksToMarkdown(childBlocks)}`;
}

export async function dbRowCreateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row create <db-id> [--prop Key=value ...]");
  }
  const dbId = resolvePageId(positional[0]!);
  const { schema } = await fetchSchema(dbId);

  const properties: Record<string, unknown> = {};
  const propJson = flags.get("prop-json");
  if (propJson) {
    Object.assign(properties, parseJsonObject(propJson, "--prop-json"));
  }
  for (const raw of repeated.get("prop") ?? []) {
    const { key, value } = parsePropertyFlag(raw);
    properties[key] = parseProperty(schema, key, value);
  }

  let children: Block[] | undefined;
  const fromFile = flags.get("from");
  if (fromFile) {
    let raw: string;
    if (fromFile === "-") {
      raw = await readStdinBounded();
    } else {
      raw = await readFileText(fromFile, "row body markdown");
    }
    const { body } = extractFrontmatter(raw);
    children = markdownToBlocks(body);
  }

  const payload: Record<string, unknown> = {
    parent: { database_id: dbId },
    properties,
  };
  if (children) payload.children = children;

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db row create", payload });
  }
  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
  return renderJson({ id: created.id, url: created.url });
}

export async function dbRowUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row update <page-id> [--prop Key=value ...]");
  }
  const pageId = resolvePageId(positional[0]!);
  const page = await fetchWith404Hint(
    () => notionRequest<{ parent: { type: string; database_id?: string } }>("GET", `/pages/${pageId}`),
    `Database row ${pageId}`,
  );
  if (page.parent.type !== "database_id" || !page.parent.database_id) {
    throw new NotionCliError(ErrorCode.USAGE, `Page ${pageId} is not a database row. Use 'page update' for non-database pages.`);
  }
  const { schema } = await fetchSchema(page.parent.database_id);

  const properties: Record<string, unknown> = {};
  const propJson = flags.get("prop-json");
  if (propJson) Object.assign(properties, parseJsonObject(propJson, "--prop-json"));
  for (const raw of repeated.get("prop") ?? []) {
    const { key, value } = parsePropertyFlag(raw);
    properties[key] = parseProperty(schema, key, value);
  }

  if (Object.keys(properties).length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Nothing to update. Provide at least one --prop Key=value flag.",
    );
  }
  const payload = { properties };
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db row update", pageId, payload });
  }
  const res = await notionRequest("PATCH", `/pages/${pageId}`, payload);
  return renderJson(res);
}

export async function dbRowDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row delete <page-id> --yes");
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to archive without --yes");
  }
  const id = resolvePageId(positional[0]!);
  const res = await fetchWith404Hint(
    () => notionRequest("PATCH", `/pages/${id}`, { in_trash: true }),
    `Database row ${id}`,
  );
  return renderJson(res);
}
