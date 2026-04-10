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

import { NotionCliError, ErrorCode, formatErrorJson, formatErrorHuman } from "./errors.js";
import { isStdoutTty } from "./output.js";

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
                throw new NotionCliError(ErrorCode.USAGE, `Unknown db row verb: ${sub}`);
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
        case "set": return mod.authSetCommand;
        case "status": return mod.authStatusCommand;
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

  notionctl page get <id> [--depth N]
  notionctl page create --parent <id> --title <text> [--from file.md]
  notionctl page append <id> [--from file.md]
  notionctl page update <id> [--from file.md]
  notionctl page sync <file.md> [--parent <id>]
  notionctl page delete <id> --yes

  notionctl db create --parent <page-id> --title <text> [--prop Name=type[:options] ...]
  notionctl db query <id> [--filter Key=value] [--sort Key:desc] [--filter-json @f.json]
  notionctl db schema <id>
  notionctl db row get <page-id>
  notionctl db row create <db-id> [--prop Key=value ...] [--from file.md]
  notionctl db row update <page-id> [--prop Key=value ...]
  notionctl db row delete <page-id> --yes

  notionctl block get <id>
  notionctl block children <id>
  notionctl block append <id> [--from file.md]
  notionctl block update <id> --prop-json '<json>'
  notionctl block delete <id> --yes

  notionctl comment list <page-id>
  notionctl comment add <page-id> --text "..."

  notionctl user list
  notionctl user me

  notionctl auth set
  notionctl auth status
  notionctl auth clear --yes

Global flags:
  --format md|json|table|csv   Output format (default depends on command + TTY)
  --dry-run                    Preview write operations without sending
  --verbose                    Show request counts (never bodies or tokens)
  --quiet                      Suppress non-essential output
  --no-color                   Force plain output
  --debug                      Full HTTP debug to stderr (scrubbed of token)
  --yes                        Confirm destructive operations

Environment:
  NOTION_TOKEN         Integration token (preferred)
  NOTION_TIMEOUT_MS    Request timeout (default 30000)
  XDG_CONFIG_HOME      Base dir for config file (default ~/.config)

See https://github.com/chazyua/notionctl for full documentation.
`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(printHelp());
    process.exit(0);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write("notionctl 0.1.1\n");
    process.exit(0);
  }

  const noun = argv[0]!;
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
    process.stderr.write(`Internal error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

main();
