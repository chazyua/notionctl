import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFlags, resolvePageId, getBooleanFlag, readFileText, parseJsonObject, rejectExtraPositionals, readStdinBounded } from "../../src/commands/shared.js";
import { PassThrough } from "node:stream";
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

describe("parseFlags edge cases", () => {
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

describe("readFileText error translation", () => {
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

describe("parseJsonObject prototype-pollution guard", () => {
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


describe("rejectExtraPositionals", () => {
  // `page delete <id> --yes false` parsed as yes=true plus an unread "false"
  // positional and archived the page — the opposite of what the caller asked.
  // Verified against page delete, block delete, api DELETE and db update.
  it("refuses a stray argument left over by a boolean flag", () => {
    assert.throws(
      () => rejectExtraPositionals(["abc123", "false"], 1),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal(err.code, ErrorCode.USAGE);
        assert.match(err.message, /Unexpected argument: false/);
        assert.match(err.message, /Boolean flags take no value/, "should explain where it came from");
        return true;
      },
    );
  });

  it("refuses any stray argument, not just boolean-looking ones", () => {
    // The whole point of checking arity rather than value: `--yes maybe`
    // bypassed a value-matching guard, but has no slot here either.
    for (const extra of ["maybe", "-0", "fa\u0142se", " 0", "whatever"]) {
      assert.throws(
        () => rejectExtraPositionals(["abc123", extra], 1),
        NotionCliError,
        `${JSON.stringify(extra)} must be refused`,
      );
    }
  });

  it("omits the boolean hint for an ordinary stray argument", () => {
    assert.throws(
      () => rejectExtraPositionals(["abc123", "extra.md"], 1),
      (err: unknown) => {
        assert.match((err as Error).message, /Unexpected argument: extra\.md/);
        assert.doesNotMatch((err as Error).message, /Boolean flags/);
        return true;
      },
    );
  });

  it("allows exactly the expected number of positionals", () => {
    assert.doesNotThrow(() => rejectExtraPositionals([], 0));
    assert.doesNotThrow(() => rejectExtraPositionals(["abc"], 1));
    assert.doesNotThrow(() => rejectExtraPositionals(["DELETE", "/blocks/x"], 2));
    assert.doesNotThrow(() => rejectExtraPositionals(["abc"], 2), "fewer than expected is another command's error");
  });

  it("reports the first unexpected argument", () => {
    assert.throws(
      () => rejectExtraPositionals(["abc", "first", "second"], 1),
      (err: unknown) => {
        assert.match((err as Error).message, /Unexpected argument: first/);
        return true;
      },
    );
  });
});

describe("boolean flags keep their parser semantics", () => {
  it("does not consume a following token", () => {
    // Deliberately unchanged: catching this in the parser broke free-text
    // positionals such as `search --verbose n`. Arity is the command's business.
    const { flags, positional } = parseFlags(["--yes", "false"]);
    assert.equal(getBooleanFlag(flags, "yes"), true);
    assert.deepEqual(positional, ["false"], "the value stays a positional for the command to reject");
  });

  it("leaves free-text positionals after a boolean flag alone", () => {
    const { flags, positional } = parseFlags(["--verbose", "n"]);
    assert.equal(getBooleanFlag(flags, "verbose"), true);
    assert.deepEqual(positional, ["n"], "search --verbose n must still work");
  });

  it("still accepts a bare boolean flag and the explicit = form", () => {
    assert.equal(getBooleanFlag(parseFlags(["abc", "--yes"]).flags, "yes"), true);
    assert.equal(getBooleanFlag(parseFlags(["--yes=false"]).flags, "yes"), false);
    assert.equal(getBooleanFlag(parseFlags(["--yes=true"]).flags, "yes"), true);
    assert.equal(getBooleanFlag(parseFlags(["--yes", "--dry-run"]).flags, "dry-run"), true);
  });
});

describe("readStdinBounded — an open pipe that never closes", () => {
  it("gives up after the idle timeout instead of blocking forever", async () => {
    // A pipe that is open but never written to used to block with no output at
    // all, because the promise only settled on 'end'.
    const stream = new PassThrough();
    await assert.rejects(
      readStdinBounded(1024, stream, 40),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.USAGE);
        assert.match((err as Error).message, /No input on stdin/);
        return true;
      },
    );
  });

  it("says how to proceed rather than only that it gave up", async () => {
    const stream = new PassThrough();
    await assert.rejects(readStdinBounded(1024, stream, 40), (err: any) => {
      assert.ok(err.suggestions.some((s: string) => s.includes("--from")));
      assert.ok(err.suggestions.some((s: string) => s.includes("/dev/null")));
      return true;
    });
  });

  it("a producer that keeps sending is never cut off", async () => {
    // The bound is on idle time, not total time: each chunk resets it, so a
    // slow but progressing stream must survive past the timeout.
    const stream = new PassThrough();
    const read = readStdinBounded(1024, stream, 60);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 30));
      stream.write("x");
    }
    stream.end();
    assert.equal(await read, "xxxxx");
  });

  it("content that arrives normally still resolves", async () => {
    const stream = new PassThrough();
    const read = readStdinBounded(1024, stream, 5000);
    stream.end("hello");
    assert.equal(await read, "hello");
  });

  it("the size bound still applies", async () => {
    const stream = new PassThrough();
    const read = readStdinBounded(4, stream, 5000);
    stream.write("far too long");
    await assert.rejects(read, /exceeds maximum size/);
  });
});
