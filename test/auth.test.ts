import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, chmod, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadToken,
  saveToken,
  clearToken,
  getConfigPath,
  AuthSource,
} from "../src/auth.js";
import { NotionCliError, ErrorCode } from "../src/errors.js";

describe("auth", () => {
  let testHome: string;
  let originalHome: string | undefined;
  let originalXdg: string | undefined;
  let originalToken: string | undefined;

  before(async () => {
    testHome = await mkdtemp(join(tmpdir(), "notionctl-auth-test-"));
    originalHome = process.env.HOME;
    originalXdg = process.env.XDG_CONFIG_HOME;
    originalToken = process.env.NOTION_TOKEN;
    process.env.HOME = testHome;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.NOTION_TOKEN;
  });

  after(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalToken !== undefined) process.env.NOTION_TOKEN = originalToken;
    await rm(testHome, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(join(testHome, ".config"), { recursive: true, force: true });
    delete process.env.NOTION_TOKEN;
  });

  it("loads token from NOTION_TOKEN env var", async () => {
    process.env.NOTION_TOKEN = "ntn_from_env_12345";
    const result = await loadToken();
    assert.equal(result.token, "ntn_from_env_12345");
    assert.equal(result.source, AuthSource.ENV);
  });

  it("loads token from config file when env var is missing", async () => {
    await saveToken("ntn_from_file_67890");
    const result = await loadToken();
    assert.equal(result.token, "ntn_from_file_67890");
    assert.equal(result.source, AuthSource.CONFIG_FILE);
  });

  it("env var takes precedence over config file", async () => {
    await saveToken("ntn_from_file");
    process.env.NOTION_TOKEN = "ntn_from_env";
    const result = await loadToken();
    assert.equal(result.token, "ntn_from_env");
    assert.equal(result.source, AuthSource.ENV);
  });

  it("throws AUTH_MISSING when nothing is configured", async () => {
    await assert.rejects(
      async () => loadToken(),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.AUTH_MISSING);
        return true;
      },
    );
  });

  it("saveToken writes config file with mode 0600", async () => {
    await saveToken("ntn_save_test");
    const path = getConfigPath();
    const st = await stat(path);
    const mode = st.mode & 0o777;
    assert.equal(mode, 0o600, `Expected 0600, got ${mode.toString(8)}`);
  });

  it("saveToken creates parent directory with mode 0700", async () => {
    await saveToken("ntn_dir_test");
    const dirPath = join(testHome, ".config", "notion-cli");
    const st = await stat(dirPath);
    const mode = st.mode & 0o777;
    assert.equal(mode, 0o700, `Expected 0700, got ${mode.toString(8)}`);
  });

  it("clearToken removes config file", async () => {
    await saveToken("ntn_clear_test");
    await clearToken();
    await assert.rejects(async () => loadToken(), NotionCliError);
  });

  it("respects XDG_CONFIG_HOME when set", async () => {
    const xdgDir = join(testHome, "custom-xdg");
    process.env.XDG_CONFIG_HOME = xdgDir;
    try {
      await saveToken("ntn_xdg_test");
      const path = getConfigPath();
      assert.ok(path.startsWith(xdgDir), `Expected path under ${xdgDir}, got ${path}`);
    } finally {
      delete process.env.XDG_CONFIG_HOME;
    }
  });

  it("ignores config file with permissive mode (security guard)", async () => {
    await saveToken("ntn_initial");
    const path = getConfigPath();
    await chmod(path, 0o644);  // world-readable, insecure
    await assert.rejects(
      async () => loadToken(),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        // Should refuse to read an insecurely-permissioned token file
        return true;
      },
    );
  });
});
