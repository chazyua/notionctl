/**
 * File commands: upload.
 *
 * Wraps Notion's file upload API. Files are uploaded to Notion's CDN
 * and can be referenced in blocks. If --parent is provided, an image
 * or file block is also created on that page.
 */

import { basename, extname } from "node:path";
import { stat, open } from "node:fs/promises";
import { notionRequest, notionUploadFile } from "../http.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson } from "../output.js";

// Notion File Upload API supported extensions (from official docs).
// https://developers.notion.com/docs/working-with-files-and-media
const NOTION_SUPPORTED_EXTENSIONS = new Set([
  // Audio
  ".aac", ".adts", ".mid", ".midi", ".mp3", ".mpga", ".m4a", ".m4b",
  ".mp4", ".oga", ".ogg", ".opus", ".wav", ".wma", ".weba", ".flac",
  // Documents
  ".pdf", ".txt", ".csv", ".json", ".doc", ".dot", ".docx", ".dotx",
  ".xls", ".xlt", ".xla", ".xlsx", ".xltx", ".ppt", ".pot", ".pps",
  ".ppa", ".pptx", ".potx", ".rtf", ".md", ".markdown", ".html", ".htm",
  ".epub", ".xml", ".css", ".odt", ".ods", ".odp", ".ics", ".yaml",
  ".yml", ".tsv", ".zip", ".gz", ".gzip", ".tar", ".7z", ".bz2", ".rar",
  // Images
  ".gif", ".heic", ".jpeg", ".jpg", ".png", ".svg", ".tif", ".tiff",
  ".webp", ".ico", ".bmp", ".avif", ".apng",
  // Video
  ".amv", ".asf", ".wmv", ".avi", ".f4v", ".flv", ".gifv", ".m4v",
  ".mkv", ".webm", ".mov", ".qt", ".mpeg", ".ogv", ".3gp", ".3g2",
]);

const MIME_MAP: Record<string, string> = {
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".apng": "image/apng",
  ".ico": "image/vnd.microsoft.icon",
  // Docs
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".zip": "application/zip",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  // Media
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".ogg": "audio/ogg",
};

export function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * Detect whether the first chunk of a file looks like text. A file is
 * considered binary if it contains any NUL bytes or if more than ~10% of
 * the sampled bytes are non-printable (excluding common whitespace).
 */
export function looksLikeText(sample: Uint8Array): boolean {
  if (sample.length === 0) return true;
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b === 0) return false;
    const isPrintable =
      (b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d || b >= 0x80;
    if (!isPrintable) nonPrintable++;
  }
  return nonPrintable / sample.length < 0.1;
}

/**
 * If the file's extension isn't supported by Notion's API, rename it to
 * a supported fallback so the upload succeeds:
 *   - text-looking bytes → .txt (text/plain)
 *   - binary bytes       → .zip (application/zip, a "wrapper" — the bytes
 *                          are still the original file's, but the .zip
 *                          extension keeps Notion happy)
 * The original name is preserved in the CLI output so the user knows
 * what the file was. Returns the upload filename, fallback flag, and
 * the content type to send.
 */
export function resolveUploadName(
  originalName: string,
  sample?: Uint8Array,
): { uploadName: string; fallback: boolean; contentType: string } {
  const ext = extname(originalName).toLowerCase();
  if (NOTION_SUPPORTED_EXTENSIONS.has(ext)) {
    return { uploadName: originalName, fallback: false, contentType: guessMimeType(originalName) };
  }
  const base = originalName.slice(0, originalName.length - ext.length);
  const isText = sample ? looksLikeText(sample) : false;
  if (isText) {
    return { uploadName: `${base}${ext}.txt`, fallback: true, contentType: "text/plain" };
  }
  return { uploadName: `${base}${ext}.zip`, fallback: true, contentType: "application/zip" };
}

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
  "image/tiff",
  "image/heic",
  "image/apng",
  "image/vnd.microsoft.icon",
  "image/x-icon",
]);

