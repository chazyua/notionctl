/**
 * Render Notion API property values back into front-matter scalar values.
 * Used on the read path so `page get` can emit a clean YAML block.
 *
 * Read-only types (formula, rollup, *_time, *_by, unique_id) return their
 * computed values. They will still be filtered out on write by the parser
 * in parse.ts.
 */

import type { YamlValue } from "../utils/yaml.js";

export function renderProperty(prop: any): YamlValue {
  if (!prop || typeof prop !== "object") return null;
  switch (prop.type) {
    case "title":
      return (prop.title ?? []).map((r: any) => r.plain_text ?? "").join("");
    case "rich_text":
      return (prop.rich_text ?? []).map((r: any) => r.plain_text ?? "").join("");
    case "number":
      return typeof prop.number === "number" ? prop.number : null;
    case "select":
      return prop.select ? prop.select.name : null;
    case "status":
      return prop.status ? prop.status.name : null;
    case "multi_select":
      return (prop.multi_select ?? []).map((s: any) => s.name);
    case "date": {
      if (!prop.date) return null;
      if (prop.date.end) return `${prop.date.start}..${prop.date.end}`;
      return prop.date.start;
    }
    case "checkbox":
      return Boolean(prop.checkbox);
    case "url":
      return prop.url ?? null;
    case "email":
      return prop.email ?? null;
    case "phone_number":
      return prop.phone_number ?? null;
    case "people":
      return (prop.people ?? []).map((p: any) => `user:${p.id}`);
    case "files":
      return (prop.files ?? []).map((f: any) => f.external?.url ?? f.file?.url ?? f.name ?? "");
    case "relation":
      return (prop.relation ?? []).map((r: any) => `page:${r.id}`);
    case "formula":
      return renderFormula(prop.formula);
    case "rollup":
      return renderRollup(prop.rollup);
    case "created_time":
      return prop.created_time ?? null;
    case "last_edited_time":
      return prop.last_edited_time ?? null;
    case "created_by":
      return prop.created_by ? `user:${prop.created_by.id}` : null;
    case "last_edited_by":
      return prop.last_edited_by ? `user:${prop.last_edited_by.id}` : null;
    case "unique_id": {
      if (!prop.unique_id) return null;
      const prefix = prop.unique_id.prefix ?? "";
      const number = prop.unique_id.number ?? "";
      return prefix ? `${prefix}-${number}` : String(number);
    }
    default:
      return null;
  }
}

function renderFormula(f: any): YamlValue {
  if (!f) return null;
  if (f.type === "number") return f.number ?? null;
  if (f.type === "string") return f.string ?? null;
  if (f.type === "boolean") return Boolean(f.boolean);
  if (f.type === "date") return f.date?.start ?? null;
  return null;
}

function renderRollup(r: any): YamlValue {
  if (!r) return null;
  if (r.type === "number") return r.number ?? null;
  if (r.type === "date") return r.date?.start ?? null;
  if (r.type === "array") {
    return ((r.array ?? []).map((item: any) => renderProperty(item)) as unknown) as YamlValue;
  }
  return null;
}
