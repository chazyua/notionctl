/**
 * YAML front-matter extraction and reinsertion.
 *
 * Front-matter is delimited by `---\n` at the start of the file (after
 * any leading whitespace) and a closing `---\n` line. Content between
 * is parsed by our minimal YAML reader.
 */

import { parseYaml, stringifyYaml, type YamlObject } from "../utils/yaml.js";

export interface ExtractedFrontmatter {
  data: YamlObject;
  body: string;
  /**
   * Why the front-matter could not be parsed, when the file clearly meant to
   * have some — both delimiters present, contents unparseable. Absent for a
   * file that simply has no front-matter, which is a legitimate first sync.
   */
  malformed?: string;
}

export function extractFrontmatter(input: string): ExtractedFrontmatter {
  // A UTF-8 BOM — what PowerShell and several Windows editors write by default —
  // sits in front of the opening delimiter and would make perfectly valid
  // front-matter read as none at all. For `page sync` that means ignoring
  // notion_id and creating a duplicate page, so strip it before matching.
  const text = input.replace(/^\uFEFF/, "");
  const trimmedLeading = text.replace(/^[\n\r]+/, "");
  if (!trimmedLeading.startsWith("---\n") && !trimmedLeading.startsWith("---\r\n")) {
    return { data: {}, body: text };
  }

  const lines = trimmedLeading.split("\n");
  const closeIdx = findClosingDelimiter(lines);
  if (closeIdx === -1) return { data: {}, body: text };

  const yamlContent = lines.slice(1, closeIdx).join("\n");
  let data: YamlObject;
  try {
    data = parseYaml(yamlContent);
  } catch (err) {
    return { data: {}, body: text, malformed: (err as Error).message };
  }

  const body = lines.slice(closeIdx + 1).join("\n").replace(/^[\n\r]+/, "");
  return { data, body };
}

function findClosingDelimiter(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "---\r") return i;
  }
  return -1;
}

export function reinsertFrontmatter(data: YamlObject, body: string): string {
  if (Object.keys(data).length === 0) return body;
  const yaml = stringifyYaml(data);
  return `---\n${yaml}\n---\n\n${body}`;
}
