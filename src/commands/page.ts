/**
 * Page commands: get, create, append, update, delete. The sync command
 * is in Task 29 to keep this file reviewable.
 *
 * page get outputs YAML front-matter (database page properties) plus
 * the body as Markdown. page create/append/update accept Markdown input
 * (from --from file or stdin) and convert to blocks.
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { extractFrontmatter, reinsertFrontmatter } from "../sync/frontmatter.js";
import { classifySyncState, computeContentHash, SyncState } from "../sync/sync.js";
import { notionRequest, appendBlocksChunked } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { renderProperty } from "../properties/render.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint, readStdinBounded } from "./shared.js";
import { fetchBlockTree } from "../blocks.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function pageGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page get <id>");
  }
  const id = resolvePageId(positional[0]!);

  const page = await fetchWith404Hint(
    () => notionRequest<{
      id: string;
      object: string;
      properties: Record<string, unknown>;
      parent: { type: string };
      url: string;
    }>("GET", `/pages/${id}`),
    `Page ${id}`,
  );

  const childBlocks = await fetchBlockTree(id);

  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") {
    return renderJson({ page, children: childBlocks });
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

  const body = blocksToMarkdown(childBlocks);
  const yaml = stringifyYaml(frontmatter);
  return `---\n${yaml}\n---\n\n${titleLine}${body}`;
}

async function readInputMarkdown(flags: Map<string, string>): Promise<string> {
  const fromFile = flags.get("from");
  // Support --from - as explicit stdin alias (BUG-3 fix)
  if (fromFile && fromFile !== "-") return readFile(fromFile, "utf8");
  if (fromFile === "-" || !process.stdin.isTTY) return readStdinBounded();
  return "";
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

  // Detect whether parent is a database or page
  let parentKey: "page_id" | "database_id" = "page_id";
  try {
    await notionRequest("GET", `/databases/${parentId}`);
    parentKey = "database_id";
  } catch {
    // Not a database — use page_id (the default)
  }

  let bodyMd = stripFrontmatter(await readInputMarkdown(flags));
  // Strip leading H1 if it matches --title (prevents duplicate heading in page body)
  bodyMd = bodyMd.replace(/^# .+\n?/m, (match) =>
    match.trim().slice(2) === title ? "" : match
  ).trimStart();
  const blocks = bodyMd.length > 0 ? markdownToBlocks(bodyMd) : [];

  const firstChunk = blocks.slice(0, 100);
  const overflow = blocks.slice(100);

  const titleProp = parentKey === "database_id"
    ? { Name: { title: [{ type: "text", text: { content: title, link: null } }] } }
    : { title: [{ type: "text", text: { content: title, link: null } }] };

  const payload = {
    parent: { [parentKey]: parentId },
    properties: titleProp,
    children: firstChunk,
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page create", payload: { ...payload, children: blocks } });
  }

  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
  if (overflow.length > 0) {
    await appendBlocksChunked(created.id, overflow);
  }
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

  if (blocks.length === 0) {
    return renderJson({ action: "page append", blockId: id, blocks: [], warning: "no blocks parsed from input" });
  }

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page append", blockId: id, blocks });
  }

  const res = await appendBlocksChunked(id, blocks);
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
    for (const b of existing.results) {
      await notionRequest("DELETE", `/blocks/${b.id}`);
    }
    await appendBlocksChunked(id, newBlocks);
    result["deletedBlocks"] = existing.results.length;
    result["appendedBlocks"] = newBlocks.length;
  }

  return renderJson(result);
}

export async function pageDuplicateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl page duplicate <page-id> [--parent <new-parent-id>] [--title <new-title>]",
    );
  }
  const sourceId = resolvePageId(positional[0]!);

  const sourcePage = await fetchWith404Hint(
    () => notionRequest<{
      id: string;
      properties: Record<string, unknown>;
      parent: { type: string; page_id?: string; database_id?: string };
    }>("GET", `/pages/${sourceId}`),
    `Source page ${sourceId}`,
  );
  const sourceBlocks = await fetchBlockTree(sourceId);

  // Determine title from source — find the property with type "title"
  // (for DB rows this is the Name column, not a literal "title" key)
  let sourceTitle = "Untitled";
  for (const value of Object.values(sourcePage.properties)) {
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop.type === "title" && prop.title) {
      sourceTitle = prop.title.map((t) => t.plain_text ?? "").join("") || "Untitled";
      break;
    }
  }
  const newTitle = flags.get("title") ?? `${sourceTitle} (copy)`;

  // Determine parent: --parent flag or same as source
  const parentFlag = flags.get("parent");
  let parentKey: "page_id" | "database_id";
  let parentId: string;
  if (parentFlag) {
    parentId = resolvePageId(parentFlag);
    // Detect whether the parent is a database or page
    try {
      await notionRequest("GET", `/databases/${parentId}`);
      parentKey = "database_id";
    } catch {
      parentKey = "page_id";
    }
  } else if (sourcePage.parent.database_id) {
    parentId = sourcePage.parent.database_id;
    parentKey = "database_id";
  } else if (sourcePage.parent.page_id) {
    parentId = sourcePage.parent.page_id;
    parentKey = "page_id";
  } else {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Source page has no page or database parent (workspace root). Specify --parent explicitly.",
    );
  }

  // Strip API-only fields and null values so blocks are valid for creation
  const sanitizeForCreate = (blocks: Block[]): unknown[] => {
    return blocks.map((b) => {
      const typeKey = b.type;
      const typeData = (b as any)[typeKey];
      if (!typeData) return { object: "block", type: typeKey };
      // Deep-clone the type data and strip null values
      const cleaned = JSON.parse(JSON.stringify(typeData, (_k, v) => v === null ? undefined : v));
      const nested = (b as any)._children as Block[] | undefined;
      if (nested && nested.length > 0) {
        cleaned.children = sanitizeForCreate(nested);
      }
      return { object: "block", type: typeKey, [typeKey]: cleaned };
    });
  };

  const children = sanitizeForCreate(sourceBlocks);
  const firstChunk = children.slice(0, 100);
  const overflow = children.slice(100);

  // Build properties — for DB rows, copy all writable properties from source
  const READ_ONLY_TYPES = new Set(["formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by", "unique_id"]);
  let properties: Record<string, unknown>;
  if (parentKey === "database_id") {
    properties = {};
    for (const [name, value] of Object.entries(sourcePage.properties)) {
      const prop = value as { type?: string };
      if (prop.type && !READ_ONLY_TYPES.has(prop.type)) {
        properties[name] = value;
      }
    }
    // Always override the title property with newTitle (includes "(copy)" suffix by default)
    for (const [name, value] of Object.entries(properties)) {
      const prop = value as { type?: string };
      if (prop.type === "title") {
        properties[name] = { title: [{ type: "text", text: { content: newTitle, link: null } }] };
        break;
      }
    }
  } else {
    properties = {
      title: [{ type: "text", text: { content: newTitle, link: null } }],
    };
  }

  const payload = {
    parent: { [parentKey]: parentId },
    properties,
    children: firstChunk,
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page duplicate", source: sourceId, title: newTitle, parent: parentId, blockCount: children.length });
  }

  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
  if (overflow.length > 0) {
    await appendBlocksChunked(created.id, overflow);
  }
  return renderJson({ id: created.id, url: created.url, copiedFrom: sourceId });
}

export async function pageMoveCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl page move <page-id> --to <new-parent-page-id>",
    );
  }
  const id = resolvePageId(positional[0]!);
  const to = flags.get("to");
  if (!to) {
    throw new NotionCliError(ErrorCode.USAGE, "page move requires --to <new-parent-page-id>");
  }
  const toId = resolvePageId(to);

  const body = { parent: { page_id: toId } };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page move", pageId: id, body });
  }

  const res = await fetchWith404Hint(
    () => notionRequest<{ id: string; parent: unknown; url: string }>(
      "POST",
      `/pages/${id}/move`,
      body,
    ),
    `Page ${id}`,
  );
  return renderJson({ id: res.id, parent: res.parent, url: res.url });
}

export async function pageOpenCommand(ctx: { args: string[] }): Promise<string> {
  const { positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page open <id-or-url>");
  }
  const id = resolvePageId(positional[0]!);
  const page = await fetchWith404Hint(
    () => notionRequest<{ url: string }>("GET", `/pages/${id}`),
    `Page ${id}`,
  );
  const url = page.url;

  // Only open known-safe Notion URLs — reject file://, data:, javascript:, etc.
  if (!/^https:\/\/(www\.)?notion\.so\//.test(url)) {
    throw new NotionCliError(ErrorCode.GENERIC, `Refusing to open non-Notion URL: ${url}`);
  }

  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const openerArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolve, reject) => {
    execFile(opener, openerArgs, (err) => {
      if (err) reject(new NotionCliError(ErrorCode.GENERIC, `Failed to open browser: ${err.message}`));
      else resolve(url);
    });
  });
}

/** Block types that carry rich_text content suitable for find-replace. */
const RICH_TEXT_BLOCK_TYPES: Record<string, string> = {
  paragraph: "paragraph",
  heading_1: "heading_1",
  heading_2: "heading_2",
  heading_3: "heading_3",
  bulleted_list_item: "bulleted_list_item",
  numbered_list_item: "numbered_list_item",
  to_do: "to_do",
  quote: "quote",
  callout: "callout",
  toggle: "toggle",
};

