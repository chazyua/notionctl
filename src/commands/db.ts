/**
 * Database commands: query, schema, row get/create/update/delete.
 *
 * db query supports --filter "Status=Done" --sort "Date:desc" for
 * ergonomic filter construction, and --filter-json @file.json for the
 * full Notion filter language escape hatch. Schema is fetched once per
 * invocation and used to type-check property flags.
 */

import { readFile } from "node:fs/promises";
import { notionRequest } from "../http.js";
import { parseProperty, parsePropertyFlag, type PropertySchema } from "../properties/parse.js";
import { renderProperty } from "../properties/render.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { markdownToBlocks, blocksToMarkdown } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, renderTable, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";

async function fetchSchema(dbId: string): Promise<Record<string, PropertySchema>> {
  const db = await notionRequest<{ properties: Record<string, PropertySchema> }>(
    "GET",
    `/databases/${dbId}`,
  );
  return db.properties;
}

export async function dbSchemaCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db schema <id>");
  }
  const id = resolvePageId(positional[0]!);
  const schema = await fetchSchema(id);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(schema);
  return renderTable({
    columns: ["Name", "Type"],
    rows: Object.entries(schema).map(([name, s]) => [name, s.type]),
  });
}

function parseSimpleFilter(expr: string, schema: Record<string, PropertySchema>): unknown {
  const eqIdx = expr.indexOf("=");
  if (eqIdx === -1) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid filter: ${expr}`);
  }
  const key = expr.slice(0, eqIdx).trim();
  const value = expr.slice(eqIdx + 1).trim();
  const prop = schema[key];
  if (!prop) {
    throw new NotionCliError(ErrorCode.INVALID_PROPERTY, `Unknown property: ${key}`);
  }
  switch (prop.type) {
    case "select":
      return { property: key, select: { equals: value } };
    case "status":
      return { property: key, status: { equals: value } };
    case "checkbox":
      return { property: key, checkbox: { equals: value === "true" } };
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new NotionCliError(ErrorCode.USAGE, `Invalid number in filter: ${value}`);
      }
      return { property: key, number: { equals: n } };
    }
    case "title":
      return { property: key, title: { contains: value } };
    case "rich_text":
      return { property: key, rich_text: { contains: value } };
    case "date":
      return { property: key, date: { equals: value } };
    default:
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Filter on property type '${prop.type}' not supported in simple form; use --filter-json`,
      );
  }
}

function parseSimpleSort(expr: string): unknown {
  const [prop, dir] = expr.split(":");
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
  const schema = await fetchSchema(id);

  const body: Record<string, unknown> = {};
  const filterFlag = flags.get("filter");
  const filterJsonFlag = flags.get("filter-json");
  if (filterJsonFlag) {
    const raw = filterJsonFlag.startsWith("@")
      ? await readFile(filterJsonFlag.slice(1), "utf8")
      : filterJsonFlag;
    body.filter = JSON.parse(raw);
  } else if (filterFlag) {
    body.filter = parseSimpleFilter(filterFlag, schema);
  }

  const sorts = repeated.get("sort") ?? [];
  if (sorts.length > 0) {
    body.sorts = sorts.map(parseSimpleSort);
  }

  const res = await notionRequest<{ results: Array<{ id: string; properties: Record<string, unknown> }> }>(
    "POST",
    `/databases/${id}/query`,
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
      row.push(typeof rendered === "string" ? rendered : JSON.stringify(rendered ?? ""));
    }
    return row;
  });
  return renderTable({ columns, rows });
}

/**
 * Parse a column spec like "Status=select:Todo,Doing,Done" into a Notion
 * property schema object. Supports the common types; unusual ones should
 * use --schema-json for the full escape hatch.
 */
function parseColumnSpec(spec: string): { name: string; schema: Record<string, unknown> } {
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
      const opts = options ? options.split(",").map((o) => ({ name: o.trim() })) : [];
      return { name, schema: { select: { options: opts } } };
    }
    case "multi_select": {
      const opts = options ? options.split(",").map((o) => ({ name: o.trim() })) : [];
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

  // Build properties schema: title is always the first column
  const properties: Record<string, unknown> = {
    Name: { title: {} },
  };

  // --schema-json: wholesale replacement (escape hatch)
  const schemaJson = flags.get("schema-json");
  if (schemaJson) {
    let parsed: unknown;
    try {
      const raw = schemaJson.startsWith("@")
        ? await readFile(schemaJson.slice(1), "utf8")
        : schemaJson;
      parsed = JSON.parse(raw);
    } catch {
      throw new NotionCliError(ErrorCode.USAGE, "--schema-json is not valid JSON");
    }
    if (parsed && typeof parsed === "object") {
      Object.assign(properties, parsed as Record<string, unknown>);
    }
  }

  // --prop Name=type[:options]: individual columns added on top
  for (const raw of repeated.get("prop") ?? []) {
    const { name, schema } = parseColumnSpec(raw);
    properties[name] = schema;
  }

  const payload = {
    parent: { type: "page_id", page_id: parentId },
    title: [{ type: "text", text: { content: title, link: null } }],
    properties,
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db create", payload });
  }
  const created = await notionRequest<{ id: string; url: string }>("POST", "/databases", payload);
  return renderJson({ id: created.id, url: created.url });
}

export async function dbRowGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row get <page-id>");
  }
  const id = resolvePageId(positional[0]!);
  const page = await notionRequest<{ properties: Record<string, unknown> }>("GET", `/pages/${id}`);
  const children = await notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") return renderJson({ page, children: children.results });

  const frontmatter: YamlObject = { notion_id: id };
  for (const [name, value] of Object.entries(page.properties)) {
    const rendered = renderProperty(value);
    if (rendered !== null && rendered !== undefined) frontmatter[name] = rendered;
  }
  return `---\n${stringifyYaml(frontmatter)}\n---\n\n${blocksToMarkdown(children.results)}`;
}

export async function dbRowCreateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row create <db-id> [--prop Key=value ...]");
  }
  const dbId = resolvePageId(positional[0]!);
  const schema = await fetchSchema(dbId);

  const properties: Record<string, unknown> = {};
  const propJson = flags.get("prop-json");
  if (propJson) {
    Object.assign(properties, JSON.parse(propJson));
  }
  for (const raw of repeated.get("prop") ?? []) {
    const { key, value } = parsePropertyFlag(raw);
    properties[key] = parseProperty(schema, key, value);
  }

  let children: Block[] | undefined;
  const fromFile = flags.get("from");
  if (fromFile) {
    const md = await readFile(fromFile, "utf8");
    children = markdownToBlocks(md);
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
  const page = await notionRequest<{ parent: { database_id: string } }>("GET", `/pages/${pageId}`);
  const schema = await fetchSchema(page.parent.database_id);

  const properties: Record<string, unknown> = {};
  const propJson = flags.get("prop-json");
  if (propJson) Object.assign(properties, JSON.parse(propJson));
  for (const raw of repeated.get("prop") ?? []) {
    const { key, value } = parsePropertyFlag(raw);
    properties[key] = parseProperty(schema, key, value);
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
  const res = await notionRequest("PATCH", `/pages/${id}`, { archived: true });
  return renderJson(res);
}
