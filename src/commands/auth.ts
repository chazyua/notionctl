/**
 * Auth subcommands. `set` reads the token from stdin (never an argument
 * or environment — so it doesn't end up in shell history). `status`
 * verifies the token is valid by calling /users/me, without ever
 * displaying the token itself. `clear` removes the config file.
 */

import { stat } from "node:fs/promises";
import { notionRequest } from "../http.js";
import { saveToken, clearToken, loadToken, getConfigPath, getConfigDir, AuthSource } from "../auth.js";
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

export async function authDoctorCommand(_ctx: { args: string[] }): Promise<string> {
  const checks: Array<{ check: string; status: "pass" | "fail" | "warn"; detail: string }> = [];

  // 1. Token source
  let tokenSource: AuthSource | null = null;
  try {
    const loaded = await loadToken();
    tokenSource = loaded.source;
    checks.push({
      check: "Token configured",
      status: "pass",
      detail: `Source: ${loaded.source === AuthSource.ENV ? "NOTION_TOKEN env var" : getConfigPath()}`,
    });
  } catch (err) {
    checks.push({
      check: "Token configured",
      status: "fail",
      detail: (err as Error).message,
    });
  }

  // 2. Config file permissions (only if using config file)
  if (tokenSource === AuthSource.CONFIG_FILE) {
    try {
      const st = await stat(getConfigPath());
      const mode = st.mode & 0o777;
      if (mode === 0o600) {
        checks.push({ check: "Config file permissions", status: "pass", detail: "mode 0600" });
      } else {
        checks.push({
          check: "Config file permissions",
          status: "fail",
          detail: `mode 0${mode.toString(8)} — should be 0600. Run: chmod 600 ${getConfigPath()}`,
        });
      }
    } catch {
      checks.push({ check: "Config file permissions", status: "warn", detail: "Could not stat config file" });
    }

    // Config dir permissions
    try {
      const st = await stat(getConfigDir());
      const mode = st.mode & 0o777;
      if (mode <= 0o700) {
        checks.push({ check: "Config dir permissions", status: "pass", detail: `mode 0${mode.toString(8)}` });
      } else {
        checks.push({
          check: "Config dir permissions",
          status: "warn",
          detail: `mode 0${mode.toString(8)} — should be 0700. Run: chmod 700 ${getConfigDir()}`,
        });
      }
    } catch {
      // skip if can't stat
    }
  }

  // 3. API connectivity
  if (tokenSource !== null) {
    try {
      const me = await notionRequest<{
        name?: string;
        bot?: { owner?: { type?: string }; workspace_name?: string };
      }>("GET", "/users/me");
      checks.push({
        check: "API reachable",
        status: "pass",
        detail: `Integration: ${me.name ?? "unknown"}`,
      });
      checks.push({
        check: "Workspace",
        status: "pass",
        detail: me.bot?.workspace_name ?? "unknown",
      });
    } catch (err) {
      const code = err instanceof NotionCliError ? err.code : "UNKNOWN";
      checks.push({
        check: "API reachable",
        status: "fail",
        detail: `${code}: ${(err as Error).message}`,
      });
    }

    // 4. Accessible pages (quick search to verify the integration has page connections)
    try {
      const res = await notionRequest<{ results: unknown[] }>("POST", "/search", { query: "", page_size: 1 });
      if (res.results.length > 0) {
        checks.push({ check: "Page access", status: "pass", detail: "At least one page accessible" });
      } else {
        checks.push({
          check: "Page access",
          status: "warn",
          detail: "No pages accessible — connect the integration to pages via ··· → Connections in Notion",
        });
      }
    } catch {
      checks.push({ check: "Page access", status: "warn", detail: "Could not verify page access" });
    }
  }

  // Format output
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;

  const lines: string[] = [];
  for (const c of checks) {
    const icon = c.status === "pass" ? "OK" : c.status === "fail" ? "FAIL" : "WARN";
    lines.push(`[${icon}] ${c.check}: ${c.detail}`);
  }
  lines.push("");
  lines.push(`${passed} passed, ${failed} failed, ${warned} warnings`);

  if (failed > 0) {
    lines.push("Run 'notionctl auth set' to configure a valid token.");
  }

  return lines.join("\n");
}

export async function authClearCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "auth clear requires --yes");
  }
  await clearToken();
  return renderJson({ cleared: true });
}
