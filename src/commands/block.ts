/**
 * Block commands for surgical edits. These bypass the markdown converter
 * for commands that want to poke at individual blocks by ID.
 */

import { notionRequest } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { readFile } from "node:fs/promises";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function blockGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block get <id>");
  }
  const id = resolvePageId(positional[0]!);
  const block = await notionRequest("GET", `/blocks/${id}`);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "json",
  });
  if (format === "md") return blocksToMarkdown([block as Block]);
  return renderJson(block);
}

export async function blockChildrenCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block children <id>");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") return renderJson(res);
  return blocksToMarkdown(res.results);
}

export async function blockAppendCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block append <id> [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const fromFile = flags.get("from");
  const md = fromFile ? await readFile(fromFile, "utf8") : "";
  const blocks = markdownToBlocks(md);
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block append", id, blocks });
  }
  const res = await notionRequest("PATCH", `/blocks/${id}/children`, { children: blocks });
  return renderJson(res);
}

export async function blockUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block update <id> --prop-json '<json>'");
  }
  const id = resolvePageId(positional[0]!);
  const propJson = flags.get("prop-json");
  if (!propJson) {
    throw new NotionCliError(ErrorCode.USAGE, "block update requires --prop-json '<raw Notion block shape>'");
  }
  let body: unknown;
  try {
    body = JSON.parse(propJson);
  } catch {
    throw new NotionCliError(ErrorCode.USAGE, `--prop-json is not valid JSON: ${propJson}`);
  }
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block update", id, body });
  }
  const res = await notionRequest("PATCH", `/blocks/${id}`, body);
  return renderJson(res);
}

export async function blockDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block delete <id> --yes");
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to delete without --yes");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("DELETE", `/blocks/${id}`);
  return renderJson(res);
}
