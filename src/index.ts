/**
 * CLI entry point. Parses global flags, dispatches to command modules,
 * catches NotionCliError to set exit codes, and routes to the format
 * switcher for output.
 *
 * Usage:
 *   notionctl <noun> <verb> [args...] [--flags...]
 *   notionctl whoami
 *   notionctl search <query>
 *   notionctl resolve <url>
 *   notionctl api <METHOD> <path> [--body @file.json]
 *
 * See README for the full command list.
 */

import { NotionCliError, ErrorCode, formatErrorJson, formatErrorHuman, scrub } from "./errors.js";
import { isStdoutTty } from "./output.js";
import { VERSION } from "./version.js";
import { setActiveProfile } from "./auth.js";
import { setMarkdownWarnHandler } from "./markdown/write.js";
import { setTokenizerWarnHandler } from "./markdown/tokenizer.js";
import { setDebugMode, setVerboseMode, isVerboseMode, getRequestCount } from "./http.js";
import type { CommandResult } from "./commands/shared.js";

type CommandHandler = (ctx: { args: string[] }) => Promise<CommandResult>;

async function loadCommand(noun: string, verb: string | undefined): Promise<CommandHandler> {
  switch (noun) {
    case "whoami": return (await import("./commands/meta.js")).whoamiCommand;
    case "resolve": return (await import("./commands/meta.js")).resolveCommand;
    case "search": return (await import("./commands/meta.js")).searchCommand;
    case "api": return (await import("./commands/meta.js")).apiCommand;
    case "page": {
      const mod = await import("./commands/page.js");
      switch (verb) {
        case "get": return mod.pageGetCommand;
        case "create": return mod.pageCreateCommand;
        case "append": return mod.pageAppendCommand;
        case "update": return mod.pageUpdateCommand;
        case "open": return mod.pageOpenCommand;
        case "find-replace": return mod.pageFindReplaceCommand;
        case "duplicate": return mod.pageDuplicateCommand;
        case "move": return mod.pageMoveCommand;
        case "restore": return mod.pageRestoreCommand;
        case "delete": return mod.pageDeleteCommand;
        case "sync": return mod.pageSyncCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown page verb: ${verb}`);
      }
    }
    case "db": {
      const mod = await import("./commands/db.js");
      switch (verb) {
        case "create": return mod.dbCreateCommand;
        case "update": return mod.dbUpdateCommand;
        case "query": return mod.dbQueryCommand;
        case "schema": return mod.dbSchemaCommand;
        case "row": {
          // db row <subverb>: look further into args inside the handler
          return async (ctx) => {
            const sub = ctx.args[0];
            const rest = { args: ctx.args.slice(1) };
            switch (sub) {
              case "get": return mod.dbRowGetCommand(rest);
              case "create": return mod.dbRowCreateCommand(rest);
              case "update": return mod.dbRowUpdateCommand(rest);
              case "delete": return mod.dbRowDeleteCommand(rest);
              default:
                throw new NotionCliError(ErrorCode.USAGE, sub === undefined
                  ? "Usage: notionctl db row <get|create|update|delete> [args...]"
                  : `Unknown db row verb: ${sub}`);
            }
          };
        }
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown db verb: ${verb}`);
      }
    }
    case "block": {
      const mod = await import("./commands/block.js");
      switch (verb) {
        case "get": return mod.blockGetCommand;
        case "children": return mod.blockChildrenCommand;
        case "append": return mod.blockAppendCommand;
        case "update": return mod.blockUpdateCommand;
        case "delete": return mod.blockDeleteCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown block verb: ${verb}`);
      }
    }
    case "file": {
      const mod = await import("./commands/file.js");
      switch (verb) {
        case "upload": return mod.fileUploadCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown file verb: ${verb}`);
      }
    }
    case "comment": {
      const mod = await import("./commands/comment.js");
      switch (verb) {
        case "list": return mod.commentListCommand;
        case "add": return mod.commentAddCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown comment verb: ${verb}`);
      }
    }
    case "user": {
      const mod = await import("./commands/user.js");
      switch (verb) {
        case "list": return mod.userListCommand;
        case "me": return mod.userMeCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown user verb: ${verb}`);
      }
    }
    case "auth": {
      const mod = await import("./commands/auth.js");
      switch (verb) {
        case "login": return mod.authLoginCommand;
        case "set": return mod.authSetCommand;
        case "status": return mod.authStatusCommand;
        case "doctor": return mod.authDoctorCommand;
        case "list": return mod.authListCommand;
        case "clear": return mod.authClearCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown auth verb: ${verb}`);
      }
    }
    default:
      throw new NotionCliError(ErrorCode.USAGE, `Unknown command: ${noun}`);
  }
}

function printHelp(): string {
  return `notionctl — security-auditable CLI for Notion

Usage:
  notionctl whoami
  notionctl resolve <url>
  notionctl search <query> [--type page|db]
  notionctl api <METHOD> <path> [--body @file.json]

  notionctl page get <id>
  notionctl page create --parent <id> --title <text> [--from file.md]
  notionctl page append <id> [--from file.md]
  notionctl page update <id> [--from file.md]
  notionctl page sync <file.md> [--parent <id>] [--force]
  notionctl page open <id-or-url>
  notionctl page find-replace <id> --find <text> --replace <text>
  notionctl page duplicate <id> [--parent <id>] [--title "new title"]
  notionctl page move <id> --to <parent-id>
  notionctl page restore <id>
  notionctl page delete <id> --yes

  notionctl db create --parent <page-id> --title <text> [--prop Name=type[:options] ...]
  notionctl db update <id> [--title X] [--add-prop Name=type ...] [--remove-prop Name ...] [--rename-prop Old=New ...]
  notionctl db query <id> [--filter Key=value] [--sort Key:desc] [--filter-json @f.json]
  notionctl db schema <id>
  notionctl db row get <page-id>
  notionctl db row create <db-id> [--prop Key=value ...] [--from file.md]
  notionctl db row update <page-id> [--prop Key=value ...]
  notionctl db row delete <page-id> --yes

  notionctl block get <id>
  notionctl block children <id> [--recursive]
  notionctl block append <id> [--from file.md]
  notionctl block update <id> --prop-json '<json>'
  notionctl block delete <id> --yes

  notionctl file upload <path> [--parent <page-id>]

  notionctl comment list <page-id>
  notionctl comment add <page-id> --text "..."

  notionctl user list
  notionctl user me

  notionctl auth login [--client-id <id>] [--port 9876]
  notionctl auth set [--profile <name>]
  notionctl auth status
  notionctl auth doctor
  notionctl auth list
  notionctl auth clear --yes

Global flags:
  --format md|json|table|csv   Output format (default depends on command + TTY)
  --dry-run                    Preview write operations without sending
  --verbose                    Show request count on stderr after completion
  --quiet                      Suppress non-essential output
  --no-color                   Force plain output
  --debug                      Log HTTP method, path, and status to stderr
  --yes                        Confirm destructive operations
  --profile <name>             Use a named auth profile

Environment:
  NOTION_TOKEN         Integration token (preferred over any profile)
  NOTION_PROFILE       Default profile name (if no --profile flag)
  NOTION_TIMEOUT_MS    Request timeout (default 30000)
  XDG_CONFIG_HOME      Base dir for config file (default ~/.config)

See https://github.com/chazyua/notionctl for full documentation.
`;
}

/**
 * `head`, `less`, and friends close the pipe as soon as they have what they
 * want. Because we now await the write callback, that EPIPE has time to reach
 * the stream as an 'error' event — with no listener it would crash the process
 * with a stack trace. A reader leaving early is a normal way to end a
 * pipeline, so treat it as a clean exit.
 */
function ignoreEpipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
  });
}

/**
 * Write to a stream and wait until the data has actually been handed to the
 * OS before resolving. `process.exit()` discards whatever is still buffered,
 * and writes to a pipe are asynchronous — so exiting straight after a write
 * silently truncated any output larger than the 64 KB pipe buffer while still
 * reporting exit 0. Every exit path flushes through this first.
 */
function writeFlushed(stream: NodeJS.WriteStream, data: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(data, () => resolve());
  });
}

async function exitAfter(stream: NodeJS.WriteStream, data: string, code: number): Promise<never> {
  await writeFlushed(stream, data);
  process.exit(code);
}

async function main(): Promise<void> {
  ignoreEpipe(process.stdout);
  ignoreEpipe(process.stderr);
  setMarkdownWarnHandler((msg) => process.stderr.write(msg + "\n"));
  setTokenizerWarnHandler((msg) => process.stderr.write(msg + "\n"));
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    await exitAfter(process.stdout, printHelp(), 0);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    await exitAfter(process.stdout, `notionctl ${VERSION}\n`, 0);
  }

  // Extract --profile before command parsing (global flag). Accept both
  // `--profile name` and `--profile=name` forms.
  //
  // The value must not itself look like a flag: `--profile --dry-run` would
  // otherwise consume `--dry-run` as the profile name and silently strip the
  // safety flag the user typed, turning a preview into a real write. Mirrors
  // the same guard parseFlags applies to every other value-taking flag.
  const profileSpaceIdx = argv.indexOf("--profile");
  if (profileSpaceIdx !== -1) {
    const value = argv[profileSpaceIdx + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new NotionCliError(
        ErrorCode.USAGE,
        "Flag --profile requires a value. If the value itself starts with '--', use --profile=<value> instead.",
      );
    }
    setActiveProfile(value);
    argv.splice(profileSpaceIdx, 2);
  } else {
    const profileEqIdx = argv.findIndex((a) => a.startsWith("--profile="));
    if (profileEqIdx !== -1) {
      setActiveProfile(argv[profileEqIdx]!.slice("--profile=".length));
      argv.splice(profileEqIdx, 1);
    }
  }

  // `--help`/`--version` are accepted in a bounded head window (positions
  // 0 and 1) so a `--help` or `-v` buried inside a command's flag values
  // cannot short-circuit dispatch. The window covers top-level invocations
  // (`notionctl --help`) and per-noun help (`notionctl page --help`).
  // Subcommand help (`notionctl page get --help`) is handled by stripping
  // any `--help`/`-h` that appears after the verb so the per-command flag
  // parser never sees it.
  const HEAD_HELP = new Set(["--help", "-h"]);
  const HEAD_VERSION = new Set(["--version", "-v"]);
  if (argv.length > 0 && (HEAD_HELP.has(argv[0]!) || (argv.length > 1 && HEAD_HELP.has(argv[1]!)))) {
    await exitAfter(process.stdout, printHelp(), 0);
  }
  if (argv.length > 0 && (HEAD_VERSION.has(argv[0]!) || (argv.length > 1 && HEAD_VERSION.has(argv[1]!)))) {
    await exitAfter(process.stdout, `notionctl ${VERSION}\n`, 0);
  }

  const noun = argv[0]!;
  const verb = ["whoami", "resolve", "search", "api"].includes(noun) ? undefined : argv[1];
  // For grouped nouns (page, db, …), surface help when no verb is given so users
  // discover the available subcommands instead of seeing "Unknown verb: undefined".
  const NOUNS_WITH_VERBS = new Set(["page", "db", "block", "file", "comment", "user", "auth"]);
  if (NOUNS_WITH_VERBS.has(noun) && verb === undefined) {
    await exitAfter(process.stdout, printHelp(), 0);
  }
  // Strip a single `--help`/`-h` that appears anywhere in the remaining args
  // (e.g. `notionctl page get --help`) so subcommand help still works without
  // letting a buried `-v` after a `--format` argument hijack the version path.
  const restArgv = verb !== undefined ? argv.slice(2) : argv.slice(1);
  const helpIdx = restArgv.findIndex((a) => HEAD_HELP.has(a));
  if (helpIdx !== -1) {
    await exitAfter(process.stdout, printHelp(), 0);
  }
  const rest = restArgv;

  // Activate --verbose / --debug before dispatch. They stay in rest so
  // parseFlags inside each command can also see them (they're boolean flags).
  if (rest.includes("--verbose")) setVerboseMode(true);
  if (rest.includes("--debug")) setDebugMode(true);
  const quiet = rest.includes("--quiet");
  if (quiet) {
    setMarkdownWarnHandler(null);
    setTokenizerWarnHandler(null);
  }

  const handler = await loadCommand(noun, verb);
  const result = await handler({ args: rest });
  const { output, exitCode } = typeof result === "string" ? { output: result, exitCode: 0 } : result;
  if (output && output.length > 0) {
    await writeFlushed(process.stdout, output + (output.endsWith("\n") ? "" : "\n"));
  }
  if (getRequestCount() > 0 && isVerboseMode() && !quiet) {
    await writeFlushed(process.stderr, `notionctl: ${getRequestCount()} API request(s)\n`);
  }
  process.exit(exitCode);
}

/**
 * Single fatal-error exit path. Attached to main() rather than wrapped around
 * only the dispatch call so that failures raised while parsing global flags
 * (e.g. a malformed --profile) surface as a clean typed error with the right
 * exit code, instead of escaping as an unhandled rejection.
 */
async function fail(err: unknown): Promise<never> {
  if (err instanceof NotionCliError) {
    const color = isStdoutTty() && !process.argv.includes("--no-color");
    const message = !process.stdout.isTTY
      ? formatErrorJson(err)
      : formatErrorHuman(err, { color });
    return exitAfter(process.stderr, message + "\n", err.exitCode);
  }
  return exitAfter(process.stderr, `Internal error: ${scrub((err as Error).message)}\n`, 1);
}

main().catch(fail);
