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
}

export function extractFrontmatter(input: string): ExtractedFrontmatter {
  const trimmedLeading = input.replace(/^[\n\r]+/, "");
  if (!trimmedLeading.startsWith("---\n") && !trimmedLeading.startsWith("---\r\n")) {
    return { data: {}, body: input };
  }

  const lines = trimmedLeading.split("\n");
  const closeIdx = findClosingDelimiter(lines);
  if (closeIdx === -1) return { data: {}, body: input };

  const yamlContent = lines.slice(1, closeIdx).join("\n");
  let data: YamlObject;
  try {
    data = parseYaml(yamlContent);
  } catch {
    return { data: {}, body: input };
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
