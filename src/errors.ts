/**
 * Typed error model for notionctl.
 *
 * Every user-facing error flows through NotionCliError. The error carries:
 *   - a typed code (enum) for programmatic classification
 *   - a human message
 *   - optional suggestions for recovery
 *   - a distinct exit code so shell scripts can branch on failure mode
 *
 * This is the ONLY place exit codes are defined. Do not hardcode
 * process.exit(N) anywhere else in the codebase — throw a NotionCliError
 * and let index.ts handle the exit.
 */

export enum ErrorCode {
  GENERIC = "GENERIC",
  USAGE = "USAGE",
  AUTH_INVALID = "AUTH_INVALID",
  AUTH_MISSING = "AUTH_MISSING",
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RATE_LIMITED = "RATE_LIMITED",
  NETWORK_ERROR = "NETWORK_ERROR",
  API_ERROR = "API_ERROR",
  INVALID_PROPERTY = "INVALID_PROPERTY",
  INVALID_MARKDOWN = "INVALID_MARKDOWN",
  INVALID_FRONTMATTER = "INVALID_FRONTMATTER",
  SYNC_DRIFT = "SYNC_DRIFT",
  DATABASE_NOT_FOUND = "DATABASE_NOT_FOUND",
  PAGE_NOT_FOUND = "PAGE_NOT_FOUND",
  BLOCK_NOT_FOUND = "BLOCK_NOT_FOUND",
}

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  PERMISSION_DENIED: 5,
  RATE_LIMITED: 6,
  NETWORK_ERROR: 7,
  API_ERROR: 8,
  VALIDATION: 9,
} as const;

const CODE_TO_EXIT: Record<ErrorCode, number> = {
  [ErrorCode.GENERIC]: EXIT_CODES.GENERIC,
  [ErrorCode.USAGE]: EXIT_CODES.USAGE,
  [ErrorCode.AUTH_INVALID]: EXIT_CODES.AUTH,
  [ErrorCode.AUTH_MISSING]: EXIT_CODES.AUTH,
  [ErrorCode.NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.DATABASE_NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.PAGE_NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.BLOCK_NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.PERMISSION_DENIED]: EXIT_CODES.PERMISSION_DENIED,
  [ErrorCode.RATE_LIMITED]: EXIT_CODES.RATE_LIMITED,
  [ErrorCode.NETWORK_ERROR]: EXIT_CODES.NETWORK_ERROR,
  [ErrorCode.API_ERROR]: EXIT_CODES.API_ERROR,
  [ErrorCode.INVALID_PROPERTY]: EXIT_CODES.VALIDATION,
  [ErrorCode.INVALID_MARKDOWN]: EXIT_CODES.VALIDATION,
  [ErrorCode.INVALID_FRONTMATTER]: EXIT_CODES.VALIDATION,
  [ErrorCode.SYNC_DRIFT]: EXIT_CODES.VALIDATION,
};

export interface NotionCliErrorOptions {
  suggestions?: string[];
  cause?: unknown;
}

export class NotionCliError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string, opts: NotionCliErrorOptions = {}) {
    super(message);
    this.name = "NotionCliError";
    this.code = code;
    this.suggestions = opts.suggestions ?? [];
    this.exitCode = CODE_TO_EXIT[code];
    if (opts.cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = opts.cause;
    }
  }
}

/**
 * Regex that matches Notion's integration token format.
 * Used defensively to scrub tokens from error output if they ever
 * leak into a message (which they should never do — http.ts is the
 * only file with token access).
 */
const TOKEN_PATTERN = /ntn_[a-zA-Z0-9]{10,}/g;
const LEGACY_SECRET_PATTERN = /secret_[a-zA-Z0-9]{30,}/g;

/**
 * Control characters (ESC, CR, backspace, …) reaching an interactive terminal
 * are executed, not printed. Error text routinely carries remote data — a page
 * title, a Notion API message, a URL — so a hostile workspace could otherwise
 * clear the screen or forge a convincing `notionctl:` line in the operator's
 * output. Tabs and newlines are legitimate in messages and are kept.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/g;

/** Exported so the output path can apply the same rule — it prints far more
 *  remote text than the error path and had no equivalent guard. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}

export function scrub(text: string): string {
  return stripControlChars(
    text
      .replace(TOKEN_PATTERN, "ntn_***")
      .replace(LEGACY_SECRET_PATTERN, "secret_***"),
  );
}

export function formatErrorJson(err: NotionCliError): string {
  const body: { code: string; message: string; suggestions?: string[] } = {
    code: err.code,
    message: scrub(err.message),
  };
  if (err.suggestions.length > 0) {
    body.suggestions = err.suggestions.map(scrub);
  }
  return JSON.stringify({ error: body });
}

export interface HumanFormatOptions {
  color?: boolean;
}

export function formatErrorHuman(err: NotionCliError, opts: HumanFormatOptions = {}): string {
  const useColor = opts.color ?? false;
  const red = useColor ? "\x1b[31m" : "";
  const bold = useColor ? "\x1b[1m" : "";
  const dim = useColor ? "\x1b[2m" : "";
  const reset = useColor ? "\x1b[0m" : "";

  const lines: string[] = [];
  lines.push(`${red}${bold}error${reset} [${err.code}]: ${scrub(err.message)}`);

  if (err.suggestions.length > 0) {
    lines.push("");
    lines.push(`${dim}suggestions:${reset}`);
    for (const s of err.suggestions) {
      lines.push(`  - ${scrub(s)}`);
    }
  }

  return lines.join("\n");
}
