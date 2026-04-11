import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveUploadName, guessMimeType, looksLikeText } from "../../src/commands/file.js";

describe("resolveUploadName (bug hunt round 4)", () => {
  it("leaves a supported extension alone", () => {
    const out = resolveUploadName("notes.md");
    assert.equal(out.fallback, false);
    assert.equal(out.uploadName, "notes.md");
    assert.equal(out.contentType, "text/markdown");
  });

  it("falls back to .txt with text/plain for text-like bytes", () => {
    const sample = new TextEncoder().encode("hello world\nline two\n");
    const out = resolveUploadName("config.sqlite-journal", sample);
    assert.equal(out.fallback, true);
    assert.equal(out.uploadName, "config.sqlite-journal.txt");
    assert.equal(out.contentType, "text/plain");
  });

  it("falls back to .zip with application/zip for binary bytes", () => {
    const sample = new Uint8Array([0x00, 0xff, 0x01, 0x02, 0x03, 0xfe, 0x00]);
    const out = resolveUploadName("installer.dmg", sample);
    assert.equal(out.fallback, true);
    assert.equal(out.uploadName, "installer.dmg.zip");
    assert.equal(out.contentType, "application/zip");
  });

  it("falls back to .zip when no sample is provided (safe binary default)", () => {
    const out = resolveUploadName("mystery.xyz");
    assert.equal(out.fallback, true);
    assert.equal(out.uploadName, "mystery.xyz.zip");
    assert.equal(out.contentType, "application/zip");
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
