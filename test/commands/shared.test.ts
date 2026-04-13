import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFlags, resolvePageId, getBooleanFlag, readFileText, parseJsonObject } from "../../src/commands/shared.js";
import { NotionCliError, ErrorCode } from "../../src/errors.js";

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

  it("strips trailing slashes from notion URLs", () => {
    assert.equal(
      resolvePageId("https://notion.so/Page-abcd1234ef567890abcd1234567890ab/"),
      "abcd1234-ef56-7890-abcd-1234567890ab",
    );
    assert.equal(
      resolvePageId("https://notion.so/Page-abcd1234ef567890abcd1234567890ab//"),
      "abcd1234-ef56-7890-abcd-1234567890ab",
    );
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

describe("bug hunt round 4 regressions — parseFlags", () => {
  it("throws when a value flag is followed by another --flag instead of a value", () => {
    assert.throws(
      () => parseFlags(["--title", "--parent", "xyz"]),
      /--title requires a value/,
    );
  });

  it("throws when a repeatable flag without value is followed by another --flag", () => {
    // regression for --filter --dry-run silently swallowing --dry-run
    assert.throws(
      () => parseFlags(["--filter", "Status=Done", "--filter", "--dry-run"]),
      /--filter requires a value/,
    );
  });

  it("still accepts negative numbers as flag values", () => {
    const { flags } = parseFlags(["--count", "-5"]);
    assert.equal(flags.get("count"), "-5");
  });

  it("--flag= (empty string) remains allowed", () => {
    const { flags } = parseFlags(["--title="]);
    assert.equal(flags.get("title"), "");
  });
});

describe("bug hunt round 6 — readFileText error translation", () => {
  it("translates ENOENT into a typed USAGE error", async () => {
    let caught: NotionCliError | undefined;
    try {
      await readFileText("/tmp/notionctl-bh6-no-such-file.md", "input markdown");
    } catch (e) {
      if (e instanceof NotionCliError) caught = e;
    }
    assert.ok(caught, "expected NotionCliError");
    assert.equal(caught!.code, ErrorCode.USAGE);
    assert.match(caught!.message, /input markdown not found/);
  });

  it("returns file contents on success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "notionctl-bh6-"));
    try {
      const path = join(dir, "data.md");
      await writeFile(path, "hello", "utf8");
      const content = await readFileText(path, "test");
      assert.equal(content, "hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("bug hunt round 6 audit — parseJsonObject prototype-pollution recursion", () => {
  it("strips top-level __proto__ / constructor / prototype keys", () => {
    const out = parseJsonObject(
      '{"__proto__":{"bad":true},"constructor":{"bad":true},"prototype":{"bad":true},"keep":1}',
      "--x",
    );
    assert.deepEqual(Object.keys(out).sort(), ["keep"]);
    assert.equal((out as any).keep, 1);
  });

  it("strips nested __proto__ inside an object value", () => {
    const out = parseJsonObject(
      '{"outer":{"__proto__":{"polluted":true},"real":"value"}}',
      "--x",
    );
    const outer = (out as any).outer;
    assert.deepEqual(Object.keys(outer).sort(), ["real"]);
    assert.equal(outer.real, "value");
    // Sanity: Object.prototype must not have been polluted
    assert.equal((({} as any).polluted), undefined);
  });

  it("strips __proto__ inside an array element", () => {
    const out = parseJsonObject(
      '{"list":[{"__proto__":{"polluted":true},"ok":1},{"ok":2}]}',
      "--x",
    );
    const list = (out as any).list as Array<Record<string, unknown>>;
    assert.equal(list.length, 2);
    assert.deepEqual(Object.keys(list[0]!).sort(), ["ok"]);
    assert.equal(list[0]!.ok, 1);
  });

  it("passes scalars and plain objects through unchanged", () => {
    const out = parseJsonObject('{"a":1,"b":"x","c":true,"d":null}', "--x");
    assert.deepEqual(out, { a: 1, b: "x", c: true, d: null });
  });

  it("still rejects top-level arrays and scalars", () => {
    assert.throws(() => parseJsonObject("[]", "--x"), /must be a JSON object/);
    assert.throws(() => parseJsonObject('"s"', "--x"), /must be a JSON object/);
    assert.throws(() => parseJsonObject("null", "--x"), /must be a JSON object/);
  });
});
