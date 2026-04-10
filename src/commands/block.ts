/**
 * Block commands for surgical edits. These bypass the markdown converter
 * for commands that want to poke at individual blocks by ID.
 */

import { notionRequest, appendBlocksChunked } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { fetchBlockTree } from "../blocks.js";
import { readFile } from "node:fs/promises";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function blockGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block get <id>");
  }
  const id = resolvePageId(positional[0]!);
  const block = await fetchWith404Hint(
    () => notionRequest("GET", `/blocks/${id}`),
    `Block ${id}`,
  );
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
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block children <id> [--recursive]");
  }
  const id = resolvePageId(positional[0]!);
  const recursive = getBooleanFlag(flags, "recursive");

  let children: Block[];
  if (recursive) {
    children = await fetchWith404Hint(
      () => fetchBlockTree(id, "all"),
      `Block ${id}`,
    );
  } else {
    const res = await fetchWith404Hint(
      () => notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`),
      `Block ${id}`,
    );
    children = res.results;
  }

  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") return renderJson({ results: children });
  return blocksToMarkdown(children);
}

export async function blockAppendCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block append <id> [--from file.md] [--after <block-id>]");
  }
  const id = resolvePageId(positional[0]!);
  const fromFile = flags.get("from");
  let md = "";
  if (fromFile && fromFile !== "-") {
    md = await readFile(fromFile, "utf8");
  } else if (fromFile === "-" || !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    md = await new Promise((resolve, reject) => {
      process.stdin.on("data", (c) => chunks.push(c));
      process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      process.stdin.on("error", reject);
    });
  }
  const blocks = markdownToBlocks(md);
  if (blocks.length === 0) {
    return renderJson({ action: "block append", id, blocks: [], warning: "no blocks parsed from input" });
  }
  const afterFlag = flags.get("after");
  const afterId = afterFlag ? resolvePageId(afterFlag) : undefined;

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block append", id, blocks, after: afterId ?? null });
  }
  const res = await appendBlocksChunked(id, blocks, { after: afterId });
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
