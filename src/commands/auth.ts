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
import { createInterface } from "node:readline";

export async function authSetCommand(_ctx: { args: string[] }): Promise<string> {
  process.stderr.write("Paste your Notion integration token (ntn_...): ");
  const rl = createInterface({ input: process.stdin, output: undefined, terminal: false });
  const token = await new Promise<string>((resolve) => {
    rl.on("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
    rl.on("close", () => resolve(""));
  });
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
