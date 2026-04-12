/**
 * Minimal YAML reader/writer.
 *
 * Supports only the subset needed for notionctl front-matter:
 *   - strings (quoted and unquoted)
 *   - numbers (int and float)
 *   - booleans (true, false)
 *   - null (null, ~)
 *   - flow sequences: [a, b, "c with, comma"]
 *
 * Does NOT support:
 *   - block sequences (- item)
 *   - nested maps
 *   - anchors and aliases
 *   - multi-line strings (| or >)
 *   - custom tags (!!str, etc.)
 *
 * This is deliberate: the front-matter schema we use is flat key-value
 * with simple types, and a full YAML parser is 2000+ lines we don't need.
 * If a future feature needs nested structures, widen this module with
 * dedicated tests rather than pulling in a dependency.
 */

export type YamlValue = string | number | boolean | null | string[];
export type YamlObject = Record<string, YamlValue>;

export function parseYaml(input: string): YamlObject {
  const result: YamlObject = {};
  const lines = input.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    if (line.trimStart().startsWith("#")) continue;

    const colonIdx = findUnquotedColon(line);
    if (colonIdx === -1) {
      throw new Error(`Invalid YAML line (no key): ${rawLine}`);
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    result[key] = parseValue(rawValue);
  }

  return result;
}

function findUnquotedColon(line: string): number {
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === "\\" && i + 1 < line.length) {
        i++;
        continue;
      }
      if (c === quoteChar) {
        inQuote = false;
      }
    } else {
      if (c === '"' || c === "'") {
        inQuote = true;
        quoteChar = c;
      } else if (c === ":") {
        return i;
      }
    }
  }
  return -1;
}

function unescapeDoubleQuoted(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1]!;
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else out += next;
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

function parseValue(raw: string): YamlValue {
  if (raw.length === 0) return "";
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Quoted string
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return unescapeDoubleQuoted(raw.slice(1, -1));
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }

  // Flow sequence
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return parseFlowSequence(raw.slice(1, -1));
  }

  // Number (integer or float), but not ISO dates which also match digits
  if (/^-?\d+(\.\d+)?$/.test(raw) && !isIsoDateLike(raw)) {
    return Number(raw);
  }

  // Unquoted string — return as-is
  return raw;
}

function isIsoDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function parseFlowSequence(inner: string): string[] {
  // Collect raw items (preserving quotes) so we can delegate per-item
  // scalar parsing to parseValue, which correctly unescapes \" \n \\ etc.
  const rawItems: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let depth = 0;

  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inQuote) {
      if (c === "\\" && i + 1 < inner.length) {
        current += c + inner[i + 1]!;
        i++;
        continue;
      }
      if (c === quoteChar) {
        inQuote = false;
      }
      current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
      current += c;
      continue;
    }
    if (c === "[") { depth++; current += c; continue; }
    if (c === "]") { depth--; current += c; continue; }
    if (c === "," && depth === 0) {
      if (current.trim().length > 0) rawItems.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) rawItems.push(current.trim());

  return rawItems.map((raw) => {
    const parsed = parseValue(raw);
    // Flow sequences in our schema are always string arrays; coerce scalars.
    if (parsed === null) return "null";
    if (Array.isArray(parsed)) return parsed.join(",");
    return String(parsed);
  });
}

export function stringifyYaml(obj: YamlObject): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  return lines.join("\n");
}

function serializeValue(value: YamlValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(serializeScalarForArray).join(", ") + "]";
  }
  return serializeString(value);
}

function serializeString(s: string): string {
  if (s.length === 0) return '""';
  if (needsQuoting(s)) {
    return `"${escapeDoubleQuoted(s)}"`;
  }
  return s;
}

function serializeScalarForArray(s: string): string {
  if (needsQuoting(s)) {
    return `"${escapeDoubleQuoted(s)}"`;
  }
  return s;
}

function escapeDoubleQuoted(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function needsQuoting(s: string): boolean {
  if (s.length === 0) return true;
  if (/[,:#\[\]{}\n\r"\\]/.test(s)) return true;
  if (s.trim() !== s) return true;
  if (/^(true|false|null|~)$/i.test(s)) return true;
  if (/^-?\d/.test(s) && !/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  return false;
}
