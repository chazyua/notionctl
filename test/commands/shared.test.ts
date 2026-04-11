import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlags, resolvePageId, getBooleanFlag } from "../../src/commands/shared.js";

describe("parseFlags", () => {
  it("parses --flag value pairs", () => {
    const { flags, positional } = parseFlags(["--parent", "abc", "--title", "Hello"]);
    assert.equal(flags.get("parent"), "abc");
    assert.equal(flags.get("title"), "Hello");
    assert.deepEqual(positional, []);
  });

  it("parses --flag=value form", () => {
    const { flags } = parseFlags(["--parent=abc", "--title=Hello"]);
    assert.equal(flags.get("parent"), "abc");
    assert.equal(flags.get("title"), "Hello");
  });

  it("collects repeated flags as arrays", () => {
    const { repeated } = parseFlags(["--prop", "a=1", "--prop", "b=2"]);
    assert.deepEqual(repeated.get("prop"), ["a=1", "b=2"]);
  });

  it("collects repeated --filter flags as arrays", () => {
    const { repeated } = parseFlags(["--filter", "Status=Done", "--filter", "Count>=10"]);
    assert.deepEqual(repeated.get("filter"), ["Status=Done", "Count>=10"]);
  });

  it("treats boolean flags without value as true", () => {
    const { flags } = parseFlags(["--dry-run", "--quiet"]);
    assert.equal(flags.get("dry-run"), "true");
    assert.equal(flags.get("quiet"), "true");
  });

  it("separates positional args", () => {
    const { positional } = parseFlags(["page", "get", "abc-123", "--format", "json"]);
    assert.deepEqual(positional, ["page", "get", "abc-123"]);
  });

  it("throws when a non-boolean flag's value is another flag", () => {
    // Regression: --title with missing value used to silently consume --from as its value.
    assert.throws(
      () => parseFlags(["--title", "--from", "body.md"]),
      /--title requires a value/,
    );
  });

  it("throws when a non-boolean flag is the last arg", () => {
    assert.throws(() => parseFlags(["--title"]), /--title requires a value/);
  });

  it("allows --flag=-- style explicit values", () => {
    // An explicit = binds the value, even if it looks like a flag.
    const { flags } = parseFlags(["--title=--from"]);
    assert.equal(flags.get("title"), "--from");
  });
});

describe("resolvePageId", () => {
  it("returns UUID unchanged when already in UUID form", () => {
    const id = "abcd1234-ef56-7890-abcd-1234567890ab";
    assert.equal(resolvePageId(id), id);
  });

  it("extracts ID from notion.so URL", () => {
    const url = "https://www.notion.so/Workspace/Page-Title-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("handles IDs without dashes", () => {
    assert.equal(resolvePageId("abcd1234ef567890abcd1234567890ab"), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("extracts ID from multi-segment notion.so URL", () => {
    const url = "https://www.notion.so/team/area/Page-Title-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("extracts ID from notion.site URL (public pages)", () => {
    const url = "https://mysite.notion.site/Page-Title-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("extracts ID from notion.site URL with subpath", () => {
    const url = "https://team.notion.site/area/Page-abcd1234ef567890abcd1234567890ab";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("strips URL fragment (#block-anchor)", () => {
    const url = "https://www.notion.so/Page-abcd1234ef567890abcd1234567890ab#block-anchor";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("strips trailing slash on URL", () => {
    const url = "https://www.notion.so/Page-abcd1234ef567890abcd1234567890ab/";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("strips trailing slash before query string", () => {
    const url = "https://www.notion.so/Page-abcd1234ef567890abcd1234567890ab/?pvs=4";
    assert.equal(resolvePageId(url), "abcd1234-ef56-7890-abcd-1234567890ab");
  });

  it("throws on invalid ID", () => {
    assert.throws(() => resolvePageId("not-a-valid-id"), /Could not parse/);
  });

  it("throws on too-short hex string", () => {
    assert.throws(() => resolvePageId("abcd1234"), /Could not parse/);
  });
});

describe("getBooleanFlag", () => {
  it("returns true when flag is set and false when absent", () => {
    const { flags } = parseFlags(["--dry-run"]);
    assert.equal(getBooleanFlag(flags, "dry-run"), true);
    assert.equal(getBooleanFlag(flags, "quiet"), false);
  });
});
