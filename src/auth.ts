/**
 * Auth module — the ONLY file in the codebase that reads or writes the
 * Notion integration token. All other modules must receive the token via
 * http.ts, which calls loadToken() exactly once per process invocation.
 *
 * Security properties:
 *   - Token never touches a log, error message, or stdout/stderr
 *   - Config file is created at mode 0600, parent dir at 0700
 *   - loadToken() refuses to read a config file with permissive mode
 *   - XDG_CONFIG_HOME is respected, fallback to ~/.config
 *   - Token source preference: env var > config file > error
 */

import { mkdir, rm, chmod, open, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { NotionCliError, ErrorCode } from "./errors.js";

export enum AuthSource {
  ENV = "env",
  CONFIG_FILE = "config-file",
}

export interface LoadedToken {
  token: string;
  source: AuthSource;
}

const ENV_VAR = "NOTION_TOKEN";
const PROFILE_ENV_VAR = "NOTION_PROFILE";
const CONFIG_FILENAME = "config.json";
const CONFIG_SUBDIR = "notion-cli";

/** Global profile override set by --profile flag via setActiveProfile(). */
let activeProfile: string | undefined;

interface ConfigFile {
  token: string;
}

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  const resolved = resolve(join(base, CONFIG_SUBDIR));
  if (!resolved.startsWith(homedir())) {
    process.stderr.write(`Warning: config directory is outside home directory: ${resolved}\n`);
  }
  return resolved;
}

/**
 * "default" is the label `auth list` prints for the unprefixed config file, so
 * accepting it as an explicit profile name created a second, distinct
 * `config-default.json` that every unflagged command ignored — while `auth list`
 * showed an indistinguishable "default" entry. Reject it rather than silently
 * building that split-brain state.
 */
function assertUsableProfileName(name: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid profile name: '${name}'. Use only letters, digits, hyphens, and underscores.`,
    );
  }
  if (name === "default") {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "'default' is reserved — omit --profile (and NOTION_PROFILE) to use the default profile.",
    );
  }
}

export function setActiveProfile(name: string): void {
  assertUsableProfileName(name);
  activeProfile = name;
}

function resolveProfile(): string | undefined {
  const name = activeProfile ?? process.env[PROFILE_ENV_VAR] ?? undefined;
  if (name !== undefined) assertUsableProfileName(name);
  return name;
}

export function getConfigPath(profile?: string): string {
  const p = profile ?? resolveProfile();
  const filename = p ? `config-${p}.json` : CONFIG_FILENAME;
  return join(getConfigDir(), filename);
}

export async function listProfiles(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const dir = getConfigDir();
  try {
    const files = await readdir(dir);
    const profiles: string[] = [];
    for (const f of files) {
      if (f === CONFIG_FILENAME) profiles.push("default");
      const m = /^config-(.+)\.json$/.exec(f);
      if (m && /^[a-zA-Z0-9_-]{1,64}$/.test(m[1]!)) profiles.push(m[1]!);
    }
    return profiles.sort();
  } catch {
    return [];
  }
}

/**
 * Warn if token doesn't match expected Notion format (ntn_ or legacy secret_ prefix).
 * Real Notion tokens are ~43–50 alphanumeric characters after the prefix;
 * requiring 40+ catches accidentally truncated tokens without rejecting
 * tokens that have legitimate variation in length.
 */
export const TOKEN_FORMAT = /^(ntn_|secret_)[a-zA-Z0-9]{40,}$/;
export function isValidTokenFormat(token: string): boolean {
  return TOKEN_FORMAT.test(token);
}
function warnIfBadTokenFormat(token: string): void {
  if (!TOKEN_FORMAT.test(token)) {
    process.stderr.write("Warning: token does not match expected Notion format (ntn_... or secret_... followed by ~40+ chars)\n");
  }
}

export async function loadToken(): Promise<LoadedToken> {
  // 1) environment variable takes precedence
  const envToken = process.env[ENV_VAR];
  if (envToken && envToken.length > 0) {
    warnIfBadTokenFormat(envToken);
    return { token: envToken, source: AuthSource.ENV };
  }

  // 2) config file fallback — use open() + fh.stat() + fh.readFile() on the
  //    same file descriptor to eliminate the TOCTOU race between permission
  //    check and read that existed with separate stat() + readFile() calls.
  const path = getConfigPath();
  let raw: string;
  try {
    const fh = await open(path, "r");
    try {
      const st = await fh.stat();
      const mode = st.mode & 0o777;
      if (mode !== 0o600) {
        throw new NotionCliError(
          ErrorCode.AUTH_INVALID,
          `Config file ${path} has insecure permissions (mode ${mode.toString(8)}, expected 600)`,
          {
            suggestions: [
              `Run: chmod 600 ${path}`,
              "Or delete it and re-run 'notionctl auth set' to recreate with correct permissions.",
            ],
          },
        );
      }
      raw = await fh.readFile("utf8");
    } finally {
      await fh.close();
    }
  } catch (err) {
    if (err instanceof NotionCliError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotionCliError(
        ErrorCode.AUTH_MISSING,
        "No Notion token configured.",
        {
          suggestions: [
            `Set NOTION_TOKEN environment variable, or`,
            `Run 'notionctl auth set' to store a token in ${path}`,
          ],
        },
      );
    }
    throw new NotionCliError(
      ErrorCode.AUTH_INVALID,
      `Failed to read config file ${path}`,
      { cause: err },
    );
  }

  let parsed: ConfigFile;
  try {
    parsed = JSON.parse(raw) as ConfigFile;
  } catch (err) {
    throw new NotionCliError(
      ErrorCode.AUTH_INVALID,
      `Config file ${path} is not valid JSON`,
      { cause: err },
    );
  }

  if (!parsed.token || typeof parsed.token !== "string") {
    throw new NotionCliError(
      ErrorCode.AUTH_INVALID,
      `Config file ${path} does not contain a 'token' field`,
    );
  }

  warnIfBadTokenFormat(parsed.token);
  return { token: parsed.token, source: AuthSource.CONFIG_FILE };
}

export async function saveToken(token: string): Promise<void> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to save empty token");
  }
  warnIfBadTokenFormat(token);

  const dir = getConfigDir();
  const path = getConfigPath();

  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Ensure existing dir is tightened (mkdir recursive does not set mode on existing)
  await chmod(dir, 0o700).catch(() => undefined);

  const body = JSON.stringify({ token } satisfies ConfigFile, null, 2) + "\n";
  // Write-then-rename. `writeFile(path, ...)` follows symlinks, so if a
  // same-UID process has planted a symlink at `path` pointing at e.g.
  // ~/.ssh/authorized_keys the token JSON would clobber it. `rename`
  // replaces the directory entry atomically and `wx` on the temp path
  // refuses to open through an existing symlink.
  const tmp = `${path}.tmp-${process.pid}`;
  const fh = await open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(body, "utf8");
    await fh.chmod(0o600);
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function clearToken(): Promise<void> {
  const path = getConfigPath();
  await rm(path, { force: true });
}
