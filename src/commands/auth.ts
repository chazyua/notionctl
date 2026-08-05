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
import { parseFlags, getBooleanFlag, readStdinBounded, MAX_STDIN_TOKEN_BYTES, rejectExtraPositionals, type CommandResult } from "./shared.js";
import { NotionCliError, ErrorCode, EXIT_CODES } from "../errors.js";
import { renderJson } from "../output.js";

async function readStdinToken(): Promise<string> {
  // Interactive: resolve on Enter. readStdinBounded only settles on stream
  // end, so at a real terminal the prompt sat there after the user pressed
  // Enter and only completed on Ctrl-D — indistinguishable from a hang.
  // Piped input still goes through the bounded full-stream reader.
  if (process.stdin.isTTY) {
    process.stderr.write("Paste your Notion integration token (ntn_...): ");
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, terminal: true });
    try {
      const line = await new Promise<string>((resolve) => {
        rl.once("line", resolve);
        rl.once("close", () => resolve(""));
      });
      process.stderr.write("\n");
      // Same bound the piped path enforces — an accidental huge paste should
      // not be buffered unchecked just because it arrived interactively.
      if (Buffer.byteLength(line, "utf8") > MAX_STDIN_TOKEN_BYTES) {
        throw new NotionCliError(ErrorCode.USAGE, "Token input is too large — did you paste the wrong thing?");
      }
      return line.trim();
    } finally {
      rl.close();
    }
  }
  const raw = await readStdinBounded(MAX_STDIN_TOKEN_BYTES);
  return raw.trim().split(/\r?\n/)[0] ?? "";
}

export async function authSetCommand(_ctx: { args: string[] }): Promise<string> {
  const token = await readStdinToken();
  if (!token) {
    throw new NotionCliError(ErrorCode.USAGE, "No token provided");
  }
  await saveToken(token);
  return renderJson({ saved: true, path: getConfigPath() });
}

export async function authStatusCommand(_ctx: { args: string[] }): Promise<CommandResult> {
  try {
    const me = await notionRequest<{ name?: string; bot?: unknown }>("GET", "/users/me");
    return renderJson({ valid: true, name: me.name ?? "(unknown)" });
  } catch (err) {
    // The JSON keeps its shape; only the exit code changes, so
    // `notionctl auth status || notionctl auth login` works as written.
    return {
      output: renderJson({ valid: false, error: (err as Error).message }),
      exitCode: EXIT_CODES.AUTH,
    };
  }
}

export async function authDoctorCommand(_ctx: { args: string[] }): Promise<CommandResult> {
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

  // 2. Config file permissions.
  //
  // Also checked when the token failed to load, not only when it loaded from
  // the file. loadToken() refuses any mode other than 0600, so gating the whole
  // block on a successful load made the failing branch unreachable — and that
  // branch is the one carrying the chmod command that fixes it. When the token
  // came from the environment the file is not in use, so it is left alone.
  if (tokenSource === AuthSource.CONFIG_FILE || tokenSource === null) {
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
      // No config file at all is not a fault: the token may simply be unset, or
      // meant to come from NOTION_TOKEN. The token check above already says so.
    }

    // Config dir permissions
    try {
      const st = await stat(getConfigDir());
      const mode = st.mode & 0o777;
      if ((mode & 0o077) === 0) {
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

    // 4. Accessible pages (quick search to verify the integration has page connections).
    // Cap pagination to a single page so the check stays fast — we only need to know
    // whether any result exists, not paginate the whole workspace.
    try {
      const res = await notionRequest<{ results: unknown[] }>("POST", "/search", { query: "", page_size: 1 }, { maxPages: 1 });
      if (res.results.length > 0) {
        checks.push({ check: "Page access", status: "pass", detail: "At least one page accessible" });
      } else {
        checks.push({
          check: "Page access",
          status: "warn",
          detail: "No pages accessible — connect the integration to pages via ··· → Connections in Notion",
        });
      }
    } catch (err) {
      // Say what went wrong — a 403, a timeout and a malformed response all
      // used to read the same, and telling them apart is this command's job.
      const code = err instanceof NotionCliError ? err.code : "UNKNOWN";
      checks.push({
        check: "Page access",
        status: "warn",
        detail: `Could not verify page access — ${code}: ${(err as Error).message}`,
      });
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

  // The whole report still prints — only the exit code reflects the verdict.
  // Warnings are advisory (an integration with no page connections is a valid
  // setup), so they do not fail the command.
  //
  // One code for every failure, deliberately. A caller writes `auth doctor ||
  // fix`, and the report already names which check failed and why; mapping the
  // exit to whichever check happened to fail would need priority rules for the
  // multi-failure case and tell the caller nothing they cannot read. AUTH over
  // GENERIC because GENERIC is what an unhandled crash exits with, and "the
  // diagnostic ran and found problems" should not look like "it fell over".
  return { output: lines.join("\n"), exitCode: failed > 0 ? EXIT_CODES.AUTH : 0 };
}

export async function authListCommand(_ctx: { args: string[] }): Promise<string> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    return "No profiles configured. Run 'notionctl auth set' to create one.";
  }
  return profiles.map((p) => `  ${p}`).join("\n");
}

export async function authClearCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  rejectExtraPositionals(positional, 0);
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "auth clear requires --yes");
  }
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "auth clear", wouldClear: true });
  }
  await clearToken();
  // NOTION_TOKEN outranks the config file, so with it exported the user is
  // still fully authenticated after this. Reporting a bare `cleared: true`
  // read as "logged out" when it wasn't.
  if (process.env.NOTION_TOKEN) {
    return renderJson({
      cleared: true,
      warning: "NOTION_TOKEN is still set in this environment and takes precedence — you remain authenticated. Run `unset NOTION_TOKEN` to finish logging out.",
    });
  }
  return renderJson({ cleared: true });
}

/* ------------------------------------------------------------------ */
/*  OAuth browser login                                                */
/* ------------------------------------------------------------------ */

const OAUTH_TIMEOUT_MS = 300_000;
const DEFAULT_OAUTH_PORT = 9876;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function oauthHtml(title: string, message: string): string {
  return `<!DOCTYPE html><html><head><title>notionctl</title></head>`
    + `<body style="font-family:system-ui,sans-serif;text-align:center;padding:3em">`
    + `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
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
  const clientId = flags.get("client-id") ?? process.env.NOTION_CLIENT_ID;
  const clientSecret = flags.get("client-secret") ?? process.env.NOTION_CLIENT_SECRET;

  if (flags.has("client-secret")) {
    process.stderr.write("Warning: --client-secret is visible in process listings. Use NOTION_CLIENT_SECRET env var instead.\n");
  }

  if (!clientId || !clientSecret) {
    throw new NotionCliError(ErrorCode.USAGE, "auth login requires OAuth credentials (env vars or flags)", {
      suggestions: [
        "Create a public integration at https://www.notion.so/profile/integrations",
        `Set the redirect URI to http://localhost:${DEFAULT_OAUTH_PORT}/callback`,
        "Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables",
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

    let requestCount = 0;
    const server = createServer(async (req, res) => {
      if (++requestCount > 10) {
        res.writeHead(429);
        res.end();
        return;
      }
      if ((req.url?.length ?? 0) > 4096) {
        res.writeHead(400);
        res.end();
        return;
      }
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
