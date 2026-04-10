/**
 * Page commands: get, create, append, update, delete. The sync command
 * is in Task 29 to keep this file reviewable.
 *
 * page get outputs YAML front-matter (database page properties) plus
 * the body as Markdown. page create/append/update accept Markdown input
 * (from --from file or stdin) and convert to blocks.
 */

import { readFile, writeFile } from "node:fs/promises";
import { extractFrontmatter, reinsertFrontmatter } from "../sync/frontmatter.js";
import { classifySyncState, computeContentHash, SyncState } from "../sync/sync.js";
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

  // Prepend # Title for non-database pages (BUG-1 fix)
  let titleLine = "";
  if (page.parent.type !== "database_id") {
    const titleProp = page.properties.title as { title?: Array<{ plain_text?: string }> } | undefined;
    const title = titleProp?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
    if (title) titleLine = `# ${title}\n\n`;
  }

  const body = blocksToMarkdown(children.results);
  const yaml = stringifyYaml(frontmatter);
  return `---\n${yaml}\n---\n\n${titleLine}${body}`;
}

async function readInputMarkdown(flags: Map<string, string>): Promise<string> {
  const fromFile = flags.get("from");
  // Support --from - as explicit stdin alias (BUG-3 fix)
  if (fromFile && fromFile !== "-") return readFile(fromFile, "utf8");
  // Read stdin
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

/** Strip YAML frontmatter from markdown so page get → page update/append round-trips cleanly */
function stripFrontmatter(md: string): string {
  return extractFrontmatter(md).body;
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
  let bodyMd = flags.get("from") ? await readInputMarkdown(flags) : "";
  // Strip leading H1 if it matches --title (prevents duplicate heading in page body)
  bodyMd = bodyMd.replace(/^# .+\n?/m, (match) =>
    match.trim().slice(2) === title ? "" : match
  ).trimStart();
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
  const bodyMd = stripFrontmatter(await readInputMarkdown(flags));
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
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page update <id> [--title <text>] [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const title = flags.get("title");
  const hasFrom = !!flags.get("from");

  if (!title && !hasFrom) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page update <id> [--title <text>] [--from file.md]\nProvide at least --title or --from.");
  }

  // Strip frontmatter and extract title from H1 when --from is used without --title
  let resolvedTitle = title;
  let newBlocks: ReturnType<typeof markdownToBlocks> | null = null;
  if (hasFrom) {
    const raw = stripFrontmatter(await readInputMarkdown(flags));
    const { title: h1Title, syncBody } = extractSyncTitle({}, raw);
    newBlocks = markdownToBlocks(syncBody);
    if (!resolvedTitle && h1Title !== "Untitled") resolvedTitle = h1Title;
  }

  if (getBooleanFlag(flags, "dry-run")) {
    const result: Record<string, unknown> = { action: "page update", pageId: id };
    if (resolvedTitle) result["title"] = resolvedTitle;
    if (newBlocks !== null) result["willReplaceBlocks"] = newBlocks.length;
    return renderJson(result);
  }

  const result: Record<string, unknown> = {};

  if (resolvedTitle) {
    await notionRequest("PATCH", `/pages/${id}`, {
      properties: { title: [{ type: "text", text: { content: resolvedTitle, link: null } }] },
    });
    result["title"] = resolvedTitle;
  }

  if (newBlocks !== null) {
    const existing = await notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`);
    const deletions = existing.results.filter((b) => !isPassThrough(b.type)).map((b) => b.id);
    for (const blockId of deletions) {
      await notionRequest("DELETE", `/blocks/${blockId}`);
    }
    await notionRequest("PATCH", `/blocks/${id}/children`, { children: newBlocks });
    result["deletedBlocks"] = deletions.length;
    result["appendedBlocks"] = newBlocks.length;
  }

  return renderJson(result);
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

function extractSyncTitle(
  frontmatter: Record<string, unknown>,
  body: string,
): { title: string; syncBody: string } {
  if (frontmatter.title) return { title: String(frontmatter.title), syncBody: body };
  const h1Match = /^# (.+)$/m.exec(body);
  if (h1Match) {
    const title = h1Match[1]!.trim();
    const syncBody = body.replace(/^# .+\n?/m, "").trimStart();
    return { title, syncBody };
  }
  return { title: "Untitled", syncBody: body };
}

export async function pageSyncCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page sync <file.md>");
  }
  const file = positional[0]!;
  const source = await readFile(file, "utf8");
  const { data: frontmatter, body } = extractFrontmatter(source);
  const state = classifySyncState({
    frontmatter,
    localBody: body,
    remoteEditedAt: undefined,
  });

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ file, state });
  }

  if (state === SyncState.UNCHANGED) {
    return renderJson({ file, state, message: "no changes to sync" });
  }

  if (state === SyncState.CREATE) {
    const parent = flags.get("parent");
    if (!parent) {
      throw new NotionCliError(
        ErrorCode.USAGE,
        "First sync of this file requires --parent <parent-page-id>",
      );
    }
    const { title, syncBody } = extractSyncTitle(frontmatter, body);
    const blocks = markdownToBlocks(syncBody);
    const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", {
      parent: { page_id: resolvePageId(parent) },
      properties: {
        title: [{ type: "text", text: { content: title, link: null } }],
      },
      children: blocks,
    });
    frontmatter.notion_id = created.id;
    frontmatter.notion_hash = computeContentHash(body);
    await writeFile(file, reinsertFrontmatter(frontmatter, body), "utf8");
    return renderJson({ file, state, createdId: created.id });
  }

  if (state === SyncState.CHANGED) {
    const pageId = frontmatter.notion_id as string;
    const { title, syncBody } = extractSyncTitle(frontmatter, body);
    const existing = await notionRequest<{ results: Block[] }>(
      "GET",
      `/blocks/${pageId}/children`,
    );
    const newBlocks = markdownToBlocks(syncBody);
    await notionRequest("PATCH", `/pages/${pageId}`, {
      properties: { title: [{ type: "text", text: { content: title, link: null } }] },
    });
    for (const b of existing.results) {
      if (!isPassThrough(b.type)) {
        await notionRequest("DELETE", `/blocks/${b.id}`);
      }
    }
    await notionRequest("PATCH", `/blocks/${pageId}/children`, { children: newBlocks });
    frontmatter.notion_hash = computeContentHash(body);
    await writeFile(file, reinsertFrontmatter(frontmatter, body), "utf8");
    return renderJson({ file, state, updatedId: pageId });
  }

  throw new NotionCliError(ErrorCode.SYNC_DRIFT, "Remote drift detection not implemented in V1");
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
