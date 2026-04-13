import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveUploadName } from "../../src/commands/file.js";

describe("resolveUploadName", () => {
  it("passes through supported extensions unchanged", () => {
    const result = resolveUploadName("photo.png");
    assert.equal(result.uploadName, "photo.png");
    assert.equal(result.fallback, false);
  });

  it("passes through .pdf unchanged", () => {
    const result = resolveUploadName("doc.pdf");
    assert.equal(result.uploadName, "doc.pdf");
    assert.equal(result.fallback, false);
  });

  it("renames unsupported single-extension file to .txt", () => {
    const result = resolveUploadName("script.py");
    assert.equal(result.uploadName, "script.txt");
    assert.equal(result.fallback, true);
  });

  it("renames unsupported file with no extension to name.txt", () => {
    const result = resolveUploadName("Makefile");
    assert.equal(result.uploadName, "Makefile.txt");
    assert.equal(result.fallback, true);
  });

  it("handles files with multiple dots correctly", () => {
    const result = resolveUploadName("archive.tar.xz");
    assert.equal(result.uploadName, "archive.tar.txt");
    assert.equal(result.fallback, true);
  });

  it("treats unsupported extension case-insensitively", () => {
    const result = resolveUploadName("notes.ODD");
    assert.equal(result.uploadName, "notes.txt");
    assert.equal(result.fallback, true);
  });
});

describe("guessMimeType (bug hunt round 4)", () => {
  it("returns application/octet-stream for unknown extensions", () => {
    assert.equal(guessMimeType("thing.xyz"), "application/octet-stream");
  });

  it("returns the known MIME for common extensions", () => {
    assert.equal(guessMimeType("notes.md"), "text/markdown");
    assert.equal(guessMimeType("a.png"), "image/png");
    assert.equal(guessMimeType("x.json"), "application/json");
  });

  it("returns audio/mp4 for .m4b audiobook files", () => {
    assert.equal(guessMimeType("audiobook.m4b"), "audio/mp4");
  });
});

describe("looksLikeText", () => {
  it("returns true for ASCII text", () => {
    assert.equal(looksLikeText(new TextEncoder().encode("hello\nworld\n")), true);
  });

  it("returns false for bytes containing NUL", () => {
    assert.equal(looksLikeText(new Uint8Array([0x68, 0x00, 0x69])), false);
  });

  it("returns false for mostly non-printable bytes", () => {
    const bytes = new Uint8Array(50);
    for (let i = 0; i < bytes.length; i++) bytes[i] = 0x01;
    assert.equal(looksLikeText(bytes), false);
  });

  it("returns true for UTF-8 text with high bytes", () => {
    assert.equal(looksLikeText(new TextEncoder().encode("héllo wörld — 👋")), true);
  });
});

// BUG-B regression: file upload with directory path now throws a clean
// USAGE error ("Not a regular file: ...") instead of crashing with EISDIR.
// The fix is an st.isFile() check in fileUploadCommand — tested via dogfood
// since the command requires filesystem + network integration.
