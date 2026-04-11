import { notionRequest } from "../http.js";
import { markdownToRichText } from "../markdown/index.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson } from "../output.js";

export async function commentListCommand(ctx: { args: string[] }): Promise<string> {
  const { positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl comment list <page-id>");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("GET", `/comments?block_id=${encodeURIComponent(id)}`);
  return renderJson(res);
}

export async function commentAddCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl comment add <page-id> --text \"...\"");
  }
  const id = resolvePageId(positional[0]!);
  const text = flags.get("text");
  if (!text) {
    throw new NotionCliError(ErrorCode.USAGE, "comment add requires --text");
  }
  const payload = {
    parent: { page_id: id },
    rich_text: markdownToRichText(text),
  };
  if (getBooleanFlag(flags, "dry-run")) return renderJson({ action: "comment add", payload });
  const res = await notionRequest("POST", "/comments", payload);
  return renderJson(res);
}
