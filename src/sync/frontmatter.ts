/**
 * YAML front-matter extraction and reinsertion.
 *
 * Front-matter is delimited by `---\n` at the start of the file (after
 * any leading whitespace) and a closing `---\n` line. Content between
 * is parsed by our minimal YAML reader.
 */

import { parseYaml, stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { NotionCliError, ErrorCode } from "../errors.js";

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

/**
 * The error every command raises for a front-matter block that opens and closes
 * but will not parse. Shared so the refusal reads the same wherever it happens;
 * `firstSuggestion` lets `page sync` lead with the orphaning risk that only
 * applies to it.
 */
export function malformedFrontmatterError(
  source: string,
  reason: string,
  firstSuggestion?: string,
): NotionCliError {
  return new NotionCliError(
    ErrorCode.USAGE,
    `Front-matter in ${source} is not valid YAML: ${reason}`,
    {
      suggestions: [
        firstSuggestion
          ?? "If this is front-matter, fix the offending line. Writing the file as it stands would put the delimiters and every YAML line — notion_id included — onto the page as visible content.",
        "notionctl reads a flat subset of YAML: no block sequences (- item), nested maps, or multi-line strings (| and >). A list must be written inline as [a, b] — this is the usual cause when importing files from Jekyll or Hugo.",
        "If the file was meant to open with a horizontal rule, write it as *** instead — a leading --- is read as a front-matter delimiter, and a blank line above it does not change that.",
      ],
    },
  );
}

/**
 * Body of a file whose front-matter has to parse before anything is written.
 * On the parse-failure path `body` is the entire raw input, so a caller that
 * ignores `malformed` writes the YAML onto the page as content.
 */
export function frontmatterBody(input: string, source: string): string {
  const { body, malformed } = extractFrontmatter(input);
  if (malformed) throw malformedFrontmatterError(source, malformed);
  return body;
}
