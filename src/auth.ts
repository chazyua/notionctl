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

import { readFile, writeFile, mkdir, rm, stat, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  return join(base, CONFIG_SUBDIR);
}

export function setActiveProfile(name: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid profile name: '${name}'. Use only letters, digits, hyphens, and underscores.`,
    );
  }
  activeProfile = name;
}

function resolveProfile(): string | undefined {
  const name = activeProfile ?? process.env[PROFILE_ENV_VAR] ?? undefined;
  if (name !== undefined && !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid profile name: '${name}'. Use only letters, digits, hyphens, and underscores.`,
    );
  }
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
      if (m) profiles.push(m[1]!);
    }
    return profiles.sort();
  } catch {
    return [];
  }
}

export async function loadToken(): Promise<LoadedToken> {
  // 1) environment variable takes precedence
  const envToken = process.env[ENV_VAR];
  if (envToken && envToken.length > 0) {
    return { token: envToken, source: AuthSource.ENV };
  }

  // 2) config file fallback
  const path = getConfigPath();
  let raw: string;
  try {
    const st = await stat(path);
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
    raw = await readFile(path, "utf8");
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

  return { token: parsed.token, source: AuthSource.CONFIG_FILE };
}

export async function saveToken(token: string): Promise<void> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to save empty token");
  }

  const dir = getConfigDir();
  const path = getConfigPath();

  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Ensure existing dir is tightened (mkdir recursive does not set mode on existing)
  await chmod(dir, 0o700).catch(() => undefined);

  const body = JSON.stringify({ token } satisfies ConfigFile, null, 2) + "\n";
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function clearToken(): Promise<void> {
  const path = getConfigPath();
  await rm(path, { force: true });
}