export async function fileUploadCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl file upload <path> [--parent <page-id>]",
    );
  }
  const filePath = positional[0]!;
  const originalName = basename(filePath);

  // Verify file exists and check size
  let fileSize: number;
  try {
    const st = await stat(filePath);
    if (!st.isFile()) {
      throw new NotionCliError(ErrorCode.USAGE, `Not a regular file: ${filePath}`);
    }
    fileSize = st.size;
  } catch (err) {
    if (err instanceof NotionCliError) throw err;
    throw new NotionCliError(ErrorCode.USAGE, `File not found: ${filePath}`);
  }

  // Sniff the first 4 KB only when we may need a fallback extension, so
  // we pick the right MIME type instead of labeling every unknown file
  // as text/plain.
  let sample: Uint8Array | undefined;
  if (!NOTION_SUPPORTED_EXTENSIONS.has(extname(originalName).toLowerCase()) && fileSize > 0) {
    const fh = await open(filePath, "r");
    try {
      const buf = new Uint8Array(Math.min(4096, fileSize));
      await fh.read(buf, 0, buf.length, 0);
      sample = buf;
    } finally {
      await fh.close();
    }
  }

  const { uploadName, fallback, contentType } = resolveUploadName(originalName, sample);
  if (fileSize === 0) {
    throw new NotionCliError(ErrorCode.USAGE, `File is empty: ${filePath}`);
  }
  // BUG-12: the per-workspace limit is authoritative — the CLI hard cap is
  // just a safety net. Fetch the real limit from /users/me so a user on a
  // 5 MiB workspace gets a clean pre-flight error instead of a mid-upload failure.
  const CLI_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
  let workspaceLimit = CLI_MAX_UPLOAD_BYTES;
  try {
    const me = await notionRequest<{ bot?: { workspace_limits?: { max_file_upload_size_in_bytes?: number } } }>(
      "GET",
      "/users/me",
    );
    const wsCap = me.bot?.workspace_limits?.max_file_upload_size_in_bytes;
    if (typeof wsCap === "number" && wsCap > 0) workspaceLimit = wsCap;
  } catch {
    // Network failure here is non-fatal — fall back to the CLI cap.
  }
  const effectiveLimit = Math.min(CLI_MAX_UPLOAD_BYTES, workspaceLimit);
  if (fileSize > effectiveLimit) {
    const mib = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MiB`;
    throw new NotionCliError(
      ErrorCode.USAGE,
      `File too large: ${mib(fileSize)} exceeds the workspace limit of ${mib(effectiveLimit)}`,
    );
  }

  if (fallback) {
    process.stderr.write(
      `Note: "${originalName}" has an unsupported extension for Notion's API. Uploading as "${uploadName}" instead.\n`,
    );
  }

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({
      action: "file upload",
      file: filePath,
      originalName,
      uploadName,
      contentType,
      sizeBytes: fileSize,
      parent: flags.get("parent") ?? null,
      ...(fallback ? { fallback: true } : {}),
    });
  }

  const uploaded = await notionUploadFile(filePath, uploadName, contentType);

  const result: Record<string, unknown> = {
    id: uploaded.id,
    status: uploaded.status,
    originalName,
    uploadName,
    contentType,
    sizeBytes: fileSize,
    ...(fallback ? { fallback: true } : {}),
  };

  // If --parent is provided, create a block on that page referencing the file
  const parent = flags.get("parent");
  if (parent) {
    const parentId = resolvePageId(parent);
    const isImage = IMAGE_TYPES.has(contentType);
    const blockType = isImage ? "image" : "file";
    const blockBody: Record<string, unknown> = {
      type: blockType,
      [blockType]: {
        type: "file_upload",
        file_upload: { id: uploaded.id },
      },
    };

    await notionRequest("PATCH", `/blocks/${parentId}/children`, {
      children: [blockBody],
    });
    result.block = "created";
    result.blockType = blockType;
    result.parentId = parentId;
  }

  return renderJson(result);
}
