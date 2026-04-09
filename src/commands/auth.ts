/**
 * Auth subcommands. `set` reads the token from stdin (never an argument
 * or environment — so it doesn't end up in shell history). `status`
 * verifies the token is valid by calling /users/me, without ever
 * displaying the token itself. `clear` removes the config file.
 */

import { notionRequest } from "../http.js";
import { saveToken, clearToken, getConfigPath } from "../auth.js";
import { parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson } from "../output.js";

async function readStdinToken(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write("Paste your Notion integration token (ntn_...): ");
  }
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8").trim().split(/\r?\n/)[0] ?? "");
    });
    process.stdin.on("error", reject);
  });
}

export async function authSetCommand(_ctx: { args: string[] }): Promise<string> {
  const token = await readStdinToken();
  if (!token) {
    throw new NotionCliError(ErrorCode.USAGE, "No token provided");
  }
  await saveToken(token);
  return renderJson({ saved: true, path: getConfigPath() });
}

export async function authStatusCommand(_ctx: { args: string[] }): Promise<string> {
  try {
    const me = await notionRequest<{ name?: string; bot?: unknown }>("GET", "/users/me");
    return renderJson({ valid: true, name: me.name ?? "(unknown)" });
  } catch (err) {
    return renderJson({ valid: false, error: (err as Error).message });
  }
}

export async function authClearCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "auth clear requires --yes");
  }
  await clearToken();
  return renderJson({ cleared: true });
}
