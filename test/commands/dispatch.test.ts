import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve the compiled bin entry relative to this test's dist location.
// dist/test/commands/dispatch.test.js → repo root is 3 dirs up.
const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, "..", "..", "..", "bin", "notionctl.js");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [BIN, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("dispatch --help and --version flags", () => {
  it("notionctl --version prints version at position 0", async () => {
    const { code, stdout } = await runCli(["--version"]);
    assert.equal(code, 0);
    assert.match(stdout, /^notionctl \d/);
  });

  it("notionctl -v prints version at position 0", async () => {
    const { code, stdout } = await runCli(["-v"]);
    assert.equal(code, 0);
    assert.match(stdout, /^notionctl \d/);
  });

  it("notionctl --help prints help at position 0", async () => {
    const { code, stdout } = await runCli(["--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /notionctl/);
    assert.match(stdout, /Usage:/);
  });

  it("notionctl page --help prints help at position 1", async () => {
    const { code, stdout } = await runCli(["page", "--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
  });

  it("notionctl page get --help prints help (post-verb strip)", async () => {
    const { code, stdout } = await runCli(["page", "get", "--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
  });

  it("buried -v does NOT hijack version — error surfaces from command layer", async () => {
    // `-v` appears as the value of --format here; the bounded head window
    // must NOT treat it as a global version flag. The command layer should
    // reach resolvePageId() and fail because 'abc' is not a valid id.
    const { code, stdout, stderr } = await runCli(["page", "get", "abc", "--format", "-v"]);
    assert.notEqual(code, 0, "expected failure, not version print");
    assert.doesNotMatch(stdout, /^notionctl \d/);
    assert.match(stderr + stdout, /Could not parse Notion ID/);
  });

  it("buried --help on `page find-replace` is still honored (docs discovery)", async () => {
    // Users expect help to appear any time --help follows a verb; we strip
    // it during dispatch. This is the intended UX, not a security concern.
    const { code, stdout } = await runCli([
      "page", "find-replace", "--help",
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
  });

  for (const args of [
    ["page", "get", "11111111111111111111111111111111", "--help"],
    ["db", "row", "get", "11111111111111111111111111111111", "--help"],
    ["api", "GET", "/users/me", "--help"],
    ["page", "find-replace", "11111111111111111111111111111111", "--find", "X", "--help"],
  ]) {
    it(`--help is honored past the head window: ${args.join(" ")}`, async () => {
      // A two-slot window dropped every help request further along, and these
      // died on "Flag --help requires a value" instead of printing anything.
      const { code, stdout } = await runCli(args);
      assert.equal(code, 0, stdout);
      assert.match(stdout, /Usage:/);
    });
  }

  it("--help as a flag's value does NOT hijack the command", async () => {
    // The case the window was added for: -h here is the value of --find.
    const { code, stdout } = await runCli([
      "page", "find-replace", "11111111111111111111111111111111",
      "--find", "-h", "--replace", "X",
    ], { NOTION_TOKEN: "ntn_notarealtokenatallxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
    assert.notEqual(code, 0, "expected the command to run and fail, not print help");
    assert.doesNotMatch(stdout, /Usage:/);
  });

  it("bare `notionctl page` (no verb) prints help, not 'Unknown verb: undefined'", async () => {
    const { code, stdout, stderr } = await runCli(["page"]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
    assert.doesNotMatch(stderr, /Unknown verb: undefined/);
  });
});
