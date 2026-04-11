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

type CommandHandler = (ctx: { args: string[] }) => Promise<string>;

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
  --verbose                    Show request counts (not yet implemented)
  --quiet                      Suppress non-essential output
  --no-color                   Force plain output
  --debug                      Full HTTP debug to stderr (not yet implemented)
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

async function main(): Promise<void> {
  setMarkdownWarnHandler((msg) => process.stderr.write(msg + "\n"));
  setTokenizerWarnHandler((msg) => process.stderr.write(msg + "\n"));
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(printHelp());
    process.exit(0);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`notionctl ${VERSION}\n`);
    process.exit(0);
  }

  // Extract --profile before command parsing (it's a global flag)
  const profileIdx = argv.indexOf("--profile");
  if (profileIdx !== -1 && argv[profileIdx + 1]) {
    setActiveProfile(argv[profileIdx + 1]!);
    argv.splice(profileIdx, 2);
  }

  const noun = argv[0]!;

  // Handle --help and --version after a noun (e.g. "notionctl page --help")
  if (argv[1] === "--help" || argv[1] === "-h") {
    process.stdout.write(printHelp());
    process.exit(0);
  }
  if (argv[1] === "--version" || argv[1] === "-v") {
    process.stdout.write(`notionctl ${VERSION}\n`);
    process.exit(0);
  }

  const verb = ["whoami", "resolve", "search", "api"].includes(noun) ? undefined : argv[1];
  const rest = verb !== undefined ? argv.slice(2) : argv.slice(1);

  try {
    const handler = await loadCommand(noun, verb);
    const output = await handler({ args: rest });
    if (output && output.length > 0) {
      process.stdout.write(output + (output.endsWith("\n") ? "" : "\n"));
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof NotionCliError) {
      const color = isStdoutTty();
      if (!process.stdout.isTTY) {
        process.stderr.write(formatErrorJson(err) + "\n");
      } else {
        process.stderr.write(formatErrorHuman(err, { color }) + "\n");
      }
      process.exit(err.exitCode);
    }
    process.stderr.write(`Internal error: ${scrub((err as Error).message)}\n`);
    process.exit(1);
  }
}

main();
