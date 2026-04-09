/**
 * http.ts — The single file in the codebase that makes network calls.
 *
 * Every command module calls notionRequest() and nothing else for I/O.
 * Base URL is hardcoded to https://api.notion.com/v1 — there is no flag
 * to override it (that would be a token-exfiltration footgun).
 *
 * Security properties:
 *   - Only https://api.notion.com is reachable from this module
 *   - The token is loaded once via a pluggable provider (auth.ts in prod,
 *     mocks in tests) and attached to the Authorization header
 *   - The token is never included in thrown errors or log output
 *   - Retries are deterministic: same inputs + same transient errors
 *     produce the same retry sequence
 *
 * This file is split across Tasks 9, 10, and 11 — read them together
 * when reviewing.
 */

import { loadToken } from "./auth.js";
import { NotionCliError, ErrorCode } from "./errors.js";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = "notionctl/0.1.0";  // TODO: read from package.json at build time

type TokenProvider = () => Promise<{ token: string; source: string }>;

let tokenProvider: TokenProvider = loadToken;
let cachedToken: string | undefined;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
  cachedToken = undefined;
}

export function resetForTesting(): void {
  tokenProvider = loadToken;
  cachedToken = undefined;
}

async function getToken(): Promise<string> {
  if (cachedToken !== undefined) return cachedToken;
  const loaded = await tokenProvider();
  cachedToken = loaded.token;
  return cachedToken;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export async function notionRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `notionRequest path must be a relative API path (got: ${path})`,
    );
  }
  if (!path.startsWith("/")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `notionRequest path must start with '/' (got: ${path})`,
    );
  }

  const url = `${API_BASE}${path}`;
  if (!url.startsWith("https://api.notion.com/")) {
    throw new NotionCliError(
      ErrorCode.GENERIC,
      "Internal error: computed URL escaped api.notion.com base",
    );
  }

  const token = await getToken();
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "User-Agent": USER_AGENT,
  };

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const timeoutMs = parseTimeoutEnv() ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new NotionCliError(
        ErrorCode.NETWORK_ERROR,
        `Request to ${path} timed out after ${timeoutMs}ms`,
      );
    }
    throw new NotionCliError(
      ErrorCode.NETWORK_ERROR,
      `Network error calling ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }

  return parseResponse<T>(response, path);
}

async function parseResponse<T>(response: Response, path: string): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let apiMessage = `HTTP ${response.status}`;
  try {
    const errBody = (await response.json()) as { code?: string; message?: string };
    if (errBody.message) apiMessage = errBody.message;
  } catch {
    // non-JSON error body, fall through with status code only
  }

  const code = mapStatusToErrorCode(response.status);
  throw new NotionCliError(code, `${path}: ${apiMessage}`);
}

function mapStatusToErrorCode(status: number): ErrorCode {
  if (status === 401) return ErrorCode.AUTH_INVALID;
  if (status === 403) return ErrorCode.PERMISSION_DENIED;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  if (status >= 500) return ErrorCode.API_ERROR;
  return ErrorCode.API_ERROR;
}

function parseTimeoutEnv(): number | undefined {
  const raw = process.env.NOTION_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