export async function pageFindReplaceCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl page find-replace <id> --find <text> --replace <text>",
    );
  }
  const id = resolvePageId(positional[0]!);
  const findStr = flags.get("find");
  const replaceStr = flags.get("replace");
  if (!findStr) throw new NotionCliError(ErrorCode.USAGE, "Missing --find <text>");
  if (replaceStr === undefined) throw new NotionCliError(ErrorCode.USAGE, "Missing --replace <text>");

  let matchCount = 0;
  let blockCount = 0;

  // Also check/update the page title
  let titleUpdated = false;
  const page = await notionRequest<{ properties: Record<string, unknown> }>("GET", `/pages/${id}`);
  const titleProp = page.properties.title as { title?: Array<{ plain_text?: string; text?: { content: string } }> } | undefined;
  const titleRuns = titleProp?.title;
  if (titleRuns) {
    for (const run of titleRuns) {
      if (run.text && run.text.content.includes(findStr)) {
        const count = run.text.content.split(findStr).length - 1;
        matchCount += count;
        run.text.content = run.text.content.replaceAll(findStr, replaceStr);
        run.plain_text = run.text.content;
        titleUpdated = true;
      }
    }
    if (titleUpdated && !getBooleanFlag(flags, "dry-run")) {
      await notionRequest("PATCH", `/pages/${id}`, {
        properties: { title: titleRuns },
      });
    }
  }

  const blocks = await fetchBlockTree(id);

  const processBlocks = async (blks: Block[]): Promise<void> => {
    for (const block of blks) {
      const typeKey = RICH_TEXT_BLOCK_TYPES[block.type];
      if (!typeKey) continue;
      const typeData = (block as any)[typeKey];
      const richText = typeData?.rich_text as Array<{ type: string; text?: { content: string }; plain_text: string }> | undefined;
      if (!richText) continue;

      let blockModified = false;
      for (const run of richText) {
        if (run.type === "text" && run.text && run.text.content.includes(findStr)) {
          const count = run.text.content.split(findStr).length - 1;
          run.text.content = run.text.content.replaceAll(findStr, replaceStr);
          run.plain_text = run.text.content;
          matchCount += count;
          blockModified = true;
        }
      }

      if (blockModified) {
        if (!getBooleanFlag(flags, "dry-run")) {
          await notionRequest("PATCH", `/blocks/${block.id}`, {
            [typeKey]: { rich_text: richText },
          });
        }
        blockCount++;
      }

      // Recurse into nested children
      const nested = (block as any)._children as Block[] | undefined;
      if (nested) await processBlocks(nested);
    }
  };

  await processBlocks(blocks);

  return renderJson({
    action: "find-replace",
    find: findStr,
    replace: replaceStr,
    matchCount,
    blocksModified: blockCount,
    titleUpdated,
    dryRun: getBooleanFlag(flags, "dry-run"),
  });
}

