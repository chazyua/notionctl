/**
 * File commands: upload.
 *
 * Wraps Notion's file upload API. Files are uploaded to Notion's CDN
 * and can be referenced in blocks. If --parent is provided, an image
 * or file block is also created on that page.
 */

import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";
import { notionRequest, notionUploadFile } from "../http.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson } from "../output.js";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
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
};

function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

export async function fileUploadCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl file upload <path> [--parent <page-id>]",
    );
  }
  const filePath = positional[0]!;
  const fileName = basename(filePath);
  const contentType = guessMimeType(fileName);

  // Verify file exists and check size
  let fileSize: number;
  try {
    const st = await stat(filePath);
    fileSize = st.size;
  } catch {
    throw new NotionCliError(ErrorCode.USAGE, `File not found: ${filePath}`);
  }
  if (fileSize === 0) {
    throw new NotionCliError(ErrorCode.USAGE, `File is empty: ${filePath}`);
  }
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
  if (fileSize > MAX_UPLOAD_BYTES) {
    throw new NotionCliError(ErrorCode.USAGE, `File too large: ${fileSize} bytes (max ${MAX_UPLOAD_BYTES} bytes)`);
  }

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({
      action: "file upload",
      file: filePath,
      fileName,
      contentType,
      sizeBytes: fileSize,
      parent: flags.get("parent") ?? null,
    });
  }

  const uploaded = await notionUploadFile(filePath, fileName, contentType);

  const result: Record<string, unknown> = {
    id: uploaded.id,
    status: uploaded.status,
    fileName,
    contentType,
    sizeBytes: fileSize,
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
