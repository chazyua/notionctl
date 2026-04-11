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
