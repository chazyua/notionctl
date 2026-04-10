/**
 * Auth subcommands. `set` reads the token from stdin (never an argument
 * or environment — so it doesn't end up in shell history). `status`
 * verifies the token is valid by calling /users/me, without ever
 * displaying the token itself. `clear` removes the config file.
 * `login` performs OAuth browser-based login against api.notion.com.
 */

import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { notionRequest, exchangeOAuthCode } from "../http.js";
import { saveToken, clearToken, loadToken, getConfigPath, getConfigDir, listProfiles, AuthSource } from "../auth.js";
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

export async function authListCommand(_ctx: { args: string[] }): Promise<string> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    return "No profiles configured. Run 'notionctl auth set' to create one.";
  }
  return profiles.map((p) => `  ${p}`).join("\n");
}

export async function authClearCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "auth clear requires --yes");
  }
  await clearToken();
  return renderJson({ cleared: true });
}

/* ------------------------------------------------------------------ */
/*  OAuth browser login                                                */
/* ------------------------------------------------------------------ */

const OAUTH_TIMEOUT_MS = 300_000;
const DEFAULT_OAUTH_PORT = 9876;

function oauthHtml(title: string, message: string): string {
  return `<!DOCTYPE html><html><head><title>notionctl</title></head>`
    + `<body style="font-family:system-ui,sans-serif;text-align:center;padding:3em">`
    + `<h1>${title}</h1><p>${message}</p></body></html>`;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {
    // Ignore errors — fallback URL is printed to stderr
  });
}

export async function authLoginCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const clientId = flags.get("client-id");
  const clientSecret = flags.get("client-secret");

  if (!clientId || !clientSecret) {
    throw new NotionCliError(ErrorCode.USAGE, "auth login requires --client-id and --client-secret", {
      suggestions: [
        "Create a public integration at https://www.notion.so/profile/integrations",
        `Set the redirect URI to http://localhost:${DEFAULT_OAUTH_PORT}/callback`,
        "Usage: notionctl auth login --client-id <id> --client-secret <secret>",
      ],
    });
  }

  const port = flags.has("port") ? Number(flags.get("port")) : DEFAULT_OAUTH_PORT;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid port: ${flags.get("port")}`);
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = `http://localhost:${port}/callback`;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const settle = (server: Server, fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(oauthHtml("Authorization Failed", `Error: ${error}`));
        settle(server, () =>
          reject(new NotionCliError(ErrorCode.AUTH_INVALID, `OAuth denied: ${error}`)));
        return;
      }

      if (url.searchParams.get("state") !== state) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(oauthHtml("Authorization Failed", "State mismatch."));
        settle(server, () =>
          reject(new NotionCliError(ErrorCode.AUTH_INVALID, "OAuth state mismatch")));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(oauthHtml("Authorization Failed", "No authorization code received."));
        settle(server, () =>
          reject(new NotionCliError(ErrorCode.AUTH_INVALID, "No authorization code in callback")));
        return;
      }

      try {
        const token = await exchangeOAuthCode(clientId!, clientSecret!, code, redirectUri);
        await saveToken(token);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(oauthHtml("Authorized!", "You can close this tab and return to the terminal."));
        settle(server, () =>
          resolve(renderJson({ login: true, path: getConfigPath() })));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(oauthHtml("Token Exchange Failed", "Check the terminal for details."));
        settle(server, () => reject(err));
      }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      const msg = err.code === "EADDRINUSE"
        ? `Port ${port} is already in use — pick another with --port`
        : `Failed to start OAuth server: ${err.message}`;
      settle(server, () => reject(new NotionCliError(ErrorCode.NETWORK_ERROR, msg)));
    });

    server.listen(port, "127.0.0.1", () => {
      const authorizeUrl = `https://api.notion.com/v1/oauth/authorize`
        + `?client_id=${encodeURIComponent(clientId!)}`
        + `&response_type=code`
        + `&owner=user`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&state=${state}`;
      process.stderr.write(`Opening browser for Notion authorization...\n`);
      process.stderr.write(`If the browser doesn't open, visit:\n${authorizeUrl}\n`);
      openBrowser(authorizeUrl);
    });

    timer = setTimeout(() => {
      settle(server, () =>
        reject(new NotionCliError(ErrorCode.NETWORK_ERROR, "OAuth login timed out (5 minutes)")));
    }, OAUTH_TIMEOUT_MS);
  });
}
