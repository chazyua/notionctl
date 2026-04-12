/**
 * Page commands: get, create, append, update, delete. The sync command
 * is in Task 29 to keep this file reviewable.
 *
 * page get outputs YAML front-matter (database page properties) plus
 * the body as Markdown. page create/append/update accept Markdown input
 * (from --from file or stdin) and convert to blocks.
 */

import { writeFile, rename, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { extractFrontmatter, reinsertFrontmatter } from "../sync/frontmatter.js";
import { classifySyncState, computeContentHash, SyncState } from "../sync/sync.js";
import { notionRequest, appendBlocksChunked } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { renderProperty } from "../properties/render.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { resolvePageId, parseFlags, getBooleanFlag, fetchWith404Hint, readStdinBounded, readFileText } from "./shared.js";
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
  if (format !== "md") {
    throw new NotionCliError(ErrorCode.USAGE, `page get does not support --format ${format}. Use md or json.`);
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

/**
 * Detect whether the given id points at a database or a page. Notion
 * returns NOT_FOUND for missing ids and an API_ERROR like "is a page,
 * not a database" when the id belongs to a page — both are valid
 * fall-backs to page_id. Auth / network / 5xx errors propagate so
 * callers see the real failure instead of a mysterious wrong-parent
 * rejection later.
 */
async function detectParentKey(parentId: string): Promise<"page_id" | "database_id"> {
  try {
    await notionRequest("GET", `/databases/${parentId}`);
    return "database_id";
  } catch (err) {
    if (err instanceof NotionCliError) {
      if (err.code === ErrorCode.NOT_FOUND) return "page_id";
      if (err.code === ErrorCode.API_ERROR && /not a database|is a page/i.test(err.message)) {
        return "page_id";
      }
    }
    throw err;
  }
}

async function readInputMarkdown(flags: Map<string, string>): Promise<string> {
  const fromFile = flags.get("from");
  // Support --from - as explicit stdin alias (BUG-3 fix)
  if (fromFile && fromFile !== "-") return readFileText(fromFile, "input markdown");
  if (fromFile === "-" || !process.stdin.isTTY) return readStdinBounded();
  return "";
}

/** Strip YAML frontmatter from markdown so page get → page update/append round-trips cleanly */
function stripFrontmatter(md: string): string {
  return extractFrontmatter(md).body;
}

/**
 * Remove a leading `# <title>` line from a markdown body when it matches the
 * page's title. Only inspects the very first non-blank line — later H1s are
 * preserved, even if they happen to match. Keeps page-create output from
 * showing the title twice while staying out of the way of multi-section docs.
 */
export function stripLeadingTitleHeading(body: string, title: string): string {
  const lines = body.split("\n");
  let firstNonBlank = 0;
  while (firstNonBlank < lines.length && lines[firstNonBlank]!.trim() === "") firstNonBlank++;
  if (firstNonBlank >= lines.length) return body;
  const first = lines[firstNonBlank]!;
  const headingMatch = /^#\s+(.+?)\s*$/.exec(first);
  if (!headingMatch) return body;
  if (headingMatch[1] !== title) return body;
  const remaining = lines.slice(firstNonBlank + 1).join("\n");
  return remaining.replace(/^[\n\r]+/, "");
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

  const parentKey = await detectParentKey(parentId);

  let bodyMd = stripFrontmatter(await readInputMarkdown(flags));
  bodyMd = stripLeadingTitleHeading(bodyMd, title);
  const blocks = bodyMd.length > 0 ? markdownToBlocks(bodyMd) : [];

  const firstChunk = blocks.slice(0, 100);
  const overflow = blocks.slice(100);

  // For both regular pages and DB rows, the title property id is always
  // `title`, so keying the PATCH by that id works even when the user
  // renamed their title column to something other than the default. For
  // non-DB pages we use the bare `title:` shorthand the API accepts at
  // the page level.
  const titleProp = parentKey === "database_id"
    ? { title: { title: [{ type: "text", text: { content: title, link: null } }] } }
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

  // Strip frontmatter and extract title from H1 when --from is used without
  // --title. We use the same semantics as `page create`: only strip the
  // leading H1 if it matches the explicit title; otherwise leave the body
  // alone so an unrelated H1 isn't silently dropped from the user's content.
  let resolvedTitle = title;
  let newBlocks: ReturnType<typeof markdownToBlocks> | null = null;
  if (hasFrom) {
    const raw = stripFrontmatter(await readInputMarkdown(flags));
    let bodyForBlocks = raw;
    if (!resolvedTitle) {
      // No explicit --title: use the leading H1 as the new title and strip
      // it from the body so it isn't duplicated.
      const { title: h1Title, syncBody } = extractSyncTitle({}, raw);
      if (h1Title !== "Untitled") {
        resolvedTitle = h1Title;
        bodyForBlocks = syncBody;
      }
    } else {
      // --title is explicit: only strip a leading H1 if it matches the
      // chosen title (same rule as `page create`).
      bodyForBlocks = stripLeadingTitleHeading(raw, resolvedTitle);
    }
    newBlocks = markdownToBlocks(bodyForBlocks);
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
      properties: { title: { title: [{ type: "text", text: { content: resolvedTitle, link: null } }] } },
    });
    result["title"] = resolvedTitle;
  }

  if (newBlocks !== null) {
    const existing = await notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`);
    // Warn loudly if we're about to delete Notion-hosted media blocks that
    // cannot be recreated from the markdown representation. The user either
    // re-uploads the files themselves or uses `page append` for additive
    // changes that don't rewrite the page.
    // Note: only top-level hosted media blocks are detected; nested blocks
    // (inside toggles, callouts, columns) are deleted without this warning.
    const hostedMedia = existing.results.filter((b) => {
      const t = b.type;
      if (t !== "image" && t !== "video" && t !== "file" && t !== "pdf") return false;
      const media = (b as any)[t];
      if (!media) return false;
      return media.type === "file" || media.type === "file_upload";
    });
    if (hostedMedia.length > 0) {
      process.stderr.write(
        `notionctl: page update will DELETE ${hostedMedia.length} Notion-hosted media block(s) (uploaded files/images/videos/pdfs). These cannot be recreated from markdown and will need to be re-uploaded manually. Use 'notionctl file upload' after the update, or use 'page append' for additive edits that preserve existing attachments.\n`,
      );
    }
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
    parentKey = await detectParentKey(parentId);
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

  // Block types that cannot be recreated via the public blocks API from a
  // duplication. We filter them out of the duplicate with a warning so the
  // copy still succeeds for the rest of the content.
  const UNCOPYABLE_TYPES = new Set([
    "child_page", "child_database", "synced_block", "column_list", "column",
    "table_of_contents", "breadcrumb", "unsupported",
  ]);
  const MEDIA_TYPES = new Set(["image", "video", "file", "pdf"]);
  let droppedBlocks = 0;
  let skippedUploadedFiles = 0;

  // Strip API-only fields and null values so blocks are valid for creation
  const sanitizeForCreate = (blocks: Block[]): unknown[] => {
    const out: unknown[] = [];
    for (const b of blocks) {
      const typeKey = b.type;
      if (UNCOPYABLE_TYPES.has(typeKey)) {
        droppedBlocks++;
        continue;
      }
      const typeData = (b as any)[typeKey];
      if (!typeData) {
        droppedBlocks++;
        continue;
      }
      // Media blocks with a Notion-hosted `file` source carry a short-lived
      // signed URL that Notion's API cannot ingest as an `external` URL on a
      // new block (the S3 fetch fails silently and the block ends up with no
      // URL). Re-uploading would require downloading then re-posting the
      // bytes, which is out of scope here, so we drop these blocks with a
      // warning and let the rest of the duplicate succeed.
      if (MEDIA_TYPES.has(typeKey) && typeData && typeof typeData === "object"
        && typeData.type === "file") {
        skippedUploadedFiles++;
        continue;
      }
      // Deep-clone the type data and strip null values
      const cleaned = JSON.parse(JSON.stringify(typeData, (_k, v) => v === null ? undefined : v));
      const nested = (b as any)._children as Block[] | undefined;
      if (nested && nested.length > 0) {
        cleaned.children = sanitizeForCreate(nested);
      }
      out.push({ object: "block", type: typeKey, [typeKey]: cleaned });
    }
    return out;
  };

  const children = sanitizeForCreate(sourceBlocks);
  if (droppedBlocks > 0) {
    process.stderr.write(
      `notionctl: skipped ${droppedBlocks} block(s) in duplicate — types like child_page, synced_block, column_list cannot be recreated via the API.\n`,
    );
  }
  if (skippedUploadedFiles > 0) {
    process.stderr.write(
      `notionctl: skipped ${skippedUploadedFiles} uploaded-file block(s) in duplicate — Notion-hosted files cannot be referenced from a new page via signed URL; re-upload manually in the copy if needed.\n`,
    );
  }
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

  const parentKey = await detectParentKey(toId);
  const body = { parent: { [parentKey]: toId } };

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

interface RichRun {
  type: string;
  text?: { content: string; link?: unknown };
  plain_text: string;
  annotations?: unknown;
  href?: unknown;
}

/**
 * Find and replace across rich-text runs, including matches that span
 * run boundaries (e.g. "**bold tar**get" where "target" crosses runs).
 * Replacement text inherits annotations from the run containing the
 * match start — partial annotation loss is unavoidable when spans cross
 * formatting boundaries, so we pick a consistent rule.
 *
 * Equation and mention runs act as boundaries: they are passed through
 * unchanged, and matches cannot cross them. This prevents the replacement
 * from rewriting an equation's expression or a mention's referenced ID
 * into a plain-text run and losing the original data.
 *
 * Exported for unit testing. Production callers use pageFindReplaceCommand.
 */
export function replaceInRichText(
  runs: RichRun[],
  findStr: string,
  replaceStr: string,
): { newRuns: RichRun[]; count: number } {
  if (findStr.length === 0) return { newRuns: runs, count: 0 };
  const newRuns: RichRun[] = [];
  let totalCount = 0;
  let i = 0;
  while (i < runs.length) {
    if (runs[i]!.type !== "text") {
      newRuns.push(runs[i]!);
      i++;
      continue;
    }
    const groupStart = i;
    while (i < runs.length && runs[i]!.type === "text") i++;
    const group = runs.slice(groupStart, i);
    const { newRuns: gResult, count } = replaceInTextRunGroup(group, findStr, replaceStr);
    newRuns.push(...gResult);
    totalCount += count;
  }
  return { newRuns, count: totalCount };
}

function replaceInTextRunGroup(
  runs: RichRun[],
  findStr: string,
  replaceStr: string,
): { newRuns: RichRun[]; count: number } {
  const charRuns: number[] = [];
  let flat = "";
  for (let i = 0; i < runs.length; i++) {
    const content = runs[i]!.text?.content ?? "";
    for (let c = 0; c < content.length; c++) charRuns.push(i);
    flat += content;
  }

  const matches: Array<{ start: number; end: number }> = [];
  let pos = 0;
  while (true) {
    const idx = flat.indexOf(findStr, pos);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + findStr.length });
    pos = idx + findStr.length;
  }
  if (matches.length === 0) return { newRuns: runs, count: 0 };

  interface Segment { content: string; runIdx: number }
  const segments: Segment[] = [];
  const pushSlice = (from: number, to: number): void => {
    if (from >= to) return;
    let subStart = from;
    let currentRun = charRuns[subStart]!;
    for (let c = from + 1; c <= to; c++) {
      if (c === to || charRuns[c] !== currentRun) {
        segments.push({ content: flat.slice(subStart, c), runIdx: currentRun });
        subStart = c;
        if (c < to) currentRun = charRuns[c]!;
      }
    }
  };

  let cursor = 0;
  for (const m of matches) {
    pushSlice(cursor, m.start);
    segments.push({ content: replaceStr, runIdx: charRuns[m.start]! });
    cursor = m.end;
  }
  pushSlice(cursor, flat.length);

  const newRuns: RichRun[] = [];
  for (const seg of segments) {
    if (seg.content.length === 0) continue;
    const orig = runs[seg.runIdx]!;
    newRuns.push({
      type: "text",
      text: { content: seg.content, link: orig.text?.link ?? null },
      annotations: orig.annotations,
      plain_text: seg.content,
      href: orig.href ?? null,
    });
  }
  return { newRuns, count: matches.length };
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

  // Also check/update the page title. For database rows, the title is stored
  // on whichever property has `type: "title"` (the user may have renamed it);
  // for regular pages the runs live under the `title` property key directly.
  let titleUpdated = false;
  const page = await fetchWith404Hint(
    () => notionRequest<{ properties: Record<string, unknown> }>("GET", `/pages/${id}`),
    `Page ${id}`,
  );
  let titleKey: string | null = null;
  let titleRuns: RichRun[] | undefined;
  for (const [name, value] of Object.entries(page.properties)) {
    const prop = value as { type?: string; title?: RichRun[] };
    if (prop.type === "title" && Array.isArray(prop.title)) {
      titleKey = name;
      titleRuns = prop.title;
      break;
    }
  }
  if (titleRuns && titleRuns.length > 0 && titleKey) {
    const { newRuns, count } = replaceInRichText(titleRuns, findStr, replaceStr);
    if (count > 0) {
      matchCount += count;
      titleUpdated = true;
      if (!getBooleanFlag(flags, "dry-run")) {
        await notionRequest("PATCH", `/pages/${id}`, {
          properties: { [titleKey]: { title: newRuns } },
        });
      }
    }
  }

  const blocks = await fetchBlockTree(id);

  const processBlocks = async (blks: Block[]): Promise<void> => {
    for (const block of blks) {
      const typeKey = RICH_TEXT_BLOCK_TYPES[block.type];
      if (!typeKey) {
        const nestedOnly = (block as any)._children as Block[] | undefined;
        if (nestedOnly) await processBlocks(nestedOnly);
        continue;
      }
      const typeData = (block as any)[typeKey];
      const richText = typeData?.rich_text as RichRun[] | undefined;
      if (!richText) continue;

      const { newRuns, count } = replaceInRichText(richText, findStr, replaceStr);
      if (count > 0) {
        matchCount += count;
        blockCount++;
        if (!getBooleanFlag(flags, "dry-run")) {
          await notionRequest("PATCH", `/blocks/${block.id}`, {
            [typeKey]: { rich_text: newRuns },
          });
        }
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
  const res = await notionRequest<{ id: string; url: string }>("PATCH", `/pages/${id}`, { in_trash: false });
  return renderJson({ id: res.id, url: res.url, restored: true });
}

export async function pageDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page delete <id> --yes");
  }
  const id = resolvePageId(positional[0]!);
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page delete", pageId: id, wouldTrash: true });
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Refusing to archive without --yes confirmation",
    );
  }
  const res = await notionRequest("PATCH", `/pages/${id}`, { in_trash: true });
  return renderJson(res);
}

/**
 * Remove the first top-level `# Title` line from `body` when it matches
 * `title`, skipping any lines inside fenced code blocks. Used by page create
 * so the explicit `--title` doesn't duplicate an H1 in the body.
 */
export function stripLeadingTitleH1(body: string, title: string): string {
  const lines = body.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^# (.+?)\s*$/.exec(line);
    if (!match) continue;
    if (match[1]!.trim() === title) {
      lines.splice(i, 1);
      return lines.join("\n").replace(/^\n+/, "");
    }
    // First non-matching top-level H1 stops the scan — the title can only
    // shadow the *first* heading, not one further down.
    return body;
  }
  return body;
}

export function extractSyncTitle(
  frontmatter: Record<string, unknown>,
  body: string,
): { title: string; syncBody: string; explicit: boolean } {
  if (frontmatter.title) {
    return { title: String(frontmatter.title), syncBody: body, explicit: true };
  }
  // Find H1 outside fenced code blocks (backtick or tilde). We track the
  // opening fence's char and length so a shorter closer (e.g. ``` inside a
  // ```` fence) is treated as code content instead of toggling out of the
  // fence and misreading an H1 inside the block as the page title.
  const lines = body.split("\n");
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const openMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (openMatch) {
      const mark = openMatch[1]!;
      if (fenceChar === null) {
        fenceChar = mark[0] as "`" | "~";
        fenceLen = mark.length;
        continue;
      }
      if (mark[0] === fenceChar && mark.length >= fenceLen && /^\s*$/.test(trimmed.slice(mark.length))) {
        fenceChar = null;
        fenceLen = 0;
        continue;
      }
      continue;
    }
    if (fenceChar !== null) continue;
    const h1 = /^# (.+)$/.exec(lines[i]!);
    if (h1) {
      const title = h1[1]!.trim();
      const syncBody = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").trimStart();
      return { title, syncBody, explicit: true };
    }
  }
  return { title: "Untitled", syncBody: body, explicit: false };
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
  // Resolve symlinks so a symlink inside the working directory cannot be used
  // to redirect sync state into a file outside the working directory.
  try {
    const realCwd = await realpath(cwd);
    const realFile = await realpath(file);
    const realCwdPrefix = realCwd.endsWith(sep) ? realCwd : realCwd + sep;
    if (realFile !== realCwd && !realFile.startsWith(realCwdPrefix)) {
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Refusing to sync file outside working directory (resolved target ${realFile} escapes ${realCwd}).`,
      );
    }
  } catch (err) {
    if (err instanceof NotionCliError) throw err;
    // ENOENT is fine — the file may not exist yet on first sync.
  }
  const source = await readFileText(file, "sync file");
  const { data: frontmatter, body } = extractFrontmatter(source);

  // Fetch remote page metadata for drift detection when notion_id exists
  let remoteEditedAt: string | undefined;
  let validatedNotionId: string | undefined;
  let remoteFetchFailed = false;
  if (typeof frontmatter.notion_id === "string" && frontmatter.notion_id) {
    validatedNotionId = resolvePageId(frontmatter.notion_id);
    try {
      const remotePage = await notionRequest<{ last_edited_time: string }>(
        "GET",
        `/pages/${validatedNotionId}`,
      );
      remoteEditedAt = remotePage.last_edited_time;
    } catch {
      remoteFetchFailed = true;
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
    if (remoteFetchFailed && validatedNotionId) {
      process.stderr.write(
        `notionctl: notion_id ${validatedNotionId} could not be fetched — the page may have been trashed or the integration disconnected. Local file is unchanged so no action was taken, but the remote may no longer exist. Remove notion_id from frontmatter and sync again to recreate if needed.\n`,
      );
    }
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
    const parentKey = await detectParentKey(parentId);
    // The title property id is always `title`, so the PATCH works for DB rows
    // whose title column has been renamed, as well as for regular pages.
    const titleProp = parentKey === "database_id"
      ? { title: { title: [{ type: "text", text: { content: title, link: null } }] } }
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
    const { title, syncBody, explicit: titleExplicit } = extractSyncTitle(frontmatter, body);
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
    // Only PATCH the title when the file explicitly specifies one (via
    // frontmatter `title:` or a leading `# H1`). Otherwise, a DB row or
    // regular page keeps its existing name — otherwise files without a
    // title source silently clobber the row with "Untitled".
    if (titleExplicit) {
      await notionRequest("PATCH", `/pages/${pageId}`, {
        properties: { title: { title: [{ type: "text", text: { content: title, link: null } }] } },
      });
    }
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

