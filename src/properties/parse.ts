/**
 * Property value DSL parser.
 *
 * Turns --prop "Key=value" flags into the shapes Notion's API expects
 * for page property updates. Schema-driven: before parsing, the caller
 * fetches the DB schema and passes a name → type map. We never guess
 * property types.
 *
 * Supports all 14 writable property types. The 7 read-only types
 * (formula, rollup, created_*, last_edited_*, unique_id) are silently
 * filtered out by the caller — this file does not handle them.
 *
 * For anything the DSL can't express, there's --prop-json that passes
 * the raw Notion shape through untouched. This file is not responsible
 * for that escape hatch.
 */

import { NotionCliError, ErrorCode } from "../errors.js";

export type PropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "status"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "people"
  | "files"
  | "relation"
  // read-only types
  | "formula"
  | "rollup"
  | "created_time"
  | "created_by"
  | "last_edited_time"
  | "last_edited_by"
  | "unique_id";

export interface PropertySchema {
  type: PropertyType;
  name?: string;
  id?: string;
}

export interface FlagPair {
  key: string;
  value: string;
}

export function parsePropertyFlag(flag: string): FlagPair {
  const eqIdx = findUnquotedEquals(flag);
  if (eqIdx === -1) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid --prop flag (missing '='): ${flag}`,
    );
  }
  return { key: flag.slice(0, eqIdx).trim(), value: flag.slice(eqIdx + 1).trim() };
}

function findUnquotedEquals(s: string): number {
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuote) {
      if (c === quoteChar && s[i - 1] !== "\\") inQuote = false;
    } else {
      if (c === '"' || c === "'") { inQuote = true; quoteChar = c; }
      else if (c === "=") return i;
    }
  }
  return -1;
}

export function parseProperty(
  schema: Record<string, PropertySchema>,
  key: string,
  rawValue: string,
): Record<string, unknown> {
  const propSchema = schema[key];
  if (!propSchema) {
    const suggestions = suggestKey(key, Object.keys(schema));
    throw new NotionCliError(
      ErrorCode.INVALID_PROPERTY,
      `Property '${key}' not found on database`,
      suggestions.length > 0 ? { suggestions } : {},
    );
  }

  const value = stripQuotes(rawValue);

  switch (propSchema.type) {
    case "title":
      return { title: [{ type: "text", text: { content: value, link: null } }] };
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: value, link: null } }] };
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new NotionCliError(ErrorCode.INVALID_PROPERTY, `Property '${key}' must be a number, got: ${value}`);
      }
      return { number: n };
    }
    case "select":
      return { select: { name: value } };
    case "status":
      return { status: { name: value } };
    case "multi_select": {
      const items = parseList(value);
      return { multi_select: items.map((name) => ({ name })) };
    }
    case "date": {
      const rangeMatch = /^(.+?)\.\.(.+)$/.exec(value);
      if (rangeMatch) {
        return { date: { start: rangeMatch[1]!, end: rangeMatch[2]! } };
      }
      return { date: { start: value, end: null } };
    }
    case "checkbox":
      return { checkbox: value === "true" };
    case "url":
      return { url: value };
    case "email":
      return { email: value };
    case "phone_number":
      return { phone_number: value };
    case "people": {
      if (value.startsWith("[") && value.endsWith("]")) {
        const items = parseList(value);
        return { people: items.map((item) => resolvePersonRef(item, key)) };
      }
      return { people: [resolvePersonRef(value, key)] };
    }
    case "files": {
      const prefix = /^(url|file):/.exec(value);
      if (!prefix) {
        throw new NotionCliError(
          ErrorCode.INVALID_PROPERTY,
          `Property '${key}' (files) requires url: or file: prefix, got: ${value}`,
        );
      }
      if (prefix[1] === "url") {
        const url = stripQuotes(value.slice(4));
        const name = url.split("/").pop() ?? "file";
        return { files: [{ name, external: { url } }] };
      }
      throw new NotionCliError(
        ErrorCode.INVALID_PROPERTY,
        "Local file upload (file: prefix) is deferred to V2. Use url: for now.",
      );
    }
    case "relation": {
      if (value.startsWith("[") && value.endsWith("]")) {
        const items = parseList(value);
        return { relation: items.map((item) => resolveRelationRef(item, key)) };
      }
      return { relation: [resolveRelationRef(value, key)] };
    }
    default:
      throw new NotionCliError(
        ErrorCode.INVALID_PROPERTY,
        `Property type '${propSchema.type}' is read-only; cannot set`,
      );
  }
}

function resolvePersonRef(ref: string, propKey: string): { id: string } {
  const canon = /^user:(.+)$/.exec(ref);
  if (canon) return { id: canon[1]! };
  throw new NotionCliError(
    ErrorCode.INVALID_PROPERTY,
    `People property '${propKey}' requires 'user:<id>' format (at-name lookup not yet implemented in V1)`,
    { suggestions: ["Use 'user:<uuid>' to specify a user by ID"] },
  );
}

function resolveRelationRef(ref: string, propKey: string): { id: string } {
  const canon = /^page:(.+)$/.exec(ref);
  if (canon) return { id: canon[1]! };
  throw new NotionCliError(
    ErrorCode.INVALID_PROPERTY,
    `Relation property '${propKey}' requires 'page:<id>' format (title lookup not yet implemented in V1)`,
    { suggestions: ["Use 'page:<uuid>' to specify a related page by ID"] },
  );
}

function parseList(raw: string): string[] {
  let inner = raw.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  const items: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inQuote) {
      if (c === quoteChar && inner[i - 1] !== "\\") inQuote = false;
      else current += c;
      continue;
    }
    if (c === '"' || c === "'") { inQuote = true; quoteChar = c; continue; }
    if (c === ",") {
      if (current.trim().length > 0) items.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) items.push(current.trim());
  return items;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function suggestKey(input: string, candidates: string[]): string[] {
  const matches = candidates
    .map((c) => ({ c, dist: levenshtein(input.toLowerCase(), c.toLowerCase()) }))
    .filter((m) => m.dist <= Math.max(2, Math.floor(input.length / 3)))
    .sort((a, b) => a.dist - b.dist)
    .map((m) => `Did you mean '${m.c}'?`);
  return matches.slice(0, 3);
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}
