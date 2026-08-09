/**
 * Block commands for surgical edits. These bypass the markdown converter
 * for commands that want to poke at individual blocks by ID.
 */

import { notionRequest, appendBlocksChunked } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { fetchBlockTree } from "../blocks.js";
import { frontmatterBody } from "../sync/frontmatter.js";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint, parseJsonObject, readStdinBounded, readFileText, rejectExtraPositionals } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function blockGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block get <id>");
  }
  rejectExtraPositionals(positional, 1);
  const id = resolvePageId(positional[0]!);
  const block = await fetchWith404Hint(
    () => notionRequest("GET", `/blocks/${id}`),
    `Block ${id}`,
  );
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "json",
  });
  if (format === "md") {
    // A single-block GET never inlines children. For container blocks whose
    // content lives entirely in their children — a table is the sharp case,
    // it renders to the empty string — that silently looked like an empty
    // block. Fetch the subtree so the markdown reflects what is actually there.
    const b = block as Block;
    if ((b as { has_children?: boolean }).has_children) {
      const tree = await fetchWith404Hint(() => fetchBlockTree(id, "all"), `Block ${id}`);
      return blocksToMarkdown([{ ...b, _children: tree } as Block]);
    }
    return blocksToMarkdown([b]);
  }
  if (format !== "json") {
    throw new NotionCliError(ErrorCode.USAGE, `block get does not support --format ${format}. Use json or md.`);
  }
  return renderJson(block);
}

export async function blockChildrenCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block children <id> [--recursive]");
  }
  rejectExtraPositionals(positional, 1);
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
  if (format !== "md") {
    throw new NotionCliError(ErrorCode.USAGE, `block children does not support --format ${format}. Use json or md.`);
  }
  return blocksToMarkdown(children);
}

export async function blockAppendCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block append <id> [--from file.md] [--after <block-id>]");
  }
  rejectExtraPositionals(positional, 1);
  const id = resolvePageId(positional[0]!);
  const fromFile = flags.get("from");
  // Additive commands (append) auto-read piped stdin without requiring
  // --from, unlike destructive-replacement commands (page update) which
  // require explicit --from to prevent accidental content deletion.
  let md = "";
  if (fromFile && fromFile !== "-") {
    md = await readFileText(fromFile, "input markdown");
  } else if (fromFile === "-" || !process.stdin.isTTY) {
    md = await readStdinBounded();
  }
  const body = frontmatterBody(md, fromFile && fromFile !== "-" ? fromFile : "the input read from stdin");
  const blocks = markdownToBlocks(body);
  if (blocks.length === 0) {
    return renderJson({ action: "block append", id, blocks: [], warning: "no blocks parsed from input" });
  }
  const afterFlag = flags.get("after");
  const afterId = afterFlag ? resolvePageId(afterFlag) : undefined;

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block append", id, blocks, after: afterId ?? null });
  }
  const res = await fetchWith404Hint(
    () => appendBlocksChunked(id, blocks, { after: afterId }),
    `Block ${id}`,
  );
  return renderJson(res);
}

export async function blockUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block update <id> --prop-json '<json>'");
  }
  rejectExtraPositionals(positional, 1);
  const id = resolvePageId(positional[0]!);
  const propJson = flags.get("prop-json");
  if (!propJson) {
    throw new NotionCliError(ErrorCode.USAGE, "block update requires --prop-json '<raw Notion block shape>'");
  }
  const body = parseJsonObject(propJson, "--prop-json");
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
  rejectExtraPositionals(positional, 1);
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to delete without --yes");
  }
  const id = resolvePageId(positional[0]!);
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block delete", id });
  }
  const res = await notionRequest("DELETE", `/blocks/${id}`);
  return renderJson(res);
}
