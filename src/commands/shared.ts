/**
 * Shared helpers for all command modules: flag parsing (no yargs, no
 * commander — we do it ourselves), ID resolution, and consistent
 * option handling across commands.
 */

import { NotionCliError, ErrorCode } from "../errors.js";

export interface ParsedFlags {
  flags: Map<string, string>;
  repeated: Map<string, string[]>;
  positional: string[];
}

const BOOLEAN_FLAGS = new Set([
  "dry-run",
  "quiet",
  "verbose",
  "debug",
  "no-color",
  "yes",
  "include-children",
  "force",
  "merge",
  "recursive",
]);

const REPEATABLE_FLAGS = new Set([
  "prop",
  "sort",
  "filter",
  "add-prop",
  "remove-prop",
  "rename-prop",
]);

export function parseFlags(args: string[]): ParsedFlags {
  const flags = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      i++;
      continue;
    }
    const eqIdx = a.indexOf("=");
    let name: string;
    let value: string | undefined;
    if (eqIdx !== -1) {
      name = a.slice(2, eqIdx);
      value = a.slice(eqIdx + 1);
    } else {
      name = a.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        value = "true";
      } else {
        value = args[i + 1];
        i++;
      }
    }
    if (REPEATABLE_FLAGS.has(name)) {
      const arr = repeated.get(name) ?? [];
      if (value !== undefined) arr.push(value);
      repeated.set(name, arr);
    } else {
      if (value !== undefined) flags.set(name, value);
    }
    i++;
  }

  return { flags, repeated, positional };
}

export function resolvePageId(input: string): string {
  let raw = input.trim().split("#")[0]!;  // strip #block-anchor fragments
  raw = raw.split("?")[0]!;              // strip ?query-string parameters
  const urlMatch = /notion\.(?:so|site)\/(?:[^/]+\/)*([^/?#]+)$/.exec(raw);
  if (urlMatch) raw = urlMatch[1]!;
  const lastDash = raw.lastIndexOf("-");
  if (lastDash !== -1 && raw.length - lastDash === 33) raw = raw.slice(lastDash + 1);

  const compact = raw.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Could not parse Notion ID or URL: ${input}`,
    );
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
}

export function getBooleanFlag(flags: Map<string, string>, name: string): boolean {
  return flags.get(name) === "true";
}

/**
 * Parse a JSON string and validate it is a plain object (not null, array, or scalar).
 * Strips __proto__ and constructor keys to prevent prototype pollution.
 */
export function parseJsonObject(raw: string, flagName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NotionCliError(ErrorCode.USAGE, `${flagName} is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NotionCliError(ErrorCode.USAGE, `${flagName} must be a JSON object, not an array or scalar`);
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(([k]) => k !== "__proto__" && k !== "constructor"),
  );
}

/**
 * Wrap a resource fetch so that a bare NOT_FOUND becomes actionable:
 * most NOT_FOUNDs in Notion happen because the integration isn't connected
 * to that page tree (the API makes inaccessible pages look like they don't
 * exist). This helper adds the Connections hint so users can self-diagnose.
 */
export async function fetchWith404Hint<T>(
  fn: () => Promise<T>,
  resourceName: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotionCliError && err.code === ErrorCode.NOT_FOUND) {
      throw new NotionCliError(
        ErrorCode.NOT_FOUND,
        `${resourceName} not found — either the ID is wrong, or your integration is not connected to this resource.`,
        {
          suggestions: [
            "Open the page/database in Notion → ··· menu → Connections → add your integration.",
            "Connecting at a parent grants access to all descendants recursively.",
            "Or verify the ID with: notionctl resolve <url>",
          ],
        },
      );
    }
    throw err;
  }
}
