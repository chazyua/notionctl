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

import { loadToken, type LoadedToken } from "./auth.js";
import { NotionCliError, ErrorCode } from "./errors.js";
import { VERSION } from "./version.js";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = `notionctl/${VERSION}`;

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000] as const;

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Notion publishes no idempotency-key header, so a write repeated after an
 * ambiguous failure lands twice and the CLI reports one success.
 *
 * Classification is per endpoint, not per method: POST /search and
 * POST /{databases,data_sources}/{id}/query are reads that must keep retrying,
 * while PATCH /blocks/{id}/children appends rather than sets. Unknown POST
 * paths (reachable via `notionctl api`) are treated as writes.
 *
 * Exported for unit testing.
 */
export function isNonIdempotent(method: string, path: string): boolean {
  if (method === "POST") {
    return !/^\/(?:search|(?:databases|data_sources)\/[^/?#]+\/query)(?:[?#]|$)/.test(path);
  }
  if (method === "PATCH") {
    // Deliberately unanchored: an unrecognised append endpoint must classify as a
    // write, since the fallthrough below assumes PATCH sets rather than appends.
    // The optional trailing slash matters — Notion accepts `/children/` and
    // appends normally, so missing it would blind-retry a real duplicate.
    return /\/(?:children|send)\/?(?:[?#]|$)/.test(path);
  }
  return false;
}

const NO_RETRY_HINT =
  "Check whether it was applied before running the command again — Notion cannot deduplicate a repeated write, so notionctl does not retry this automatically.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TokenProvider = () => Promise<LoadedToken>;

let tokenProvider: TokenProvider = loadToken;
let cachedToken: string | undefined;

let debugMode = false;
let verboseMode = false;
let requestCount = 0;

export function setDebugMode(on: boolean): void { debugMode = on; }
export function setVerboseMode(on: boolean): void { verboseMode = on; }
export function isVerboseMode(): boolean { return verboseMode; }
export function getRequestCount(): number { return requestCount; }

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
  cachedToken = undefined;
}

export function resetForTesting(): void {
  tokenProvider = loadToken;
  cachedToken = undefined;
  debugMode = false;
  verboseMode = false;
  requestCount = 0;
}

async function getToken(): Promise<string> {
  if (cachedToken !== undefined) return cachedToken;
  const loaded = await tokenProvider();
  cachedToken = loaded.token;
  return cachedToken;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function notionRequestSingle<T = unknown>(
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

  let response: Response | undefined;
  let lastError: Error | undefined;
  const unsafeToRepeat = isNonIdempotent(method, path);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    init.signal = controller.signal;

    requestCount++;
    if (debugMode) {
      process.stderr.write(`[debug] ${method} ${path}${attempt > 0 ? ` (retry ${attempt})` : ""}\n`);
    }

    try {
      response = await fetch(url, init);
    } catch (err) {
      clearTimeout(timer);
      lastError = err as Error;
      const timedOut = (err as Error).name === "AbortError";

      // No response arrived, so whether Notion applied the write is unknowable.
      // Retrying here is what silently creates the duplicate.
      if (unsafeToRepeat) {
        throw new NotionCliError(
          ErrorCode.NETWORK_ERROR,
          `${method} ${path} ${timedOut ? `timed out after ${timeoutMs}ms` : `failed: ${(err as Error).message}`} before a response arrived. The request may still have been applied.`,
          { suggestions: [NO_RETRY_HINT], ...(timedOut ? {} : { cause: err }) },
        );
      }

      if (timedOut) {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new NotionCliError(
            ErrorCode.NETWORK_ERROR,
            `Request to ${path} timed out after ${timeoutMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          );
        }
      } else {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new NotionCliError(
            ErrorCode.NETWORK_ERROR,
            `Network error calling ${path}: ${(err as Error).message}`,
            { cause: err },
          );
        }
      }
      await sleep(BACKOFF_MS[attempt] ?? 4000);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (debugMode) {
      process.stderr.write(`[debug] ${response.status} ${response.statusText}\n`);
    }

    if (response.ok) {
      // A 200 carrying a non-JSON body means something between us and Notion
      // answered instead (an intercepting proxy, a captive portal). Without
      // this guard the raw SyntaxError escaped as "Internal error: Unexpected
      // token '<'", which reads like a notionctl bug rather than a network one.
      try {
        return (await response.json()) as T;
      } catch {
        throw new NotionCliError(
          ErrorCode.NETWORK_ERROR,
          `Notion returned a non-JSON response for ${path} (HTTP ${response.status}). A proxy or captive portal may be intercepting the request.`,
        );
      }
    }

    if (!shouldRetry(response.status)) {
      return parseResponse<T>(response, path);
    }

    // A 5xx (or 529 service_overload) means Notion received the request; whether
    // it applied it before failing is unknowable, unlike a 429 rejection.
    if (unsafeToRepeat && response.status !== 429) {
      return parseResponse<T>(response, path, [NO_RETRY_HINT]);
    }

    if (attempt === MAX_ATTEMPTS - 1) {
      return parseResponse<T>(response, path);
    }

    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    const MAX_RETRY_AFTER_MS = 60_000;
    const backoff = retryAfterMs && Number.isFinite(retryAfterMs)
      ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS)
      : (BACKOFF_MS[attempt] ?? 4000);
    // Announce waits the user would otherwise experience as a frozen terminal.
    // Rate-limit backoff can legitimately run to a minute per attempt.
    if (backoff >= 1000) {
      process.stderr.write(`notionctl: rate limited or transient error — retrying in ${Math.round(backoff / 1000)}s\n`);
    }
    await sleep(backoff);
  }

  // Should be unreachable — the loop always returns or throws.
  throw new NotionCliError(
    ErrorCode.GENERIC,
    `Internal error: retry loop exhausted without resolution (${lastError?.message ?? "unknown"})`,
  );
}

async function parseResponse<T>(response: Response, path: string, suggestions?: string[]): Promise<T> {
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
  throw new NotionCliError(code, `${path}: ${apiMessage}`, suggestions ? { suggestions } : undefined);
}

function mapStatusToErrorCode(status: number): ErrorCode {
  if (status === 401) return ErrorCode.AUTH_INVALID;
  if (status === 403) return ErrorCode.PERMISSION_DENIED;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  if (status >= 500) return ErrorCode.API_ERROR;
  return ErrorCode.API_ERROR;
}

const MAX_TIMEOUT_MS = 300_000;

function parseTimeoutEnv(): number | undefined {
  const raw = process.env.NOTION_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, MAX_TIMEOUT_MS);
}

interface PaginatedResponse<T> {
  object: "list";
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

function isPaginated(body: unknown): body is PaginatedResponse<unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as PaginatedResponse<unknown>).object === "list" &&
    Array.isArray((body as PaginatedResponse<unknown>).results) &&
    typeof (body as PaginatedResponse<unknown>).has_more === "boolean"
  );
}

export async function notionRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts: { maxPages?: number } = {},
): Promise<T> {
  const first = await notionRequestSingle<T>(method, path, body);
  if (!isPaginated(first)) return first;

  const maxPages = opts.maxPages ?? 100;
  const allResults: unknown[] = [...first.results];
  let cursor = first.has_more ? first.next_cursor : null;
  let page = 1;

  while (cursor && page < maxPages) {
    const nextBody = method === "POST" && body && typeof body === "object"
      ? { ...(body as object), start_cursor: cursor }
      : undefined;
    const nextPath = method === "GET"
      ? appendQuery(path, "start_cursor", cursor)
      : path;

    const next = await notionRequestSingle<PaginatedResponse<unknown>>(
      method,
      nextPath,
      nextBody,
    );
    allResults.push(...next.results);
    cursor = next.has_more ? next.next_cursor : null;
    page++;
  }

  // If the loop stopped because it hit the page cap while Notion still had
  // more, say so instead of reporting a complete result set. Claiming
  // has_more:false here made a truncated read look authoritative, so a caller
  // processing a large database silently acted on partial data.
  if (cursor) {
    // Only warn when the cap was ours. A caller that asked for a bounded probe
    // (auth doctor requests a single page) already knows the result is partial,
    // and warning there is just noise on a healthy run.
    if (opts.maxPages === undefined) {
      process.stderr.write(
        `notionctl: results truncated at ${allResults.length} items (${maxPages}-page limit) — more remain. Narrow the query with a filter to see the rest.\n`,
      );
    }
    return { ...first, results: allResults, has_more: true, next_cursor: cursor } as T;
  }

  return { ...first, results: allResults, has_more: false, next_cursor: null } as T;
}

/**
 * Append blocks to a page/block, automatically chunking to stay within
 * Notion's 100-block-per-request limit. Returns the combined results.
 */
const BLOCK_CHUNK_SIZE = 100;

export async function appendBlocksChunked(
  parentId: string,
  blocks: unknown[],
  opts?: { after?: string },
): Promise<{ results: unknown[] }> {
  const allResults: unknown[] = [];
  let afterId = opts?.after;

  for (let i = 0; i < blocks.length; i += BLOCK_CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + BLOCK_CHUNK_SIZE);
    const body: Record<string, unknown> = { children: chunk };
    if (afterId) {
      body.position = { type: "after_block", after_block: { id: afterId } };
    }
    const res = await notionRequest<{ results: Array<{ id: string }> }>(
      "PATCH",
      `/blocks/${parentId}/children`,
      body,
    );
    allResults.push(...res.results);
    if (res.results.length > 0) {
      afterId = res.results[res.results.length - 1]!.id;
    }
  }

  return { results: allResults };
}

/**
 * Upload a file to Notion. Two-step process:
 *   1. POST /file_uploads (JSON) — create upload session
 *   2. POST /file_uploads/{id}/send (multipart) — send file data
 *
 * This is the only other outbound HTTP function besides notionRequest.
 * Same auth, same URL enforcement, same domain restriction.
 */
export async function notionUploadFile(
  filePath: string,
  fileName: string,
  contentType: string,
): Promise<{ id: string; status: string; [key: string]: unknown }> {
  // Step 1: create upload session
  const session = await notionRequestSingle<{ id: string; status: string; [key: string]: unknown }>(
    "POST",
    "/file_uploads",
    { file_name: fileName, content_type: contentType },
  );

  // Step 2: send file data with retry and timeout
  const { readFile } = await import("node:fs/promises");
  const fileBuffer = await readFile(filePath);

  const uploadUrl = `${API_BASE}/file_uploads/${session.id}/send`;
  if (!uploadUrl.startsWith("https://api.notion.com/")) {
    throw new NotionCliError(ErrorCode.GENERIC, "Internal error: upload URL escaped api.notion.com");
  }

  const token = await getToken();
  const timeoutMs = parseTimeoutEnv() ?? DEFAULT_TIMEOUT_MS;

  let response: Response | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: contentType });
    formData.append("file", blob, fileName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "User-Agent": USER_AGENT,
        },
        body: formData,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // Sending file data is not idempotent and no response arrived, so the part
      // may already be stored. Fail rather than risk sending it twice.
      throw new NotionCliError(
        ErrorCode.NETWORK_ERROR,
        `File upload to /file_uploads/${session.id}/send failed: ${(err as Error).message}. The upload may have partially completed.`,
        { suggestions: [NO_RETRY_HINT] },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) break;

    // Same reasoning as notionRequestSingle: only a 429 is provably safe to repeat.
    if (response.status !== 429 || attempt === MAX_ATTEMPTS - 1) {
      let message = `HTTP ${response.status}`;
      try {
        const errBody = (await response.json()) as { message?: string };
        if (errBody.message) message = errBody.message;
      } catch { /* non-JSON error */ }
      throw new NotionCliError(
        mapStatusToErrorCode(response.status),
        `/file_uploads/${session.id}/send: ${message}`,
        // Matches the network-error path above: the send is not repeated, so say so.
        { suggestions: [NO_RETRY_HINT] },
      );
    }

    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    const MAX_RETRY_AFTER_MS = 60_000;
    const backoff = retryAfterMs && Number.isFinite(retryAfterMs)
      ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS)
      : (BACKOFF_MS[attempt] ?? 4000);
    // Announce waits the user would otherwise experience as a frozen terminal.
    // Rate-limit backoff can legitimately run to a minute per attempt.
    if (backoff >= 1000) {
      process.stderr.write(`notionctl: rate limited or transient error — retrying in ${Math.round(backoff / 1000)}s\n`);
    }
    await sleep(backoff);
  }

  return (await response!.json()) as { id: string; status: string; [key: string]: unknown };
}

/**
 * OAuth token exchange — POST /v1/oauth/token with Basic auth.
 * This is the only non-Bearer outbound call. Same domain restriction:
 * only api.notion.com, credentials never logged.
 */
export async function exchangeOAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const url = `${API_BASE}/oauth/token`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const timeoutMs = parseTimeoutEnv() ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new NotionCliError(ErrorCode.NETWORK_ERROR, `OAuth token exchange timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as { error?: string; message?: string };
      message = errBody.message ?? errBody.error ?? message;
    } catch { /* non-JSON error body */ }
    throw new NotionCliError(ErrorCode.AUTH_INVALID, `Token exchange failed: ${message}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new NotionCliError(ErrorCode.AUTH_INVALID, "Token exchange response missing access_token");
  }

  return data.access_token;
}

function appendQuery(path: string, key: string, value: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
