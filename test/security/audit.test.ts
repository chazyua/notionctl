import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve repo root relative to this test file's compiled location.
// dist/test/security/audit.test.js → repo root is 3 dirs up
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, "..", "..", "..", "src");

async function readAllSourceFiles(dir: string): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const walk = async (d: string): Promise<void> => {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push({ path: p, content: await readFile(p, "utf8") });
      }
    }
  };
  await walk(dir);
  return files;
}

describe("security audit — source tree", () => {
  it("source tree discovery works", async () => {
    const files = await readAllSourceFiles(SRC_DIR);
    assert.ok(files.length >= 5, `expected source files in ${SRC_DIR}, got ${files.length}`);
  });

  it("only src/http.ts uses fetch()", async () => {
    const files = await readAllSourceFiles(SRC_DIR);
    assert.ok(files.length > 0, "expected source files to be discovered");
    const offenders = files.filter(
      (f) =>
        !f.path.endsWith("http.ts") &&
        /\bfetch\s*\(/.test(f.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")),
    );
    assert.equal(
      offenders.length,
      0,
      `These files use fetch() but only http.ts should: ${offenders.map((o) => o.path).join(", ")}`,
    );
  });

  it("only src/auth.ts reads from config path", async () => {
    const files = await readAllSourceFiles(SRC_DIR);
    assert.ok(files.length > 0, "expected source files to be discovered");
    const configPathPattern = /notion-cli\/config\.json|getConfigPath\(\)/;
    const offenders = files.filter(
      (f) =>
        !f.path.endsWith("auth.ts") &&
        !f.path.endsWith("auth.test.ts") &&
        !f.path.includes("commands/auth.ts") &&
        configPathPattern.test(f.content),
    );
    assert.equal(offenders.length, 0, `Files other than auth.ts reference config path: ${offenders.map((o) => o.path).join(", ")}`);
  });

  it("no source file contains a hardcoded token pattern", async () => {
    const files = await readAllSourceFiles(SRC_DIR);
    assert.ok(files.length > 0, "expected source files to be discovered");
    const offenders = files.filter((f) => /ntn_[a-zA-Z0-9]{20,}/.test(f.content));
    assert.equal(offenders.length, 0, `Hardcoded token in: ${offenders.map((o) => o.path).join(", ")}`);
  });

  it("no source file imports a non-Node-builtin package", async () => {
    const files = await readAllSourceFiles(SRC_DIR);
    assert.ok(files.length > 0, "expected source files to be discovered");
    const NODE_BUILTINS = /^(node:|\.\.?\/)/;
    const offenders: string[] = [];
    for (const f of files) {
      const imports = f.content.matchAll(/from\s+["']([^"']+)["']/g);
      for (const m of imports) {
        const pkg = m[1]!;
        if (!NODE_BUILTINS.test(pkg) && !pkg.startsWith("node:")) {
          offenders.push(`${f.path}: ${pkg}`);
        }
      }
    }
    assert.equal(offenders.length, 0, `External imports detected:\n${offenders.join("\n")}`);
  });

  it("only api.notion.com URLs appear in source", async () => {
    const files = await readAllSourceFiles(SRC_DIR);
    assert.ok(files.length > 0, "expected source files to be discovered");
    const urlPattern = /https:\/\/([a-z0-9.-]+)/g;
    const offenders: string[] = [];
    for (const f of files) {
      // Strip comments before matching to avoid flagging doc/comment URLs
      const stripped = f.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const matches = stripped.matchAll(urlPattern);
      for (const m of matches) {
        const host = m[1]!;
        if (host !== "api.notion.com") offenders.push(`${f.path}: ${host}`);
      }
    }
    assert.equal(
      offenders.length,
      0,
      `Non-Notion URLs in source tree:\n${offenders.join("\n")}`,
    );
  });
});
