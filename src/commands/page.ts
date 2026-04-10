/**
 * Page commands: get, create, append, update, delete. The sync command
 * is in Task 29 to keep this file reviewable.
 *
 * page get outputs YAML front-matter (database page properties) plus
 * the body as Markdown. page create/append/update accept Markdown input
 * (from --from file or stdin) and convert to blocks.
 */

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extractFrontmatter, reinsertFrontmatter } from "../sync/frontmatter.js";
import { classifySyncState, computeContentHash, SyncState } from "../sync/sync.js";
import { notionRequest } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { renderProperty } from "../properties/render.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint } from "./shared.js";
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

  // Determine title from source
  const titleProp = sourcePage.properties.title as { title?: Array<{ plain_text?: string }> } | undefined;
  const sourceTitle = titleProp?.title?.map((t) => t.plain_text ?? "").join("") ?? "Untitled";
  const newTitle = flags.get("title") ?? `${sourceTitle} (copy)`;

  // Determine parent: --parent flag or same as source
  const parentFlag = flags.get("parent");
  let parentId: string;
  if (parentFlag) {
    parentId = resolvePageId(parentFlag);
  } else if (sourcePage.parent.page_id) {
    parentId = sourcePage.parent.page_id;
  } else {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Source page has no page parent (it may be a workspace root page). Specify --parent explicitly.",
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

  const payload = {
    parent: { page_id: parentId },
    properties: {
      title: [{ type: "text", text: { content: newTitle, link: null } }],
    },
    children,
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page duplicate", source: sourceId, title: newTitle, parent: parentId, blockCount: children.length });
  }

  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
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

  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";

  return new Promise((resolve, reject) => {
    execFile(opener, [url], (err) => {
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

  // Also check/update the page title
  let titleUpdated = false;
  const page = await notionRequest<{ properties: Record<string, unknown> }>("GET", `/pages/${id}`);
  const titleProp = page.properties.title as { title?: Array<{ plain_text?: string; text?: { content: string } }> } | undefined;
  const titleRuns = titleProp?.title;
  if (titleRuns) {
    for (const run of titleRuns) {
      if (run.text && run.text.content.includes(findStr)) {
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
  let matchCount = 0;
  let blockCount = 0;

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

  // Fetch remote page metadata for drift detection when notion_id exists
  let remoteEditedAt: string | undefined;
  if (typeof frontmatter.notion_id === "string" && frontmatter.notion_id) {
    try {
      const remotePage = await notionRequest<{ last_edited_time: string }>(
        "GET",
        `/pages/${frontmatter.notion_id as string}`,
      );
      remoteEditedAt = remotePage.last_edited_time;
    } catch {
      // If fetch fails (trashed page), proceed — the CHANGED path will give a better error
    }
  }

  const state = classifySyncState({ frontmatter, localBody: body, remoteEditedAt });

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ file, state, remoteEditedAt });
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
    frontmatter.notion_synced_at = new Date().toISOString();
    await writeFile(file, reinsertFrontmatter(frontmatter, body), "utf8");
    return renderJson({ file, state, createdId: created.id });
  }

  if (state === SyncState.CHANGED || state === SyncState.DRIFT) {
    const pageId = frontmatter.notion_id as string;
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
      if (!isPassThrough(b.type)) {
        await notionRequest("DELETE", `/blocks/${b.id}`);
      }
    }
    await notionRequest("PATCH", `/blocks/${pageId}/children`, { children: newBlocks });
    frontmatter.notion_hash = computeContentHash(body);
    frontmatter.notion_synced_at = new Date().toISOString();
    await writeFile(file, reinsertFrontmatter(frontmatter, body), "utf8");
    return renderJson({ file, state, updatedId: pageId });
  }

  throw new NotionCliError(ErrorCode.GENERIC, `Unexpected sync state: ${state as string}`);
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
