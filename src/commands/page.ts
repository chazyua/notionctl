/**
 * Page commands: get, create, append, update, delete. The sync command
 * is in Task 29 to keep this file reviewable.
 *
 * page get outputs YAML front-matter (database page properties) plus
 * the body as Markdown. page create/append/update accept Markdown input
 * (from --from file or stdin) and convert to blocks.
 */

import { readFile } from "node:fs/promises";
import { notionRequest } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { renderProperty } from "../properties/render.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function pageGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page get <id>");
  }
  const id = resolvePageId(positional[0]!);

  const page = await notionRequest<{
    id: string;
    object: string;
    properties: Record<string, unknown>;
    parent: { type: string };
    url: string;
  }>("GET", `/pages/${id}`);

  const children = await notionRequest<{ results: Block[] }>(
    "GET",
    `/blocks/${id}/children`,
  );

  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") {
    return renderJson({ page, children: children.results });
  }

  const frontmatter: YamlObject = {
    notion_id: page.id,
  };
  if (page.parent.type === "database_id") {
    for (const [name, value] of Object.entries(page.properties)) {
      const rendered = renderProperty(value);
      if (rendered !== null && rendered !== undefined) {
        frontmatter[name] = rendered;
      }
    }
  }

  const body = blocksToMarkdown(children.results);
  const yaml = stringifyYaml(frontmatter);
  return `---\n${yaml}\n---\n\n${body}`;
}

async function readInputMarkdown(flags: Map<string, string>): Promise<string> {
  const fromFile = flags.get("from");
  if (fromFile) return readFile(fromFile, "utf8");
  // Read stdin
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

export async function pageCreateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const parent = flags.get("parent");
  const title = flags.get("title");
  if (!parent || !title) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl page create --parent <id> --title <text> [--from file.md]",
    );
  }
  const parentId = resolvePageId(parent);
  const bodyMd = flags.get("from") ? await readInputMarkdown(flags) : "";
  const blocks = bodyMd.length > 0 ? markdownToBlocks(bodyMd) : [];

  const payload = {
    parent: { page_id: parentId },
    properties: {
      title: [{ type: "text", text: { content: title, link: null } }],
    },
    children: blocks,
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page create", payload });
  }

  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
  return renderJson({ id: created.id, url: created.url });
}

export async function pageAppendCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page append <id> [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const bodyMd = await readInputMarkdown(flags);
  const blocks = markdownToBlocks(bodyMd);

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page append", blockId: id, blocks });
  }

  const res = await notionRequest("PATCH", `/blocks/${id}/children`, { children: blocks });
  return renderJson(res);
}

export async function pageUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page update <id> [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const bodyMd = await readInputMarkdown(flags);
  const newBlocks = markdownToBlocks(bodyMd);

  // Fetch existing, delete non-pass-through, append new
  const existing = await notionRequest<{ results: Block[] }>(
    "GET",
    `/blocks/${id}/children`,
  );

  const deletions = existing.results
    .filter((b) => !isPassThrough(b.type))
    .map((b) => b.id);

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({
      action: "page update",
      pageId: id,
      willDelete: deletions,
      willAppend: newBlocks.length,
    });
  }

  for (const blockId of deletions) {
    await notionRequest("DELETE", `/blocks/${blockId}`);
  }
  const appended = await notionRequest("PATCH", `/blocks/${id}/children`, { children: newBlocks });
  return renderJson({ deleted: deletions.length, appended });
}

export async function pageDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page delete <id> --yes");
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Refusing to archive without --yes confirmation",
    );
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("PATCH", `/pages/${id}`, { archived: true });
  return renderJson(res);
}

const PASS_THROUGH_TYPES = new Set([
  "synced_block",
  "column_list",
  "column",
  "embed",
  "table_of_contents",
  "breadcrumb",
]);

function isPassThrough(type: string): boolean {
  return PASS_THROUGH_TYPES.has(type);
}