export async function pageRestoreCommand(ctx: { args: string[] }): Promise<string> {
  const { positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page restore <id>");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest<{ id: string; url: string }>("PATCH", `/pages/${id}`, { archived: false });
  return renderJson({ id: res.id, url: res.url, restored: true });
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

export function extractSyncTitle(
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

async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export async function pageSyncCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page sync <file.md>");
  }
  const file = resolve(positional[0]!);
  const cwd = process.cwd();
  const cwdPrefix = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (file !== cwd && !file.startsWith(cwdPrefix)) {
    throw new NotionCliError(ErrorCode.USAGE, `Refusing to sync file outside working directory: ${file}`);
  }
  const source = await readFile(file, "utf8");
  const { data: frontmatter, body } = extractFrontmatter(source);

  // Fetch remote page metadata for drift detection when notion_id exists
  let remoteEditedAt: string | undefined;
  let validatedNotionId: string | undefined;
  if (typeof frontmatter.notion_id === "string" && frontmatter.notion_id) {
    validatedNotionId = resolvePageId(frontmatter.notion_id);
    try {
      const remotePage = await notionRequest<{ last_edited_time: string }>(
        "GET",
        `/pages/${validatedNotionId}`,
      );
      remoteEditedAt = remotePage.last_edited_time;
    } catch {
      // If fetch fails (trashed page), proceed — the CHANGED path will give a better error
    }
  }

  const state = classifySyncState({ frontmatter, localBody: body, remoteEditedAt });

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({
      file,
      state,
      ...(state === SyncState.UNCHANGED ? { message: "no changes to sync" } : {}),
      remoteEditedAt,
    });
  }

  if (state === SyncState.UNCHANGED) {
    return renderJson({ file, state, message: "no changes to sync" });
  }

  if (state === SyncState.DRIFT && !getBooleanFlag(flags, "force")) {
    throw new NotionCliError(
      ErrorCode.SYNC_DRIFT,
      `Remote page was edited in Notion after your last sync — refusing to overwrite.`,
      {
        suggestions: [
          "Run: notionctl page get <id> to fetch the latest remote content.",
          "Merge remote changes into your local file, then run sync again.",
          "Or use --force to overwrite remote with your local version.",
        ],
      },
    );
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
    const parentId = resolvePageId(parent);
    // Detect whether parent is a database or page (same as pageCreateCommand)
    let parentKey: "page_id" | "database_id" = "page_id";
    try {
      await notionRequest("GET", `/databases/${parentId}`);
      parentKey = "database_id";
    } catch {
      // Not a database — use page_id
    }
    const titleProp = parentKey === "database_id"
      ? { Name: { title: [{ type: "text", text: { content: title, link: null } }] } }
      : { title: [{ type: "text", text: { content: title, link: null } }] };
    const blocks = markdownToBlocks(syncBody);
    const firstChunk = blocks.slice(0, 100);
    const overflow = blocks.slice(100);
    const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", {
      parent: { [parentKey]: parentId },
      properties: titleProp,
      children: firstChunk,
    });
    if (overflow.length > 0) {
      await appendBlocksChunked(created.id, overflow);
    }
    frontmatter.notion_id = created.id;
    frontmatter.notion_hash = computeContentHash(body);
    frontmatter.notion_synced_at = new Date().toISOString();
    await atomicWriteFile(file, reinsertFrontmatter(frontmatter, body));
    return renderJson({ file, state, createdId: created.id });
  }

  if (state === SyncState.CHANGED || state === SyncState.DRIFT) {
    const pageId = validatedNotionId!;
    const { title, syncBody } = extractSyncTitle(frontmatter, body);
    let existing: { results: Block[] };
    try {
      existing = await notionRequest<{ results: Block[] }>("GET", `/blocks/${pageId}/children`);
    } catch (err) {
      if (err instanceof NotionCliError && err.code === ErrorCode.NOT_FOUND) {
        throw new NotionCliError(
          ErrorCode.NOT_FOUND,
          `Page ${pageId} was not found — it may have been trashed in Notion.`,
          { suggestions: ["Remove notion_id from the file's YAML frontmatter and sync again to recreate it."] },
        );
      }
      throw err;
    }
    const newBlocks = markdownToBlocks(syncBody);
    await notionRequest("PATCH", `/pages/${pageId}`, {
      properties: { title: [{ type: "text", text: { content: title, link: null } }] },
    });
    for (const b of existing.results) {
      await notionRequest("DELETE", `/blocks/${b.id}`);
    }
    await appendBlocksChunked(pageId, newBlocks);
    frontmatter.notion_hash = computeContentHash(body);
    frontmatter.notion_synced_at = new Date().toISOString();
    await atomicWriteFile(file, reinsertFrontmatter(frontmatter, body));
    return renderJson({ file, state, updatedId: pageId });
  }

  throw new NotionCliError(ErrorCode.GENERIC, `Unexpected sync state: ${state as string}`);
}

