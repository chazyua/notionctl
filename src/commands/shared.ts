/**
 * Shared helpers for all command modules: flag parsing (no yargs, no
 * commander — we do it ourselves), ID resolution, and consistent
 * option handling across commands.
 */

import { readFile as nodeReadFile } from "node:fs/promises";
import { NotionCliError, ErrorCode } from "../errors.js";
import { notionRequest } from "../http.js";
import type { Readable } from "node:stream";

const MAX_STDIN_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_STDIN_TOKEN_BYTES = 4 * 1024;   // 4 KB (tokens are short)

/**
 * Read a stream with a bounded size limit to prevent OOM from unbounded input.
 * Defaults to process.stdin; the optional stream parameter exists for testing.
 */
export function readStdinBounded(
  maxBytes = MAX_STDIN_BYTES,
  stream: Readable = process.stdin,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    // Guarantee exactly one settle and always detach listeners.
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      fn();
    };

    const onData = (c: Buffer) => {
      totalBytes += c.length;
      if (totalBytes > maxBytes) {
        settle(() => {
          if (stream !== process.stdin) stream.destroy();
          reject(new NotionCliError(ErrorCode.USAGE, `stdin input exceeds maximum size (${maxBytes} bytes)`));
        });
        return;
      }
      chunks.push(c);
    };
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    const onError = (err: Error) => settle(() => reject(err));

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

export { MAX_STDIN_TOKEN_BYTES };

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

const BOOLEAN_LITERALS = new Set([
  "true", "false", "1", "0", "yes", "no", "y", "n", "on", "off",
]);

/**
 * Refuse an argument the command has no slot for.
 *
 * Boolean flags never consume a following token, so `page delete <id> --yes false`
 * parsed as yes=true plus an unread `"false"` positional and archived the page —
 * the opposite of what the caller asked for. Catching that in the flag parser
 * would break commands whose positionals are free text (`search --verbose n`),
 * so the arity check belongs here, in the commands that actually have a fixed
 * shape. Any stray token is refused, not just boolean-looking ones.
 */
export function rejectExtraPositionals(positional: string[], expected: number): void {
  if (positional.length <= expected) return;
  const extra = positional[expected]!;
  const hint = BOOLEAN_LITERALS.has(extra.toLowerCase())
    ? " Boolean flags take no value — pass the flag on its own, or write it as --flag=value."
    : "";
  throw new NotionCliError(ErrorCode.USAGE, `Unexpected argument: ${extra}.${hint}`);
}

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
        const nextArg = args[i + 1];
        if (nextArg === undefined || nextArg.startsWith("--")) {
          throw new NotionCliError(
            ErrorCode.USAGE,
            `Flag --${name} requires a value. If the value itself starts with '--', use --${name}=<value> instead.`,
          );
        }
        value = nextArg;
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
  raw = raw.replace(/\/+$/, "");         // strip trailing slashes
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
 * Recursively strips `__proto__`, `constructor`, and `prototype` keys from
 * every nested object / array element so an adversarial payload like
 * `{"a":{"__proto__":{"polluted":true}}}` cannot survive into downstream
 * code paths that might spread it back onto a literal.
 *
 * We run a single post-parse walker instead of relying on `JSON.parse` reviver
 * semantics so the sanitization is observable and testable, and so the error
 * path remains a clean `USAGE` error on parse failure.
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
  return sanitizeJsonObject(parsed as Record<string, unknown>);
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  return sanitizeJsonObject(value as Record<string, unknown>);
}

function sanitizeJsonObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    out[k] = sanitizeJsonValue(v);
  }
  // Return a regular object (not null-prototype) so downstream JSON.stringify
  // and destructuring continue to behave the same as before.
  return { ...out };
}

/**
 * Read a file as utf-8, translating filesystem errors into typed
 * NotionCliErrors so the CLI surfaces a clean message instead of leaking a
 * bare ENOENT through the unhandled-error path.
 */
export async function readFileText(path: string, label = "file"): Promise<string> {
  try {
    return await nodeReadFile(path, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new NotionCliError(ErrorCode.USAGE, `${label} not found: ${path}`);
    }
    if (e.code === "EACCES" || e.code === "EPERM") {
      throw new NotionCliError(ErrorCode.USAGE, `Permission denied reading ${label}: ${path}`);
    }
    if (e.code === "EISDIR") {
      throw new NotionCliError(ErrorCode.USAGE, `Expected a file but got a directory: ${path}`);
    }
    throw new NotionCliError(ErrorCode.GENERIC, `Failed to read ${label} ${path}: ${e.message}`);
  }
}

/**
 * Detect whether a Notion parent ID is a database or a page.
 * Probe /databases/{id}; if it succeeds the id is a database, otherwise
 * treat it as a page. Single source of truth — keeping this in one place
 * prevents the DB/page-parent drift that previously lived in four copies.
 */
export async function detectParentType(parentId: string): Promise<"page_id" | "database_id"> {
  try {
    await notionRequest("GET", `/databases/${parentId}`);
    return "database_id";
  } catch {
    return "page_id";
  }
}

/**
 * Look up the actual key of the title property on a page. For database rows
 * this is the user-chosen column name (commonly "Name"); for standalone pages
 * it is "title". Notion's PATCH /pages expects the real key, not the type.
 */
export async function resolveTitlePropertyKey(pageId: string): Promise<string> {
  const page = await notionRequest<{ properties: Record<string, { type?: string }> }>(
    "GET",
    `/pages/${pageId}`,
  );
  for (const [key, value] of Object.entries(page.properties)) {
    if (value?.type === "title") return key;
  }
  throw new NotionCliError(
    ErrorCode.GENERIC,
    `Page ${pageId} has no title property — cannot update title.`,
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
