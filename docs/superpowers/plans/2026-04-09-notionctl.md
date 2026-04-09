# notionctl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `notionctl` v0.1.0 — a security-auditable, zero-runtime-dependency TypeScript CLI that reads and writes Notion pages, databases, and blocks via 28 discrete commands. Published to npm as the replacement for an MCP server in AI-assisted coding workflows. Spec: `docs/superpowers/specs/2026-04-09-notion-cli-design.md`.

**Architecture:** Single-package TypeScript project compiled with `tsc`. All network I/O funnels through one `http.ts` module; all secret handling lives in one `auth.ts`; content transformation (Markdown↔Notion blocks, property DSL) is pure and testable. Commands are thin dispatchers. Tests use Node's built-in `node:test` to honor the zero-dep constraint.

**Tech Stack:**
- TypeScript 5.x (the only dev dep)
- Node.js 18+ runtime (built-in `fetch`, `node:test`, `fs/promises`, `crypto`)
- No bundler, no test framework, no linter (typecheck via `tsc --noEmit` is our lint)
- npm for distribution

**Principles (in priority order):** Reliability, Security, Simplicity, Functionality (Reach), Preciseness. Every design decision traces back to these.

**Total tasks:** 37 across 20 phases. Expected hand-audited surface: ~3,500–4,000 lines of TypeScript.

---

## Phase 1 — Foundation

### Task 1: TypeScript project setup

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Update `package.json` with scripts, dev deps, Node engine, bin entry**

Replace the current `package.json` (which is the minimal reservation stub) with:

```json
{
  "name": "notionctl",
  "version": "0.1.0",
  "description": "Security-auditable, zero-dependency command-line interface for Notion, designed to be driven by AI coding agents via shell invocations.",
  "keywords": [
    "notion",
    "cli",
    "ai-agent",
    "copilot",
    "claude",
    "automation"
  ],
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "bin": {
    "notionctl": "./bin/notionctl.js"
  },
  "files": [
    "bin/",
    "dist/",
    "README.md",
    "LICENSE",
    "SECURITY.md"
  ],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "prebuild": "npm run clean",
    "test": "npm run build && node --test --test-reporter=spec dist/test/**/*.test.js",
    "test:unit": "npm run build && node --test dist/test/**/*.test.js",
    "test:security": "npm run build && node --test dist/test/security/*.test.js",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run typecheck && npm run test"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.11.0"
  }
}
```

Note: `@types/node` is also a dev dep (needed for TypeScript to know about `fetch`, `fs/promises`, `node:test`). This does not affect the zero-runtime-dependency promise — `devDependencies` are not installed by end users.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": false,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dev dependencies**

Run: `npm install`
Expected: `added 2 packages` (typescript, @types/node) with zero runtime dependencies.

- [ ] **Step 4: Verify typecheck works**

Run: `npm run typecheck`
Expected: No output (success) or errors about missing `src/` files — that's fine, we'll add them next.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json package-lock.json
git commit -m "scaffold typescript project (tsconfig, scripts, dev deps)"
```

---

### Task 2: `.gitignore` and directory scaffold

**Files:**
- Create: `.gitignore`
- Create: empty directory markers for `src/`, `test/`, `bin/`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# Build output
dist/

# Dependencies
node_modules/

# npm
*.tgz
.npmrc

# macOS
.DS_Store

# Editor
.vscode/
.idea/
*.swp
*.swo

# Logs
npm-debug.log*
*.log

# Local config
.env
.env.local
*.local

# Notion-specific: never commit tokens or sync state
notion-cli-config.json
```

- [ ] **Step 2: Create bin shim**

Create `bin/notionctl.js`:

```javascript
#!/usr/bin/env node
import('../dist/src/index.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Mark it executable:

```bash
chmod +x bin/notionctl.js
```

- [ ] **Step 3: Create placeholder `src/index.ts`** so build has something to compile

```typescript
// Entry point for notionctl. Command dispatch is wired up in Task 32.
console.error("notionctl: not yet implemented");
process.exit(1);
```

- [ ] **Step 4: Verify build produces `dist/src/index.js`**

Run: `npm run build`
Expected: `dist/src/index.js` exists. Run `node bin/notionctl.js` and expect `notionctl: not yet implemented` on stderr, exit code 1.

- [ ] **Step 5: Commit**

```bash
git add .gitignore bin/notionctl.js src/index.ts
git commit -m "add .gitignore, bin shim, src entrypoint stub"
```

---

### Task 3: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/integration.yml`

- [ ] **Step 1: Create unit-test CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:security
```

- [ ] **Step 2: Create integration-test workflow (nightly, secret token)**

`.github/workflows/integration.yml`:

```yaml
name: Integration Tests

on:
  schedule:
    - cron: '0 6 * * *'  # 06:00 UTC daily
  workflow_dispatch:

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run integration tests
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TEST_TOKEN }}
          NOTION_TEST_PAGE_ID: ${{ secrets.NOTION_TEST_PAGE_ID }}
          NOTION_TEST_DB_ID: ${{ secrets.NOTION_TEST_DB_ID }}
        run: node --test dist/test/integration/*.test.js
```

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "add CI workflows (unit tests + nightly integration)"
```

---

### Task 4: LICENSE and SECURITY.md

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`

- [ ] **Step 1: Create `LICENSE` with MIT text**

```
MIT License

Copyright (c) 2026 Artem Yerep

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `SECURITY.md`**

```markdown
# Security Policy

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Instead, report security issues privately via one of these channels:

- GitHub Security Advisory: https://github.com/chazyua/notionctl/security/advisories/new
- Email: [your-email@example.com]

We will acknowledge receipt within 72 hours and work with you to verify,
reproduce, and address the issue before any public disclosure.

## Security Posture

`notionctl` is designed with security as a primary concern:

- **Zero runtime dependencies.** Every line of network and secret-handling
  code is auditable in this repository.
- **Single file for network I/O** (`src/http.ts`). All outbound traffic
  goes through this file; it is hardcoded to `https://api.notion.com/v1`
  and refuses any other host.
- **Single file for secrets** (`src/auth.ts`). Tokens are loaded from
  `NOTION_TOKEN` environment variable or from a mode-0600 config file.
  They are never logged, never included in error messages, never in
  debug output.
- **No telemetry, no phone-home, no crash reporting.** The CLI's only
  outbound traffic is to `api.notion.com`. This is provable by grep.
- **Dry-run universal.** All write operations support `--dry-run` to
  preview what would be sent without sending it.
- **Reproducible releases.** Each published version's source SHA-256 is
  documented in `CHANGELOG.md` and matches the GitHub release tag.

## Scope

In-scope vulnerabilities include:
- Token leakage in logs, errors, or stdout/stderr
- Unauthorized filesystem writes
- Unauthorized network calls (anywhere other than `api.notion.com`)
- Command injection, path traversal, SSRF
- Dependency supply-chain issues (there are no runtime dependencies)

Out-of-scope:
- Issues in Notion's API itself (report to Notion)
- Issues in Node.js or npm (report upstream)
```

- [ ] **Step 3: Commit**

```bash
git add LICENSE SECURITY.md
git commit -m "add LICENSE (MIT) and SECURITY.md"
```

---

### Task 5: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create `CHANGELOG.md` following Keep-a-Changelog format**

```markdown
# Changelog

All notable changes to `notionctl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — TBD

### Added
- Initial implementation of 28 Notion CLI commands (`page`, `db`, `block`, `comment`, `user`, `auth`, and meta commands)
- Zero-runtime-dependency TypeScript codebase using Node 18+ built-ins
- Markdown ↔ Notion blocks round-trip converter with metadata sidecars
- Property value DSL covering all writable Notion property types
- Content-hashed `page sync` command for idempotent file-backed pages
- Raw REST escape hatch (`notionctl api <METHOD> <path>`)
- Structured error model with typed error codes and distinct exit codes
- `--dry-run` support on all write operations

## [0.0.1] — 2026-04-09

### Added
- Initial placeholder package to reserve the `notionctl` name on npm registry
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "add CHANGELOG (Keep-a-Changelog format)"
```

---

### Task 6: Verify foundation builds and lints cleanly

**Files:** none (verification task)

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: `dist/` populated with `src/index.js` compiled from `src/index.ts`.

- [ ] **Step 3: Smoke-test the bin entry**

Run: `./bin/notionctl.js`
Expected: stderr prints `notionctl: not yet implemented`, exit code 1.

- [ ] **Step 4: Verify git state is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 5: Tag the foundation milestone**

```bash
git tag -a foundation-complete -m "Phase 1 foundation complete"
```

---

## Phase 2 — Error model

### Task 7: `src/errors.ts` with typed error codes and exit codes

**Files:**
- Create: `src/errors.ts`
- Create: `test/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/errors.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NotionCliError,
  ErrorCode,
  EXIT_CODES,
  formatErrorJson,
  formatErrorHuman,
} from "../src/errors.js";

describe("NotionCliError", () => {
  it("constructs with code and message", () => {
    const err = new NotionCliError(ErrorCode.NOT_FOUND, "Page 'abc' not found");
    assert.equal(err.code, ErrorCode.NOT_FOUND);
    assert.equal(err.message, "Page 'abc' not found");
    assert.equal(err.exitCode, EXIT_CODES.NOT_FOUND);
  });

  it("accepts suggestions", () => {
    const err = new NotionCliError(
      ErrorCode.INVALID_PROPERTY,
      "Property 'Statuz' not found",
      { suggestions: ["Did you mean 'Status'?"] },
    );
    assert.deepEqual(err.suggestions, ["Did you mean 'Status'?"]);
  });

  it("maps every error code to an exit code", () => {
    for (const code of Object.values(ErrorCode)) {
      const err = new NotionCliError(code, "test");
      assert.ok(
        typeof err.exitCode === "number" && err.exitCode >= 1 && err.exitCode <= 9,
        `ErrorCode.${code} must map to a valid exit code, got ${err.exitCode}`,
      );
    }
  });
});

describe("formatErrorJson", () => {
  it("produces structured envelope", () => {
    const err = new NotionCliError(ErrorCode.AUTH_INVALID, "Bad token", {
      suggestions: ["Run 'notionctl auth set' to update"],
    });
    const json = JSON.parse(formatErrorJson(err));
    assert.deepEqual(json, {
      error: {
        code: "AUTH_INVALID",
        message: "Bad token",
        suggestions: ["Run 'notionctl auth set' to update"],
      },
    });
  });

  it("omits suggestions when not provided", () => {
    const err = new NotionCliError(ErrorCode.NETWORK_ERROR, "DNS failure");
    const json = JSON.parse(formatErrorJson(err));
    assert.deepEqual(json, {
      error: { code: "NETWORK_ERROR", message: "DNS failure" },
    });
  });

  it("never includes token-shaped strings in message", () => {
    // Defensive check: if someone ever constructs an error with a token
    // in the message (they shouldn't), the formatter must still scrub it.
    const err = new NotionCliError(
      ErrorCode.AUTH_INVALID,
      "Bad token ntn_1234567890abcdef",
    );
    const output = formatErrorJson(err);
    assert.ok(
      !output.includes("ntn_1234567890abcdef"),
      "Token-shaped string leaked into error output",
    );
  });
});

describe("formatErrorHuman", () => {
  it("formats with code prefix and suggestions", () => {
    const err = new NotionCliError(ErrorCode.NOT_FOUND, "Page 'xyz' not found", {
      suggestions: ["Check that the page is shared with the integration"],
    });
    const out = formatErrorHuman(err, { color: false });
    assert.match(out, /NOT_FOUND/);
    assert.match(out, /Page 'xyz' not found/);
    assert.match(out, /Check that the page is shared/);
  });

  it("scrubs token-shaped strings", () => {
    const err = new NotionCliError(
      ErrorCode.AUTH_INVALID,
      "Got ntn_abcdef123456 in response",
    );
    const out = formatErrorHuman(err, { color: false });
    assert.ok(!out.includes("ntn_abcdef123456"));
  });
});
```

- [ ] **Step 2: Run the test — it should fail**

Run: `npm run test -- --test-name-pattern="NotionCliError"`
Expected: FAIL with "Cannot find module '../src/errors.js'" or similar.

- [ ] **Step 3: Implement `src/errors.ts`**

```typescript
/**
 * Typed error model for notionctl.
 *
 * Every user-facing error flows through NotionCliError. The error carries:
 *   - a typed code (enum) for programmatic classification
 *   - a human message
 *   - optional suggestions for recovery
 *   - a distinct exit code so shell scripts can branch on failure mode
 *
 * This is the ONLY place exit codes are defined. Do not hardcode
 * process.exit(N) anywhere else in the codebase — throw a NotionCliError
 * and let index.ts handle the exit.
 */

export enum ErrorCode {
  GENERIC = "GENERIC",
  USAGE = "USAGE",
  AUTH_INVALID = "AUTH_INVALID",
  AUTH_MISSING = "AUTH_MISSING",
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RATE_LIMITED = "RATE_LIMITED",
  NETWORK_ERROR = "NETWORK_ERROR",
  API_ERROR = "API_ERROR",
  INVALID_PROPERTY = "INVALID_PROPERTY",
  INVALID_MARKDOWN = "INVALID_MARKDOWN",
  INVALID_FRONTMATTER = "INVALID_FRONTMATTER",
  SYNC_DRIFT = "SYNC_DRIFT",
  DATABASE_NOT_FOUND = "DATABASE_NOT_FOUND",
  PAGE_NOT_FOUND = "PAGE_NOT_FOUND",
  BLOCK_NOT_FOUND = "BLOCK_NOT_FOUND",
}

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  PERMISSION_DENIED: 5,
  RATE_LIMITED: 6,
  NETWORK_ERROR: 7,
  API_ERROR: 8,
  VALIDATION: 9,
} as const;

const CODE_TO_EXIT: Record<ErrorCode, number> = {
  [ErrorCode.GENERIC]: EXIT_CODES.GENERIC,
  [ErrorCode.USAGE]: EXIT_CODES.USAGE,
  [ErrorCode.AUTH_INVALID]: EXIT_CODES.AUTH,
  [ErrorCode.AUTH_MISSING]: EXIT_CODES.AUTH,
  [ErrorCode.NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.DATABASE_NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.PAGE_NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.BLOCK_NOT_FOUND]: EXIT_CODES.NOT_FOUND,
  [ErrorCode.PERMISSION_DENIED]: EXIT_CODES.PERMISSION_DENIED,
  [ErrorCode.RATE_LIMITED]: EXIT_CODES.RATE_LIMITED,
  [ErrorCode.NETWORK_ERROR]: EXIT_CODES.NETWORK_ERROR,
  [ErrorCode.API_ERROR]: EXIT_CODES.API_ERROR,
  [ErrorCode.INVALID_PROPERTY]: EXIT_CODES.VALIDATION,
  [ErrorCode.INVALID_MARKDOWN]: EXIT_CODES.VALIDATION,
  [ErrorCode.INVALID_FRONTMATTER]: EXIT_CODES.VALIDATION,
  [ErrorCode.SYNC_DRIFT]: EXIT_CODES.VALIDATION,
};

export interface NotionCliErrorOptions {
  suggestions?: string[];
  cause?: unknown;
}

export class NotionCliError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string, opts: NotionCliErrorOptions = {}) {
    super(message);
    this.name = "NotionCliError";
    this.code = code;
    this.suggestions = opts.suggestions ?? [];
    this.exitCode = CODE_TO_EXIT[code];
    if (opts.cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = opts.cause;
    }
  }
}

/**
 * Regex that matches Notion's integration token format.
 * Used defensively to scrub tokens from error output if they ever
 * leak into a message (which they should never do — http.ts is the
 * only file with token access).
 */
const TOKEN_PATTERN = /ntn_[a-zA-Z0-9]{10,}/g;
const LEGACY_SECRET_PATTERN = /secret_[a-zA-Z0-9]{30,}/g;

function scrub(text: string): string {
  return text.replace(TOKEN_PATTERN, "ntn_***").replace(LEGACY_SECRET_PATTERN, "secret_***");
}

export function formatErrorJson(err: NotionCliError): string {
  const body: { code: string; message: string; suggestions?: string[] } = {
    code: err.code,
    message: scrub(err.message),
  };
  if (err.suggestions.length > 0) {
    body.suggestions = err.suggestions.map(scrub);
  }
  return JSON.stringify({ error: body });
}

export interface HumanFormatOptions {
  color?: boolean;
}

export function formatErrorHuman(err: NotionCliError, opts: HumanFormatOptions = {}): string {
  const useColor = opts.color ?? false;
  const red = useColor ? "\x1b[31m" : "";
  const bold = useColor ? "\x1b[1m" : "";
  const dim = useColor ? "\x1b[2m" : "";
  const reset = useColor ? "\x1b[0m" : "";

  const lines: string[] = [];
  lines.push(`${red}${bold}error${reset} [${err.code}]: ${scrub(err.message)}`);

  if (err.suggestions.length > 0) {
    lines.push("");
    lines.push(`${dim}suggestions:${reset}`);
    for (const s of err.suggestions) {
      lines.push(`  - ${scrub(s)}`);
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests — they should now pass**

Run: `npm run test -- --test-name-pattern="NotionCliError|formatError"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "add typed error model with scrubbing and exit codes"
```

---

## Phase 3 — Auth

### Task 8: `src/auth.ts` with env + config file loading

**Files:**
- Create: `src/auth.ts`
- Create: `test/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/auth.test.ts`:

```typescript
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, stat } from "node:fs/promises";
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
```

- [ ] **Step 2: Run the test — it should fail**

Run: `npm run test -- --test-name-pattern="auth"`
Expected: FAIL with "Cannot find module '../src/auth.js'".

- [ ] **Step 3: Implement `src/auth.ts`**

```typescript
/**
 * Auth module — the ONLY file in the codebase that reads or writes the
 * Notion integration token. All other modules must receive the token via
 * http.ts, which calls loadToken() exactly once per process invocation.
 *
 * Security properties:
 *   - Token never touches a log, error message, or stdout/stderr
 *   - Config file is created at mode 0600, parent dir at 0700
 *   - loadToken() refuses to read a config file with permissive mode
 *   - XDG_CONFIG_HOME is respected, fallback to ~/.config
 *   - Token source preference: env var > config file > error
 */

import { readFile, writeFile, mkdir, rm, stat, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { NotionCliError, ErrorCode } from "./errors.js";

export enum AuthSource {
  ENV = "env",
  CONFIG_FILE = "config-file",
}

export interface LoadedToken {
  token: string;
  source: AuthSource;
}

const ENV_VAR = "NOTION_TOKEN";
const CONFIG_FILENAME = "config.json";
const CONFIG_SUBDIR = "notion-cli";

interface ConfigFile {
  token: string;
}

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_SUBDIR);
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILENAME);
}

export async function loadToken(): Promise<LoadedToken> {
  // 1) environment variable takes precedence
  const envToken = process.env[ENV_VAR];
  if (envToken && envToken.length > 0) {
    return { token: envToken, source: AuthSource.ENV };
  }

  // 2) config file fallback
  const path = getConfigPath();
  let raw: string;
  try {
    const st = await stat(path);
    const mode = st.mode & 0o777;
    if (mode !== 0o600) {
      throw new NotionCliError(
        ErrorCode.AUTH_INVALID,
        `Config file ${path} has insecure permissions (mode ${mode.toString(8)}, expected 600)`,
        {
          suggestions: [
            `Run: chmod 600 ${path}`,
            "Or delete it and re-run 'notionctl auth set' to recreate with correct permissions.",
          ],
        },
      );
    }
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof NotionCliError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotionCliError(
        ErrorCode.AUTH_MISSING,
        "No Notion token configured.",
        {
          suggestions: [
            `Set NOTION_TOKEN environment variable, or`,
            `Run 'notionctl auth set' to store a token in ${path}`,
          ],
        },
      );
    }
    throw new NotionCliError(
      ErrorCode.AUTH_INVALID,
      `Failed to read config file ${path}`,
      { cause: err },
    );
  }

  let parsed: ConfigFile;
  try {
    parsed = JSON.parse(raw) as ConfigFile;
  } catch (err) {
    throw new NotionCliError(
      ErrorCode.AUTH_INVALID,
      `Config file ${path} is not valid JSON`,
      { cause: err },
    );
  }

  if (!parsed.token || typeof parsed.token !== "string") {
    throw new NotionCliError(
      ErrorCode.AUTH_INVALID,
      `Config file ${path} does not contain a 'token' field`,
    );
  }

  return { token: parsed.token, source: AuthSource.CONFIG_FILE };
}

export async function saveToken(token: string): Promise<void> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to save empty token");
  }

  const dir = getConfigDir();
  const path = getConfigPath();

  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Ensure existing dir is tightened (mkdir recursive does not set mode on existing)
  await chmod(dir, 0o700).catch(() => undefined);

  const body = JSON.stringify({ token } satisfies ConfigFile, null, 2) + "\n";
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function clearToken(): Promise<void> {
  const path = getConfigPath();
  await rm(path, { force: true });
}
```

- [ ] **Step 4: Run the tests — they should now pass**

Run: `npm run test -- --test-name-pattern="auth"`
Expected: all tests pass. If the permissive-mode test fails on Windows (where POSIX mode handling differs), add a platform guard.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "add auth module: env + config file loading with 0600 perms"
```

---

## Phase 4 — HTTP layer

This is the single most-audited file in the project. All outbound network traffic passes through `src/http.ts`. It is split across three tasks so reviewers can follow the reasoning.

### Task 9: `src/http.ts` base client with URL enforcement

**Files:**
- Create: `src/http.ts`
- Create: `test/http.test.ts`

- [ ] **Step 1: Write failing tests for the base client**

Create `test/http.test.ts`:

```typescript
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { notionRequest, setTokenProvider, resetForTesting } from "../src/http.js";
import { NotionCliError, ErrorCode } from "../src/errors.js";

describe("http.ts base client", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({
      token: "ntn_test_token",
      source: "env" as const,
    }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("sends request to api.notion.com with Bearer header and Notion-Version", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedHeaders = Object.fromEntries(new Headers(init?.headers ?? {}));
      return new Response(JSON.stringify({ object: "user", id: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await notionRequest("GET", "/users/me");

    assert.equal(capturedUrl, "https://api.notion.com/v1/users/me");
    assert.equal(capturedHeaders["authorization"], "Bearer ntn_test_token");
    assert.equal(capturedHeaders["notion-version"], "2022-06-28");
    assert.match(capturedHeaders["user-agent"] ?? "", /^notionctl\//);
    assert.deepEqual(result, { object: "user", id: "abc" });
  });

  it("serializes body as JSON on POST/PATCH", async () => {
    let capturedBody = "";
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await notionRequest("POST", "/pages", { parent: { page_id: "abc" } });
    assert.equal(capturedBody, JSON.stringify({ parent: { page_id: "abc" } }));
  });

  it("throws NETWORK_ERROR on fetch rejection", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/users/me"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.NETWORK_ERROR);
        return true;
      },
    );
  });

  it("maps 401 to AUTH_INVALID", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ object: "error", code: "unauthorized", message: "Invalid token" }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/users/me"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.AUTH_INVALID);
        return true;
      },
    );
  });

  it("maps 404 to NOT_FOUND", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ object: "error", code: "object_not_found", message: "Not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/pages/missing"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.NOT_FOUND);
        return true;
      },
    );
  });

  it("maps 403 to PERMISSION_DENIED", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({ object: "error", code: "restricted_resource", message: "Not shared" }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/pages/restricted"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        assert.equal((err as NotionCliError).code, ErrorCode.PERMISSION_DENIED);
        return true;
      },
    );
  });

  it("refuses absolute URLs as path (prevents host override)", async () => {
    await assert.rejects(
      async () => notionRequest("GET", "https://evil.com/exfil"),
      (err: unknown) => {
        assert.ok(err instanceof NotionCliError);
        return true;
      },
    );
  });

  it("never logs or returns the token in error messages", async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({ object: "error", message: "Bad" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    try {
      await notionRequest("GET", "/users/me");
      assert.fail("expected error");
    } catch (err) {
      assert.ok(err instanceof NotionCliError);
      assert.ok(!err.message.includes("ntn_test_token"));
    }
  });
});
```

- [ ] **Step 2: Run the test — it should fail**

Run: `npm run test -- --test-name-pattern="http.ts"`
Expected: FAIL with "Cannot find module '../src/http.js'".

- [ ] **Step 3: Implement the base HTTP client**

Create `src/http.ts`:

```typescript
/**
 * http.ts — The single file in the codebase that makes network calls.
 *
 * Every command module calls notionRequest() and nothing else for I/O.
 * Base URL is hardcoded to https://api.notion.com/v1 — there is no flag
 * to override it (that would be a token-exfiltration footgun).
 *
 * Security properties:
 *   - Only https://api.notion.com is reachable from this module
 *   - The token is loaded once via a pluggable provider (auth.ts in prod,
 *     mocks in tests) and attached to the Authorization header
 *   - The token is never included in thrown errors or log output
 *   - Retries are deterministic: same inputs + same transient errors
 *     produce the same retry sequence
 *
 * This file is split across Tasks 9, 10, and 11 — read them together
 * when reviewing.
 */

import { loadToken, type LoadedToken } from "./auth.js";
import { NotionCliError, ErrorCode } from "./errors.js";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = "notionctl/0.1.0";  // TODO: read from package.json at build time

type TokenProvider = () => Promise<LoadedToken>;

let tokenProvider: TokenProvider = loadToken;
let cachedToken: string | undefined;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
  cachedToken = undefined;
}

export function resetForTesting(): void {
  tokenProvider = loadToken;
  cachedToken = undefined;
}

async function getToken(): Promise<string> {
  if (cachedToken !== undefined) return cachedToken;
  const loaded = await tokenProvider();
  cachedToken = loaded.token;
  return cachedToken;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export async function notionRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `notionRequest path must be a relative API path (got: ${path})`,
    );
  }
  if (!path.startsWith("/")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `notionRequest path must start with '/' (got: ${path})`,
    );
  }

  const url = `${API_BASE}${path}`;
  if (!url.startsWith("https://api.notion.com/")) {
    throw new NotionCliError(
      ErrorCode.GENERIC,
      "Internal error: computed URL escaped api.notion.com base",
    );
  }

  const token = await getToken();
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "User-Agent": USER_AGENT,
  };

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const timeoutMs = parseTimeoutEnv() ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new NotionCliError(
        ErrorCode.NETWORK_ERROR,
        `Request to ${path} timed out after ${timeoutMs}ms`,
      );
    }
    throw new NotionCliError(
      ErrorCode.NETWORK_ERROR,
      `Network error calling ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }

  return parseResponse<T>(response, path);
}

async function parseResponse<T>(response: Response, path: string): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let apiMessage = `HTTP ${response.status}`;
  try {
    const errBody = (await response.json()) as { code?: string; message?: string };
    if (errBody.message) apiMessage = errBody.message;
  } catch {
    // non-JSON error body, fall through with status code only
  }

  const code = mapStatusToErrorCode(response.status);
  throw new NotionCliError(code, `${path}: ${apiMessage}`);
}

function mapStatusToErrorCode(status: number): ErrorCode {
  if (status === 401) return ErrorCode.AUTH_INVALID;
  if (status === 403) return ErrorCode.PERMISSION_DENIED;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  if (status >= 500) return ErrorCode.API_ERROR;
  return ErrorCode.API_ERROR;
}

function parseTimeoutEnv(): number | undefined {
  const raw = process.env.NOTION_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
```

- [ ] **Step 4: Run the tests — they should pass**

Run: `npm run test -- --test-name-pattern="http.ts"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/http.ts test/http.test.ts
git commit -m "add http base client with url enforcement and error mapping"
```

---

### Task 10: Retry + rate-limit handling

**Files:**
- Modify: `src/http.ts`
- Modify: `test/http.test.ts`

- [ ] **Step 1: Write failing tests for retries**

Append to `test/http.test.ts`:

```typescript
describe("http.ts retries", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_retry_test", source: "env" as const }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("retries on 429 with exponential backoff", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      if (attempts < 3) {
        return new Response("", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await notionRequest("GET", "/users/me");
    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 3);
  });

  it("retries on 5xx up to max attempts then throws", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      return new Response("", { status: 503 });
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => notionRequest("GET", "/users/me"),
      (err: unknown) => err instanceof NotionCliError,
    );
    assert.equal(attempts, 5, "expected 5 attempts (1 initial + 4 retries)");
  });

  it("does not retry on 4xx other than 429", async () => {
    let attempts = 0;
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      return new Response(JSON.stringify({ message: "bad" }), { status: 400 });
    }) as typeof globalThis.fetch;

    await assert.rejects(async () => notionRequest("GET", "/users/me"));
    assert.equal(attempts, 1);
  });

  it("respects Retry-After header", async () => {
    let attempts = 0;
    const timings: number[] = [];
    let last = Date.now();
    globalThis.fetch = mock.fn(async () => {
      attempts++;
      timings.push(Date.now() - last);
      last = Date.now();
      if (attempts < 2) {
        return new Response("", { status: 429, headers: { "retry-after": "1" } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await notionRequest("GET", "/users/me");
    // Second attempt should be at least ~1000ms after first
    assert.ok(timings[1] >= 900, `retry-after not honored (gap: ${timings[1]}ms)`);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="retries"`
Expected: FAIL — currently the client does not retry.

- [ ] **Step 3: Add retry logic to `src/http.ts`**

Modify `notionRequest` to loop with backoff. Add this retry constants block near the top:

```typescript
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000] as const;

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Replace the body of `notionRequest` (the section from `let response: Response;` through `return parseResponse<T>(response, path);`) with a retry loop:

```typescript
  let response: Response | undefined;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    init.signal = controller.signal;

    try {
      response = await fetch(url, init);
    } catch (err) {
      clearTimeout(timer);
      lastError = err as Error;
      if ((err as Error).name === "AbortError") {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new NotionCliError(
            ErrorCode.NETWORK_ERROR,
            `Request to ${path} timed out after ${timeoutMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          );
        }
      } else {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new NotionCliError(
            ErrorCode.NETWORK_ERROR,
            `Network error calling ${path}: ${(err as Error).message}`,
            { cause: err },
          );
        }
      }
      await sleep(BACKOFF_MS[attempt] ?? 4000);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (!shouldRetry(response.status)) {
      return parseResponse<T>(response, path);
    }

    if (attempt === MAX_ATTEMPTS - 1) {
      return parseResponse<T>(response, path);
    }

    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    const backoff = retryAfterMs && Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : (BACKOFF_MS[attempt] ?? 4000);
    await sleep(backoff);
  }

  // Should be unreachable — the loop always returns or throws.
  throw new NotionCliError(
    ErrorCode.GENERIC,
    `Internal error: retry loop exhausted without resolution (${lastError?.message ?? "unknown"})`,
  );
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="http.ts"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/http.ts test/http.test.ts
git commit -m "add retry logic with exponential backoff and retry-after support"
```

---

### Task 11: Transparent pagination

**Files:**
- Modify: `src/http.ts`
- Modify: `test/http.test.ts`

- [ ] **Step 1: Write failing tests for pagination**

Append to `test/http.test.ts`:

```typescript
describe("http.ts pagination", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
    setTokenProvider(async () => ({ token: "ntn_page_test", source: "env" as const }));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    resetForTesting();
  });

  it("auto-paginates when response has has_more: true", async () => {
    let call = 0;
    globalThis.fetch = mock.fn(async (url: string | URL) => {
      call++;
      const u = typeof url === "string" ? url : url.toString();
      if (call === 1) {
        assert.ok(!u.includes("start_cursor"));
        return new Response(
          JSON.stringify({
            object: "list",
            results: [{ id: "1" }, { id: "2" }],
            has_more: true,
            next_cursor: "cursor-a",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (call === 2) {
        assert.ok(u.includes("start_cursor=cursor-a"));
        return new Response(
          JSON.stringify({
            object: "list",
            results: [{ id: "3" }],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("unexpected extra call");
    }) as typeof globalThis.fetch;

    const result = await notionRequest<{ object: string; results: Array<{ id: string }> }>(
      "GET",
      "/databases/abc/query",
    );
    assert.equal(result.results.length, 3);
    assert.deepEqual(result.results.map((r) => r.id), ["1", "2", "3"]);
  });

  it("passes start_cursor via POST body for database queries", async () => {
    const capturedBodies: string[] = [];
    let call = 0;
    globalThis.fetch = mock.fn(async (_url: string | URL, init?: RequestInit) => {
      call++;
      capturedBodies.push((init?.body as string) ?? "");
      if (call === 1) {
        return new Response(
          JSON.stringify({
            object: "list",
            results: [{ id: "1" }],
            has_more: true,
            next_cursor: "cursor-b",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          object: "list",
          results: [{ id: "2" }],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await notionRequest<{ results: Array<{ id: string }> }>(
      "POST",
      "/databases/abc/query",
      { filter: { property: "Status", select: { equals: "Done" } } },
    );

    assert.equal(capturedBodies.length, 2);
    const secondBody = JSON.parse(capturedBodies[1]!) as { start_cursor?: string };
    assert.equal(secondBody.start_cursor, "cursor-b");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="pagination"`
Expected: FAIL — pagination not yet implemented.

- [ ] **Step 3: Add pagination wrapping**

In `src/http.ts`, rename the existing `notionRequest` to `notionRequestSingle` (internal) and add a new `notionRequest` that wraps it with pagination:

```typescript
interface PaginatedResponse<T> {
  object: "list";
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

function isPaginated(body: unknown): body is PaginatedResponse<unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as PaginatedResponse<unknown>).object === "list" &&
    Array.isArray((body as PaginatedResponse<unknown>).results) &&
    typeof (body as PaginatedResponse<unknown>).has_more === "boolean"
  );
}

export async function notionRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts: { maxPages?: number } = {},
): Promise<T> {
  const first = await notionRequestSingle<T>(method, path, body);
  if (!isPaginated(first)) return first;

  const maxPages = opts.maxPages ?? Infinity;
  const allResults: unknown[] = [...first.results];
  let cursor = first.has_more ? first.next_cursor : null;
  let page = 1;

  while (cursor && page < maxPages) {
    const nextBody = method === "POST" && body && typeof body === "object"
      ? { ...(body as object), start_cursor: cursor }
      : undefined;
    const nextPath = method === "GET"
      ? appendQuery(path, "start_cursor", cursor)
      : path;

    const next = await notionRequestSingle<PaginatedResponse<unknown>>(
      method,
      nextPath,
      nextBody,
    );
    allResults.push(...next.results);
    cursor = next.has_more ? next.next_cursor : null;
    page++;
  }

  return { ...first, results: allResults, has_more: false, next_cursor: null } as T;
}

function appendQuery(path: string, key: string, value: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
```

Rename the existing exported `notionRequest` to `notionRequestSingle` and make it no longer exported (just `async function notionRequestSingle<T>(...)`).

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="http.ts"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/http.ts test/http.test.ts
git commit -m "add transparent pagination with start_cursor for GET and POST"
```

---

## Phase 5 — Output formatting

### Task 12: `src/output.ts` with TTY detection and format switching

**Files:**
- Create: `src/output.ts`
- Create: `test/output.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/output.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chooseFormat,
  renderJson,
  renderTable,
  renderMarkdown,
  Format,
} from "../src/output.js";

describe("output.chooseFormat", () => {
  it("honors explicit --format when provided", () => {
    assert.equal(chooseFormat("json", { isTty: true, defaultFormat: "table" }), "json");
    assert.equal(chooseFormat("md", { isTty: false, defaultFormat: "json" }), "md");
  });

  it("uses default when TTY and no explicit format", () => {
    assert.equal(chooseFormat(undefined, { isTty: true, defaultFormat: "table" }), "table");
    assert.equal(chooseFormat(undefined, { isTty: true, defaultFormat: "md" }), "md");
  });

  it("forces JSON when piped (non-TTY)", () => {
    assert.equal(chooseFormat(undefined, { isTty: false, defaultFormat: "table" }), "json");
    assert.equal(chooseFormat(undefined, { isTty: false, defaultFormat: "md" }), "md");
    // md stays md because it's machine-readable for our use
  });
});

describe("output.renderJson", () => {
  it("produces pretty-printed JSON with 2-space indent", () => {
    const out = renderJson({ id: "abc", name: "Test" });
    assert.equal(out, '{\n  "id": "abc",\n  "name": "Test"\n}');
  });
});

describe("output.renderTable", () => {
  it("renders rows as aligned table", () => {
    const out = renderTable({
      columns: ["ID", "Name"],
      rows: [
        ["abc-12", "Alpha"],
        ["xyz-34", "Bravo bravo"],
      ],
    });
    const lines = out.split("\n");
    assert.equal(lines.length, 4);  // header, separator, 2 rows
    assert.match(lines[0]!, /ID\s+Name/);
    assert.match(lines[2]!, /abc-12\s+Alpha/);
    assert.match(lines[3]!, /xyz-34\s+Bravo bravo/);
  });

  it("handles empty rows", () => {
    const out = renderTable({ columns: ["A", "B"], rows: [] });
    const lines = out.split("\n");
    assert.equal(lines.length, 2);  // header + separator only
  });
});

describe("output.renderMarkdown", () => {
  it("passes through markdown content unchanged", () => {
    const md = "# Heading\n\nSome **bold** text.";
    assert.equal(renderMarkdown(md), md);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="output"`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/output.ts`**

```typescript
/**
 * Output formatting and TTY detection.
 *
 * Rule: when stdout is a TTY, commands emit pretty output (tables, colored
 * text, human status lines). When piped, commands emit machine-parseable
 * output (JSON by default, md for commands where md is the natural form).
 *
 * Individual commands declare their default format. If --format is passed
 * explicitly, it wins. If stdout is piped and default is "table", we
 * coerce to JSON so scripts never receive ANSI-decorated text.
 */

export type Format = "md" | "json" | "table" | "csv";

export interface ChooseFormatOpts {
  isTty: boolean;
  defaultFormat: Format;
}

export function chooseFormat(
  explicit: Format | undefined,
  opts: ChooseFormatOpts,
): Format {
  if (explicit !== undefined) return explicit;
  if (!opts.isTty && opts.defaultFormat === "table") return "json";
  return opts.defaultFormat;
}

export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export interface TableInput {
  columns: string[];
  rows: string[][];
}

export function renderTable(input: TableInput): string {
  const widths = input.columns.map((col, i) => {
    let w = col.length;
    for (const row of input.rows) {
      const cell = row[i] ?? "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ").trimEnd();

  const lines: string[] = [];
  lines.push(renderRow(input.columns));
  lines.push(widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of input.rows) {
    lines.push(renderRow(row));
  }
  return lines.join("\n");
}

export function renderMarkdown(content: string): string {
  return content;
}

export function renderCsv(input: TableInput): string {
  const esc = (v: string): string => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines: string[] = [];
  lines.push(input.columns.map(esc).join(","));
  for (const row of input.rows) {
    lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}

export function isStdoutTty(): boolean {
  return Boolean(process.stdout.isTTY);
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="output"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/output.ts test/output.test.ts
git commit -m "add output formatting: format switching, tables, json, csv"
```

---

## Phase 6 — YAML utility (minimal subset)

### Task 13: `src/utils/yaml.ts` — minimal YAML read/write

We need only a subset of YAML: strings (quoted and unquoted), numbers, booleans, ISO dates, and flow sequences `[a, b, c]`. No anchors, no block scalars, no custom tags. Writing our own keeps the zero-dep promise.

**Files:**
- Create: `src/utils/yaml.ts`
- Create: `test/utils/yaml.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/utils/yaml.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseYaml, stringifyYaml } from "../../src/utils/yaml.js";

describe("parseYaml", () => {
  it("parses simple key-value strings", () => {
    assert.deepEqual(parseYaml("key: value"), { key: "value" });
  });

  it("parses quoted strings", () => {
    assert.deepEqual(
      parseYaml('key: "with spaces and: colons"'),
      { key: "with spaces and: colons" },
    );
  });

  it("parses numbers", () => {
    assert.deepEqual(parseYaml("count: 42"), { count: 42 });
    assert.deepEqual(parseYaml("ratio: 3.14"), { ratio: 3.14 });
  });

  it("parses booleans", () => {
    assert.deepEqual(parseYaml("done: true"), { done: true });
    assert.deepEqual(parseYaml("done: false"), { done: false });
  });

  it("parses null values", () => {
    assert.deepEqual(parseYaml("x: null"), { x: null });
    assert.deepEqual(parseYaml("x: ~"), { x: null });
  });

  it("parses flow sequences", () => {
    assert.deepEqual(parseYaml("tags: [a, b, c]"), { tags: ["a", "b", "c"] });
  });

  it("parses flow sequences with quoted items", () => {
    assert.deepEqual(
      parseYaml('tags: ["has, comma", plain, "with space"]'),
      { tags: ["has, comma", "plain", "with space"] },
    );
  });

  it("parses ISO dates as strings (preserves original format)", () => {
    assert.deepEqual(parseYaml("due: 2026-04-15"), { due: "2026-04-15" });
    assert.deepEqual(
      parseYaml("due: 2026-04-15T10:00:00Z"),
      { due: "2026-04-15T10:00:00Z" },
    );
  });

  it("parses multiple key-value pairs", () => {
    const input = "title: Hello\ncount: 3\ntags: [x, y]";
    assert.deepEqual(parseYaml(input), {
      title: "Hello",
      count: 3,
      tags: ["x", "y"],
    });
  });

  it("ignores empty lines and comments", () => {
    const input = "# top comment\ntitle: Hello\n\n# middle\ncount: 3";
    assert.deepEqual(parseYaml(input), { title: "Hello", count: 3 });
  });

  it("preserves unrecognized string values as strings", () => {
    assert.deepEqual(parseYaml('status: "In Progress"'), { status: "In Progress" });
    assert.deepEqual(parseYaml("status: In Progress"), { status: "In Progress" });
  });
});

describe("stringifyYaml", () => {
  it("writes simple key-value", () => {
    assert.equal(stringifyYaml({ key: "value" }), "key: value");
  });

  it("quotes strings with special characters", () => {
    assert.equal(
      stringifyYaml({ key: "value: with colon" }),
      'key: "value: with colon"',
    );
  });

  it("quotes strings starting with YAML special characters", () => {
    assert.equal(stringifyYaml({ key: "[not a list]" }), 'key: "[not a list]"');
  });

  it("writes numbers and booleans unquoted", () => {
    assert.equal(stringifyYaml({ count: 42, done: true }), "count: 42\ndone: true");
  });

  it("writes null values", () => {
    assert.equal(stringifyYaml({ x: null }), "x: null");
  });

  it("writes arrays as flow sequences", () => {
    assert.equal(stringifyYaml({ tags: ["a", "b"] }), "tags: [a, b]");
  });

  it("quotes array items with special characters", () => {
    assert.equal(
      stringifyYaml({ tags: ["has, comma", "plain"] }),
      'tags: ["has, comma", plain]',
    );
  });

  it("round-trips structured input", () => {
    const input = {
      title: "Implement auth",
      count: 8,
      done: false,
      tags: ["backend", "security"],
      due: "2026-04-15",
    };
    const yaml = stringifyYaml(input);
    const parsed = parseYaml(yaml);
    assert.deepEqual(parsed, input);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="YAML|Yaml|yaml"`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/utils/yaml.ts`**

```typescript
/**
 * Minimal YAML reader/writer.
 *
 * Supports only the subset needed for notionctl front-matter:
 *   - strings (quoted and unquoted)
 *   - numbers (int and float)
 *   - booleans (true, false)
 *   - null (null, ~)
 *   - flow sequences: [a, b, "c with, comma"]
 *
 * Does NOT support:
 *   - block sequences (- item)
 *   - nested maps
 *   - anchors and aliases
 *   - multi-line strings (| or >)
 *   - custom tags (!!str, etc.)
 *
 * This is deliberate: the front-matter schema we use is flat key-value
 * with simple types, and a full YAML parser is 2000+ lines we don't need.
 * If a future feature needs nested structures, widen this module with
 * dedicated tests rather than pulling in a dependency.
 */

export type YamlValue = string | number | boolean | null | string[];
export type YamlObject = Record<string, YamlValue>;

export function parseYaml(input: string): YamlObject {
  const result: YamlObject = {};
  const lines = input.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    if (line.trimStart().startsWith("#")) continue;

    const colonIdx = findUnquotedColon(line);
    if (colonIdx === -1) {
      throw new Error(`Invalid YAML line (no key): ${rawLine}`);
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    result[key] = parseValue(rawValue);
  }

  return result;
}

function findUnquotedColon(line: string): number {
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === quoteChar && line[i - 1] !== "\\") {
        inQuote = false;
      }
    } else {
      if (c === '"' || c === "'") {
        inQuote = true;
        quoteChar = c;
      } else if (c === ":") {
        return i;
      }
    }
  }
  return -1;
}

function parseValue(raw: string): YamlValue {
  if (raw.length === 0) return "";
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  // Flow sequence
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return parseFlowSequence(raw.slice(1, -1));
  }

  // Number (integer or float), but not ISO dates which also match digits
  if (/^-?\d+(\.\d+)?$/.test(raw) && !isIsoDateLike(raw)) {
    return Number(raw);
  }

  // Unquoted string — return as-is
  return raw;
}

function isIsoDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function parseFlowSequence(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let depth = 0;

  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inQuote) {
      if (c === quoteChar && inner[i - 1] !== "\\") {
        inQuote = false;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c!;
      continue;
    }
    if (c === "[") {
      depth++;
      current += c;
      continue;
    }
    if (c === "]") {
      depth--;
      current += c;
      continue;
    }
    if (c === "," && depth === 0) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) {
    items.push(current.trim());
  }
  return items;
}

export function stringifyYaml(obj: YamlObject): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  return lines.join("\n");
}

function serializeValue(value: YamlValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(serializeScalarForArray).join(", ") + "]";
  }
  return serializeString(value);
}

function serializeString(s: string): string {
  if (s.length === 0) return '""';
  if (needsQuoting(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function serializeScalarForArray(s: string): string {
  if (needsQuoting(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function needsQuoting(s: string): boolean {
  if (s.length === 0) return true;
  if (/[,:#\[\]{}]/.test(s)) return true;
  if (s.trim() !== s) return true;
  if (/^(true|false|null|~)$/i.test(s)) return true;
  if (/^-?\d/.test(s) && !/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  return false;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="YAML|Yaml|yaml"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/yaml.ts test/utils/yaml.test.ts
git commit -m "add minimal YAML subset reader and writer"
```

---

## Phase 7 — Markdown types and rich-text tokenizer

This phase establishes the data shapes and the trickiest piece of the markdown converter: the rich-text tokenizer. Once the tokenizer is right, the block-level read/write in Phases 8–9 become straightforward.

### Task 14: `src/markdown/types.ts` — block and rich-text types

**Files:**
- Create: `src/markdown/types.ts`

- [ ] **Step 1: Create the types module**

```typescript
/**
 * Type definitions mirroring Notion's block and rich-text API shapes,
 * plus our internal intermediate representations used by the converter.
 *
 * We don't import from any Notion SDK — these are hand-rolled to match
 * the REST API as documented at https://developers.notion.com/reference.
 * Pinning to API version 2022-06-28 (see http.ts).
 */

// ---------- Rich Text ----------

export interface Annotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;  // "default" | "gray" | ... | "red_background" | ...
}

export const DEFAULT_ANNOTATIONS: Annotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default",
};

export interface TextRichText {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export interface MentionRichText {
  type: "mention";
  mention:
    | { type: "user"; user: { id: string } }
    | { type: "page"; page: { id: string } }
    | { type: "database"; database: { id: string } }
    | { type: "date"; date: { start: string; end: string | null; time_zone: string | null } }
    | { type: "link_preview"; link_preview: { url: string } };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export interface EquationRichText {
  type: "equation";
  equation: { expression: string };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export type RichText = TextRichText | MentionRichText | EquationRichText;

// ---------- Blocks ----------

export type BlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "code"
  | "divider"
  | "callout"
  | "table"
  | "table_row"
  | "equation"
  | "bookmark"
  | "link_preview"
  | "image"
  | "video"
  | "file"
  | "pdf"
  | "child_page"
  | "child_database"
  | "embed"
  | "synced_block"
  | "column_list"
  | "column"
  | "table_of_contents"
  | "breadcrumb"
  | "unsupported";

export interface BaseBlock {
  object: "block";
  id: string;
  parent?: { type: string; page_id?: string; database_id?: string; block_id?: string };
  type: BlockType;
  created_time?: string;
  last_edited_time?: string;
  has_children: boolean;
  archived?: boolean;
}

export interface ParagraphBlock extends BaseBlock {
  type: "paragraph";
  paragraph: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface HeadingBlock extends BaseBlock {
  type: "heading_1" | "heading_2" | "heading_3";
  heading_1?: { rich_text: RichText[]; color: string; is_toggleable: boolean; children?: Block[] };
  heading_2?: { rich_text: RichText[]; color: string; is_toggleable: boolean; children?: Block[] };
  heading_3?: { rich_text: RichText[]; color: string; is_toggleable: boolean; children?: Block[] };
}

export interface ListItemBlock extends BaseBlock {
  type: "bulleted_list_item" | "numbered_list_item";
  bulleted_list_item?: { rich_text: RichText[]; color: string; children?: Block[] };
  numbered_list_item?: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface ToDoBlock extends BaseBlock {
  type: "to_do";
  to_do: { rich_text: RichText[]; checked: boolean; color: string; children?: Block[] };
}

export interface ToggleBlock extends BaseBlock {
  type: "toggle";
  toggle: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface QuoteBlock extends BaseBlock {
  type: "quote";
  quote: { rich_text: RichText[]; color: string; children?: Block[] };
}

export interface CodeBlock extends BaseBlock {
  type: "code";
  code: { rich_text: RichText[]; caption: RichText[]; language: string };
}

export interface DividerBlock extends BaseBlock {
  type: "divider";
  divider: Record<string, never>;
}

export interface CalloutBlock extends BaseBlock {
  type: "callout";
  callout: {
    rich_text: RichText[];
    icon: { type: "emoji"; emoji: string } | { type: "external"; external: { url: string } } | null;
    color: string;
    children?: Block[];
  };
}

export interface TableBlock extends BaseBlock {
  type: "table";
  table: {
    table_width: number;
    has_column_header: boolean;
    has_row_header: boolean;
    children?: TableRowBlock[];
  };
}

export interface TableRowBlock extends BaseBlock {
  type: "table_row";
  table_row: { cells: RichText[][] };
}

export interface EquationBlock extends BaseBlock {
  type: "equation";
  equation: { expression: string };
}

export interface GenericPassThroughBlock extends BaseBlock {
  type:
    | "bookmark"
    | "link_preview"
    | "image"
    | "video"
    | "file"
    | "pdf"
    | "child_page"
    | "child_database"
    | "embed"
    | "synced_block"
    | "column_list"
    | "column"
    | "table_of_contents"
    | "breadcrumb"
    | "unsupported";
  [key: string]: unknown;
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListItemBlock
  | ToDoBlock
  | ToggleBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock
  | CalloutBlock
  | TableBlock
  | TableRowBlock
  | EquationBlock
  | GenericPassThroughBlock;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/markdown/types.ts
git commit -m "add markdown and rich-text type definitions"
```

---

### Task 15: Rich-text tokenizer — read path (runs → markdown)

**Files:**
- Create: `src/markdown/tokenizer.ts`
- Create: `test/markdown/tokenizer.test.ts`

- [ ] **Step 1: Write failing tests for the read path**

Create `test/markdown/tokenizer.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { richTextToMarkdown } from "../../src/markdown/tokenizer.js";
import type { RichText } from "../../src/markdown/types.js";
import { DEFAULT_ANNOTATIONS } from "../../src/markdown/types.js";

function text(content: string, annotations: Partial<typeof DEFAULT_ANNOTATIONS> = {}): RichText {
  return {
    type: "text",
    text: { content, link: null },
    annotations: { ...DEFAULT_ANNOTATIONS, ...annotations },
    plain_text: content,
    href: null,
  };
}

function link(content: string, url: string, annotations: Partial<typeof DEFAULT_ANNOTATIONS> = {}): RichText {
  return {
    type: "text",
    text: { content, link: { url } },
    annotations: { ...DEFAULT_ANNOTATIONS, ...annotations },
    plain_text: content,
    href: url,
  };
}

describe("richTextToMarkdown", () => {
  it("plain text passes through", () => {
    assert.equal(richTextToMarkdown([text("hello world")]), "hello world");
  });

  it("bold wraps in **", () => {
    assert.equal(richTextToMarkdown([text("hello", { bold: true })]), "**hello**");
  });

  it("italic wraps in _", () => {
    assert.equal(richTextToMarkdown([text("hello", { italic: true })]), "_hello_");
  });

  it("bold + italic nests correctly", () => {
    assert.equal(
      richTextToMarkdown([text("hello", { bold: true, italic: true })]),
      "**_hello_**",
    );
  });

  it("inline code wraps in backticks", () => {
    assert.equal(richTextToMarkdown([text("code", { code: true })]), "`code`");
  });

  it("strikethrough wraps in ~~", () => {
    assert.equal(richTextToMarkdown([text("gone", { strikethrough: true })]), "~~gone~~");
  });

  it("mixed runs emit minimal markers using an annotation stack", () => {
    // "a " plain, "bold italic" bold+italic, " c" plain
    // Naive emits: a **_bold italic_**  c  → correct
    // Previous bug: would emit "a ****_bold italic_**** c"
    const runs: RichText[] = [
      text("a "),
      text("bold italic", { bold: true, italic: true }),
      text(" c"),
    ];
    assert.equal(richTextToMarkdown(runs), "a **_bold italic_** c");
  });

  it("transition from bold+italic back to italic-only keeps italic open", () => {
    // "_a **b** c_" — italic continues across a bold run
    const runs: RichText[] = [
      text("a ", { italic: true }),
      text("b", { bold: true, italic: true }),
      text(" c", { italic: true }),
    ];
    assert.equal(richTextToMarkdown(runs), "_a **b** c_");
  });

  it("links wrap innermost", () => {
    const runs: RichText[] = [link("click here", "https://example.com")];
    assert.equal(richTextToMarkdown(runs), "[click here](https://example.com)");
  });

  it("bold link", () => {
    const runs: RichText[] = [link("click", "https://example.com", { bold: true })];
    assert.equal(richTextToMarkdown(runs), "**[click](https://example.com)**");
  });

  it("link inside annotated span", () => {
    const runs: RichText[] = [
      text("a ", { bold: true }),
      link("link", "https://example.com", { bold: true }),
      text(" c", { bold: true }),
    ];
    assert.equal(richTextToMarkdown(runs), "**a [link](https://example.com) c**");
  });

  it("empty run array returns empty string", () => {
    assert.equal(richTextToMarkdown([]), "");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="richTextToMarkdown"`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the read path**

Create `src/markdown/tokenizer.ts`:

```typescript
/**
 * Rich-text tokenizer — read path (runs → markdown) and write path
 * (markdown → runs).
 *
 * Notion's rich_text is a flat array of annotated runs. Markdown's
 * annotations nest. The bidirectional conversion has to handle nesting
 * correctly using a stack of open annotations, or you get bugs like
 * "**a**_b_**c**" instead of "**a _b_ c**".
 *
 * This file implements only the rich-text (inline) conversion. Block-level
 * conversion lives in read.ts and write.ts.
 */

import type { RichText, Annotations } from "./types.js";

type MarkerKey = "bold" | "italic" | "strikethrough" | "code";
const MARKER_ORDER: MarkerKey[] = ["bold", "italic", "strikethrough", "code"];
const MARKERS: Record<MarkerKey, string> = {
  bold: "**",
  italic: "_",
  strikethrough: "~~",
  code: "`",
};

export function richTextToMarkdown(runs: RichText[]): string {
  let out = "";
  const openStack: MarkerKey[] = [];

  for (const run of runs) {
    const desired = activeMarkers(run.annotations);
    const hasLink = isLinkRun(run);

    // Determine which open markers must close (any currently open that
    // are not in `desired`) — close them in reverse order.
    while (openStack.length > 0 && !desired.includes(openStack[openStack.length - 1]!)) {
      const top = openStack.pop()!;
      out += MARKERS[top];
    }

    // Open any markers in `desired` that are not currently open.
    for (const marker of desired) {
      if (!openStack.includes(marker)) {
        out += MARKERS[marker];
        openStack.push(marker);
      }
    }

    // Emit the run content
    const content = runContent(run);
    if (hasLink) {
      const url = linkUrl(run);
      out += `[${content}](${url})`;
    } else {
      out += content;
    }
  }

  // Close any remaining open markers
  while (openStack.length > 0) {
    out += MARKERS[openStack.pop()!];
  }

  return out;
}

function activeMarkers(annotations: Annotations): MarkerKey[] {
  const markers: MarkerKey[] = [];
  for (const key of MARKER_ORDER) {
    if (annotations[key]) markers.push(key);
  }
  return markers;
}

function isLinkRun(run: RichText): boolean {
  if (run.type !== "text") return false;
  return run.text.link !== null && run.text.link !== undefined;
}

function linkUrl(run: RichText): string {
  if (run.type !== "text" || !run.text.link) return "";
  return run.text.link.url;
}

function runContent(run: RichText): string {
  if (run.type === "text") return run.text.content;
  if (run.type === "equation") return `$${run.equation.expression}$`;
  if (run.type === "mention") {
    const m = run.mention;
    if (m.type === "user") return `@user:${m.user.id}`;
    if (m.type === "page") return `[${run.plain_text}](notion://page/${m.page.id})`;
    if (m.type === "database") return `[${run.plain_text}](notion://database/${m.database.id})`;
    if (m.type === "date") {
      const range = m.date.end ? `${m.date.start}..${m.date.end}` : m.date.start;
      return `<${range}>`;
    }
    if (m.type === "link_preview") return `[${run.plain_text}](${m.link_preview.url})`;
  }
  return run.plain_text;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="richTextToMarkdown"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/markdown/tokenizer.ts test/markdown/tokenizer.test.ts
git commit -m "add rich-text read tokenizer with annotation stack"
```

---

### Task 16: Rich-text tokenizer — write path (markdown → runs)

**Files:**
- Modify: `src/markdown/tokenizer.ts`
- Modify: `test/markdown/tokenizer.test.ts`

- [ ] **Step 1: Append failing tests for the write path**

Append to `test/markdown/tokenizer.test.ts`:

```typescript
import { markdownToRichText } from "../../src/markdown/tokenizer.js";

describe("markdownToRichText", () => {
  it("plain text returns one run", () => {
    const runs = markdownToRichText("hello world");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "hello world");
    assert.equal(runs[0]!.annotations.bold, false);
  });

  it("bold produces bold run", () => {
    const runs = markdownToRichText("**hello**");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "hello");
    assert.equal(runs[0]!.annotations.bold, true);
  });

  it("italic produces italic run", () => {
    const runs = markdownToRichText("_hello_");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.italic, true);
  });

  it("bold + italic combined", () => {
    const runs = markdownToRichText("**_hello_**");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.bold, true);
    assert.equal(runs[0]!.annotations.italic, true);
  });

  it("mixed plain and bold segments", () => {
    const runs = markdownToRichText("a **b** c");
    assert.equal(runs.length, 3);
    assert.equal(runs[0]!.plain_text, "a ");
    assert.equal(runs[0]!.annotations.bold, false);
    assert.equal(runs[1]!.plain_text, "b");
    assert.equal(runs[1]!.annotations.bold, true);
    assert.equal(runs[2]!.plain_text, " c");
  });

  it("inline code segment", () => {
    const runs = markdownToRichText("`code`");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.code, true);
    assert.equal(runs[0]!.plain_text, "code");
  });

  it("link produces text run with link set", () => {
    const runs = markdownToRichText("[click](https://example.com)");
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    assert.equal(run.type, "text");
    if (run.type === "text") {
      assert.equal(run.text.content, "click");
      assert.deepEqual(run.text.link, { url: "https://example.com" });
    }
  });

  it("annotation wrapping a link", () => {
    const runs = markdownToRichText("**[click](https://example.com)**");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.bold, true);
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://example.com" });
    }
  });

  it("strikethrough", () => {
    const runs = markdownToRichText("~~gone~~");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.annotations.strikethrough, true);
  });

  it("round-trip: runs → md → runs preserves annotations", () => {
    const original: RichText[] = [
      text("a "),
      text("bold italic", { bold: true, italic: true }),
      text(" c"),
    ];
    const md = richTextToMarkdown(original);
    const roundtripped = markdownToRichText(md);
    // Reconstructing must preserve semantic annotations, not exact run count
    assert.equal(roundtripped.length >= 3, true);
    assert.equal(roundtripped.find((r) => r.plain_text === "bold italic")?.annotations.bold, true);
  });

  it("handles backticks literally inside a link label", () => {
    const runs = markdownToRichText("[`code` label](https://example.com)");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.plain_text, "`code` label");
    if (runs[0]!.type === "text") {
      assert.deepEqual(runs[0]!.text.link, { url: "https://example.com" });
    }
  });

  it("empty string returns empty array", () => {
    assert.deepEqual(markdownToRichText(""), []);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="markdownToRichText"`
Expected: FAIL — function does not exist yet.

- [ ] **Step 3: Add `markdownToRichText` to `src/markdown/tokenizer.ts`**

Append:

```typescript
import { DEFAULT_ANNOTATIONS, type TextRichText } from "./types.js";

/**
 * Write path: Markdown inline → Notion rich-text runs.
 *
 * Hand-written character-by-character scanner. No regex. Maintains a
 * stack of currently-open annotations and emits a new run every time
 * the annotation set changes or a link boundary is crossed.
 *
 * Handles (in priority order):
 *   - `...`  inline code (opaque — no annotation nesting inside)
 *   - **...** bold
 *   - _..._  italic (we prefer underscore to avoid ambiguity with *)
 *   - ~~...~~ strikethrough
 *   - [text](url) link
 *
 * Escapes: a backslash before any marker character treats it literally.
 * Unmatched markers are emitted as literal text (forgiving parser).
 */

interface ScannerState {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
}

export function markdownToRichText(md: string): RichText[] {
  if (md.length === 0) return [];

  const runs: RichText[] = [];
  const state: ScannerState = {
    bold: false,
    italic: false,
    strikethrough: false,
    code: false,
  };
  let buffer = "";
  let linkUrl: string | null = null;

  const flush = (): void => {
    if (buffer.length === 0 && linkUrl === null) return;
    runs.push(makeRun(buffer, state, linkUrl));
    buffer = "";
  };

  let i = 0;
  while (i < md.length) {
    const c = md[i]!;
    const next = md[i + 1];

    // Escape
    if (c === "\\" && next !== undefined && isMarkerChar(next)) {
      buffer += next;
      i += 2;
      continue;
    }

    // Inline code — opaque, no nesting
    if (c === "`" && !state.code) {
      flush();
      const end = md.indexOf("`", i + 1);
      if (end === -1) {
        buffer += c;
        i++;
        continue;
      }
      runs.push(makeRun(md.slice(i + 1, end), { ...state, code: true }, null));
      i = end + 1;
      continue;
    }

    // Bold **
    if (c === "*" && next === "*") {
      flush();
      state.bold = !state.bold;
      i += 2;
      continue;
    }

    // Strikethrough ~~
    if (c === "~" && next === "~") {
      flush();
      state.strikethrough = !state.strikethrough;
      i += 2;
      continue;
    }

    // Italic _
    if (c === "_") {
      flush();
      state.italic = !state.italic;
      i += 1;
      continue;
    }

    // Link [text](url)
    if (c === "[") {
      flush();
      const linkEnd = findLinkEnd(md, i);
      if (linkEnd !== null) {
        const labelStart = i + 1;
        const labelEnd = linkEnd.labelEnd;
        const urlStart = linkEnd.urlStart;
        const urlEnd = linkEnd.urlEnd;
        const label = md.slice(labelStart, labelEnd);
        const url = md.slice(urlStart, urlEnd);
        runs.push(makeRun(label, state, url));
        i = urlEnd + 1;
        continue;
      }
    }

    buffer += c;
    i++;
  }

  flush();
  return runs;
}

function isMarkerChar(c: string): boolean {
  return c === "*" || c === "_" || c === "~" || c === "`" || c === "[" || c === "]" || c === "\\";
}

function findLinkEnd(md: string, startIdx: number): { labelEnd: number; urlStart: number; urlEnd: number } | null {
  // startIdx points at '['. Find matching ']', then '(' immediately after, then ')'.
  let depth = 1;
  let i = startIdx + 1;
  while (i < md.length) {
    if (md[i] === "\\") { i += 2; continue; }
    if (md[i] === "[") depth++;
    if (md[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  if (depth !== 0) return null;
  const labelEnd = i;
  if (md[i + 1] !== "(") return null;
  const urlStart = i + 2;
  const urlEnd = md.indexOf(")", urlStart);
  if (urlEnd === -1) return null;
  return { labelEnd, urlStart, urlEnd };
}

function makeRun(content: string, state: ScannerState, linkUrl: string | null): TextRichText {
  return {
    type: "text",
    text: {
      content,
      link: linkUrl ? { url: linkUrl } : null,
    },
    annotations: {
      ...DEFAULT_ANNOTATIONS,
      bold: state.bold,
      italic: state.italic,
      strikethrough: state.strikethrough,
      code: state.code,
    },
    plain_text: content,
    href: linkUrl,
  };
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="markdownToRichText|richTextToMarkdown"`
Expected: all tests pass. If the round-trip test fails, investigate: the round-trip need not preserve run *structure*, only *semantic annotations*. Adjust the test assertions if they over-specify.

- [ ] **Step 5: Commit**

```bash
git add src/markdown/tokenizer.ts test/markdown/tokenizer.test.ts
git commit -m "add markdown → rich-text write tokenizer (no regex)"
```

---

## Phase 8 — Markdown read (blocks → markdown)

### Task 17: `src/markdown/read.ts` — basic block types

**Files:**
- Create: `src/markdown/read.ts`
- Create: `test/markdown/read.test.ts`

- [ ] **Step 1: Write failing tests for basic blocks**

Create `test/markdown/read.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksToMarkdown } from "../../src/markdown/read.js";
import type { Block, RichText } from "../../src/markdown/types.js";
import { DEFAULT_ANNOTATIONS } from "../../src/markdown/types.js";

function rt(content: string, annotations: Partial<typeof DEFAULT_ANNOTATIONS> = {}): RichText {
  return {
    type: "text",
    text: { content, link: null },
    annotations: { ...DEFAULT_ANNOTATIONS, ...annotations },
    plain_text: content,
    href: null,
  };
}

function mkBlock(type: string, body: Record<string, unknown>, extras: Partial<Block> = {}): Block {
  return {
    object: "block",
    id: "test-id",
    type: type as Block["type"],
    has_children: false,
    [type]: body,
    ...extras,
  } as Block;
}

describe("blocksToMarkdown basic blocks", () => {
  it("paragraph", () => {
    const blocks: Block[] = [mkBlock("paragraph", { rich_text: [rt("hello world")], color: "default" })];
    assert.equal(blocksToMarkdown(blocks).trim(), "hello world");
  });

  it("heading 1, 2, 3", () => {
    const blocks: Block[] = [
      mkBlock("heading_1", { rich_text: [rt("Title")], color: "default", is_toggleable: false }),
      mkBlock("heading_2", { rich_text: [rt("Subtitle")], color: "default", is_toggleable: false }),
      mkBlock("heading_3", { rich_text: [rt("Subsubtitle")], color: "default", is_toggleable: false }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /^# Title$/m);
    assert.match(out, /^## Subtitle$/m);
    assert.match(out, /^### Subsubtitle$/m);
  });

  it("bulleted and numbered list items", () => {
    const blocks: Block[] = [
      mkBlock("bulleted_list_item", { rich_text: [rt("bullet one")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("bullet two")], color: "default" }),
      mkBlock("numbered_list_item", { rich_text: [rt("number one")], color: "default" }),
      mkBlock("numbered_list_item", { rich_text: [rt("number two")], color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /^- bullet one$/m);
    assert.match(out, /^- bullet two$/m);
    assert.match(out, /^1\. number one$/m);
    assert.match(out, /^2\. number two$/m);
  });

  it("to_do unchecked and checked", () => {
    const blocks: Block[] = [
      mkBlock("to_do", { rich_text: [rt("open task")], checked: false, color: "default" }),
      mkBlock("to_do", { rich_text: [rt("done task")], checked: true, color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /^- \[ \] open task$/m);
    assert.match(out, /^- \[x\] done task$/m);
  });

  it("quote", () => {
    const blocks: Block[] = [mkBlock("quote", { rich_text: [rt("to be or not to be")], color: "default" })];
    assert.match(blocksToMarkdown(blocks), /^> to be or not to be$/m);
  });

  it("code block with language", () => {
    const blocks: Block[] = [
      mkBlock("code", {
        rich_text: [rt("const x = 1;")],
        caption: [],
        language: "typescript",
      }),
    ];
    assert.match(blocksToMarkdown(blocks), /```typescript\nconst x = 1;\n```/);
  });

  it("divider", () => {
    const blocks: Block[] = [mkBlock("divider", {})];
    assert.match(blocksToMarkdown(blocks), /^---$/m);
  });

  it("separates sibling blocks with blank lines", () => {
    const blocks: Block[] = [
      mkBlock("paragraph", { rich_text: [rt("first")], color: "default" }),
      mkBlock("paragraph", { rich_text: [rt("second")], color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.equal(out.trim(), "first\n\nsecond");
  });

  it("groups adjacent list items without blank lines between", () => {
    const blocks: Block[] = [
      mkBlock("bulleted_list_item", { rich_text: [rt("a")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("b")], color: "default" }),
      mkBlock("bulleted_list_item", { rich_text: [rt("c")], color: "default" }),
    ];
    assert.equal(blocksToMarkdown(blocks).trim(), "- a\n- b\n- c");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="blocksToMarkdown basic"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement basic block rendering**

Create `src/markdown/read.ts`:

```typescript
/**
 * Block tree → Markdown conversion (read path).
 *
 * Walks a Notion block array and emits GitHub Flavored Markdown with our
 * three extensions: YAML front-matter (handled elsewhere), GFM alerts for
 * callouts, and HTML <details> for toggles. Blocks we can't natively
 * express become HTML comments with block IDs so the write path can
 * preserve them on update.
 *
 * Split across Tasks 17 (basic) and 18 (complex). Both tasks modify
 * this file in sequence.
 */

import { richTextToMarkdown } from "./tokenizer.js";
import type { Block } from "./types.js";

export interface RenderOptions {
  depth?: number;
}

export function blocksToMarkdown(blocks: Block[], opts: RenderOptions = {}): string {
  const depth = opts.depth ?? 0;
  const lines: string[] = [];
  let lastType: string | null = null;
  let numberedIndex = 0;

  for (const block of blocks) {
    const isListItem = block.type === "bulleted_list_item" || block.type === "numbered_list_item";
    const isSameList = lastType === block.type && isListItem;

    if (!isSameList && lastType !== null) {
      lines.push("");
    }
    if (!isSameList) numberedIndex = 0;

    const rendered = renderBlock(block, depth, numberedIndex);
    if (block.type === "numbered_list_item") numberedIndex++;

    if (rendered !== null) lines.push(rendered);
    lastType = block.type;
  }

  return lines.join("\n");
}

function renderBlock(block: Block, depth: number, numberedIndex: number): string | null {
  switch (block.type) {
    case "paragraph": {
      const body = block.paragraph;
      return richTextToMarkdown(body.rich_text);
    }
    case "heading_1":
      return `# ${richTextToMarkdown(block.heading_1?.rich_text ?? [])}`;
    case "heading_2":
      return `## ${richTextToMarkdown(block.heading_2?.rich_text ?? [])}`;
    case "heading_3":
      return `### ${richTextToMarkdown(block.heading_3?.rich_text ?? [])}`;
    case "bulleted_list_item":
      return `- ${richTextToMarkdown(block.bulleted_list_item?.rich_text ?? [])}`;
    case "numbered_list_item":
      return `${numberedIndex + 1}. ${richTextToMarkdown(block.numbered_list_item?.rich_text ?? [])}`;
    case "to_do": {
      const checked = block.to_do.checked ? "x" : " ";
      return `- [${checked}] ${richTextToMarkdown(block.to_do.rich_text)}`;
    }
    case "quote":
      return `> ${richTextToMarkdown(block.quote.rich_text)}`;
    case "code": {
      const lang = block.code.language === "plain text" ? "" : block.code.language;
      const content = block.code.rich_text.map((r) => r.plain_text).join("");
      return `\`\`\`${lang}\n${content}\n\`\`\``;
    }
    case "divider":
      return "---";
    default:
      // Complex blocks handled in Task 18
      return null;
  }
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="blocksToMarkdown basic"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/markdown/read.ts test/markdown/read.test.ts
git commit -m "add markdown read path for basic block types"
```

---

### Task 18: Markdown read — complex blocks (callout, toggle, table, equation, mentions, pass-through)

**Files:**
- Modify: `src/markdown/read.ts`
- Modify: `test/markdown/read.test.ts`

- [ ] **Step 1: Append failing tests for complex blocks**

Append to `test/markdown/read.test.ts`:

```typescript
describe("blocksToMarkdown complex blocks", () => {
  it("callout with emoji icon and color", () => {
    const blocks: Block[] = [
      mkBlock("callout", {
        rich_text: [rt("This is a tip")],
        icon: { type: "emoji", emoji: "💡" },
        color: "blue_background",
      }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /> \[!NOTE\]/);
    assert.match(out, /This is a tip/);
    assert.match(out, /<!-- icon: 💡 -->/);
    assert.match(out, /<!-- color: blue_background -->/);
  });

  it("toggle block", () => {
    const blocks: Block[] = [
      mkBlock("toggle", { rich_text: [rt("Summary text")], color: "default" }),
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /<details><summary>Summary text<\/summary>/);
    assert.match(out, /<\/details>/);
  });

  it("equation block", () => {
    const blocks: Block[] = [
      mkBlock("equation", { expression: "E = mc^2" }),
    ];
    assert.match(blocksToMarkdown(blocks), /\$\$E = mc\^2\$\$/);
  });

  it("image with caption", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "img-1",
        type: "image",
        has_children: false,
        image: {
          type: "external",
          external: { url: "https://example.com/pic.png" },
          caption: [rt("A picture")],
        },
      } as Block,
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /!\[A picture\]\(https:\/\/example\.com\/pic\.png\)/);
    assert.match(out, /<!-- notion-block: image id=img-1 -->/);
  });

  it("synced_block passes through as HTML comment", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "sync-1",
        type: "synced_block",
        has_children: true,
        synced_block: { synced_from: null },
      } as Block,
    ];
    const out = blocksToMarkdown(blocks);
    assert.match(out, /<!-- notion-block: synced_block id=sync-1 -->/);
  });

  it("column_list passes through", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "col-1",
        type: "column_list",
        has_children: true,
        column_list: {},
      } as Block,
    ];
    assert.match(blocksToMarkdown(blocks), /<!-- notion-block: column_list id=col-1 -->/);
  });

  it("unknown future block type passes through", () => {
    const blocks: Block[] = [
      {
        object: "block",
        id: "x-1",
        type: "unsupported" as any,
        has_children: false,
        unsupported: {},
      } as Block,
    ];
    assert.match(blocksToMarkdown(blocks), /<!-- notion-block: unsupported id=x-1 -->/);
  });

  it("GFM table with header", () => {
    const tableBlock: Block = {
      object: "block",
      id: "table-1",
      type: "table",
      has_children: true,
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
      },
    } as Block;
    // With children attached inline
    (tableBlock as any).table.children = [
      {
        object: "block",
        id: "row-1",
        type: "table_row",
        has_children: false,
        table_row: { cells: [[rt("Name")], [rt("Status")]] },
      },
      {
        object: "block",
        id: "row-2",
        type: "table_row",
        has_children: false,
        table_row: { cells: [[rt("Alice")], [rt("Active")]] },
      },
    ];
    const out = blocksToMarkdown([tableBlock]);
    assert.match(out, /\| Name \| Status \|/);
    assert.match(out, /\| --- \| --- \|/);
    assert.match(out, /\| Alice \| Active \|/);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="blocksToMarkdown complex"`
Expected: FAIL — complex blocks not yet rendered.

- [ ] **Step 3: Add complex block cases to `renderBlock`**

In `src/markdown/read.ts`, extend the `switch` in `renderBlock`:

```typescript
    case "callout": {
      const text = richTextToMarkdown(block.callout.rich_text);
      const icon = block.callout.icon;
      const lines: string[] = [`> [!NOTE] ${text}`];
      if (icon && icon.type === "emoji") {
        lines.push(`<!-- icon: ${icon.emoji} -->`);
      }
      if (block.callout.color && block.callout.color !== "default") {
        lines.push(`<!-- color: ${block.callout.color} -->`);
      }
      return lines.join("\n");
    }
    case "toggle": {
      const summary = richTextToMarkdown(block.toggle.rich_text);
      return `<details><summary>${summary}</summary>\n\n</details>`;
    }
    case "equation":
      return `$$${block.equation.expression}$$`;
    case "table": {
      const tb = block as unknown as { table: { children?: unknown[] } };
      const rows = (tb.table.children ?? []) as Array<{
        type: "table_row";
        table_row: { cells: Array<Array<{ plain_text: string }>> };
      }>;
      if (rows.length === 0) return "";
      const lines: string[] = [];
      rows.forEach((row, i) => {
        const cells = row.table_row.cells.map((cell) =>
          cell.map((r) => r.plain_text).join(""),
        );
        lines.push(`| ${cells.join(" | ")} |`);
        if (i === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      return lines.join("\n");
    }
    case "image":
    case "video":
    case "file":
    case "pdf": {
      const media = (block as unknown as { [key: string]: { caption?: Array<{ plain_text: string }>; external?: { url: string }; file?: { url: string } } })[block.type];
      const url = media?.external?.url ?? media?.file?.url ?? "";
      const caption = (media?.caption ?? []).map((r) => r.plain_text).join("");
      const label = caption || block.type;
      return `![${label}](${url})\n<!-- notion-block: ${block.type} id=${block.id} -->`;
    }
    case "bookmark":
    case "link_preview": {
      const bm = (block as unknown as { [key: string]: { url?: string; caption?: Array<{ plain_text: string }> } })[block.type];
      const url = bm?.url ?? "";
      const caption = (bm?.caption ?? []).map((r) => r.plain_text).join("");
      return `[${caption || url}](${url})\n<!-- notion-block: ${block.type} id=${block.id} -->`;
    }
    case "child_page":
    case "child_database": {
      const body = (block as unknown as { [key: string]: { title?: string } })[block.type];
      const title = body?.title ?? "Untitled";
      const kind = block.type === "child_page" ? "page" : "database";
      return `[${title}](notion://${kind}/${block.id})`;
    }
    case "synced_block":
    case "column_list":
    case "column":
    case "embed":
    case "table_of_contents":
    case "breadcrumb":
    default:
      return `<!-- notion-block: ${block.type} id=${block.id} -->`;
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="blocksToMarkdown"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/markdown/read.ts test/markdown/read.test.ts
git commit -m "add markdown read path for complex blocks and pass-through"
```

---

## Phase 9 — Markdown write (markdown → blocks)

### Task 19: `src/markdown/write.ts` — basic block types

**Files:**
- Create: `src/markdown/write.ts`
- Create: `test/markdown/write.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/markdown/write.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks } from "../../src/markdown/write.js";

describe("markdownToBlocks basic blocks", () => {
  it("single paragraph", () => {
    const blocks = markdownToBlocks("Hello world.");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "paragraph");
  });

  it("multiple paragraphs separated by blank lines", () => {
    const blocks = markdownToBlocks("First para.\n\nSecond para.");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "paragraph");
    assert.equal(blocks[1]!.type, "paragraph");
  });

  it("headings 1-3", () => {
    const blocks = markdownToBlocks("# H1\n\n## H2\n\n### H3");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.type, "heading_1");
    assert.equal(blocks[1]!.type, "heading_2");
    assert.equal(blocks[2]!.type, "heading_3");
  });

  it("bulleted list", () => {
    const blocks = markdownToBlocks("- alpha\n- beta\n- gamma");
    assert.equal(blocks.length, 3);
    blocks.forEach((b) => assert.equal(b.type, "bulleted_list_item"));
  });

  it("numbered list", () => {
    const blocks = markdownToBlocks("1. one\n2. two\n3. three");
    assert.equal(blocks.length, 3);
    blocks.forEach((b) => assert.equal(b.type, "numbered_list_item"));
  });

  it("to_do items", () => {
    const blocks = markdownToBlocks("- [ ] open\n- [x] done");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "to_do");
    assert.equal((blocks[0] as any).to_do.checked, false);
    assert.equal((blocks[1] as any).to_do.checked, true);
  });

  it("quote", () => {
    const blocks = markdownToBlocks("> to be or not to be");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "quote");
  });

  it("fenced code block", () => {
    const blocks = markdownToBlocks("```typescript\nconst x = 1;\n```");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "code");
    assert.equal((blocks[0] as any).code.language, "typescript");
  });

  it("divider", () => {
    const blocks = markdownToBlocks("---");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "divider");
  });

  it("ignores leading/trailing whitespace and blank lines", () => {
    const blocks = markdownToBlocks("\n\n# Hello\n\n\n");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "heading_1");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="markdownToBlocks basic"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/markdown/write.ts`**

```typescript
/**
 * Markdown → block tree conversion (write path).
 *
 * Line-based parser. Groups lines into block-level units:
 *   - fenced code blocks
 *   - HTML details (toggles)
 *   - HTML comment markers (pass-through)
 *   - GFM tables (table rows separated by header separator row)
 *   - GFM alerts (callouts via > [!NOTE] prefix)
 *   - blockquotes, lists, to_dos, headings, paragraphs
 *
 * Inline formatting within each line is delegated to markdownToRichText.
 *
 * Split across Tasks 19 (basic) and 20 (complex + pass-through).
 */

import { markdownToRichText } from "./tokenizer.js";
import type { Block, RichText } from "./types.js";

export function markdownToBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i++;
      continue;
    }

    // Fenced code block
    if (/^```/.test(trimmed)) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++;  // consume closing fence
      blocks.push(makeCodeBlock(codeLines.join("\n"), lang));
      continue;
    }

    // Divider
    if (/^---$/.test(trimmed) || /^---\s*$/.test(trimmed)) {
      blocks.push(makeDividerBlock());
      i++;
      continue;
    }

    // Headings
    if (/^#\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(1, trimmed.slice(2)));
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(2, trimmed.slice(3)));
      i++;
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      blocks.push(makeHeadingBlock(3, trimmed.slice(4)));
      i++;
      continue;
    }

    // To-do (must check before bullet)
    const todoMatch = /^-\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (todoMatch) {
      const checked = todoMatch[1]!.toLowerCase() === "x";
      blocks.push(makeTodoBlock(todoMatch[2]!, checked));
      i++;
      continue;
    }

    // Bulleted list
    if (/^-\s+/.test(trimmed)) {
      blocks.push(makeBulletedBlock(trimmed.slice(2)));
      i++;
      continue;
    }

    // Numbered list
    const numMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (numMatch) {
      blocks.push(makeNumberedBlock(numMatch[2]!));
      i++;
      continue;
    }

    // Quote (plain, no alert prefix — alerts handled in Task 20)
    if (/^>\s+/.test(trimmed) && !/^>\s+\[!/.test(trimmed)) {
      blocks.push(makeQuoteBlock(trimmed.slice(2)));
      i++;
      continue;
    }

    // Default: paragraph (may span multiple lines until blank line)
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim().length > 0 && !isBlockStart(lines[i]!)) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push(makeParagraphBlock(paraLines.join("\n")));
  }

  return blocks;
}

function isBlockStart(line: string): boolean {
  const t = line.trim();
  return (
    /^#{1,3}\s/.test(t) ||
    /^-\s/.test(t) ||
    /^\d+\.\s/.test(t) ||
    /^>\s/.test(t) ||
    /^```/.test(t) ||
    /^---$/.test(t)
  );
}

function makeParagraphBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "paragraph",
    has_children: false,
    paragraph: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeHeadingBlock(level: 1 | 2 | 3, text: string): Block {
  const key = `heading_${level}` as const;
  return {
    object: "block",
    id: "",
    type: key,
    has_children: false,
    [key]: { rich_text: markdownToRichText(text), color: "default", is_toggleable: false },
  } as Block;
}

function makeBulletedBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "bulleted_list_item",
    has_children: false,
    bulleted_list_item: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeNumberedBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "numbered_list_item",
    has_children: false,
    numbered_list_item: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeTodoBlock(text: string, checked: boolean): Block {
  return {
    object: "block",
    id: "",
    type: "to_do",
    has_children: false,
    to_do: { rich_text: markdownToRichText(text), checked, color: "default" },
  } as Block;
}

function makeQuoteBlock(text: string): Block {
  return {
    object: "block",
    id: "",
    type: "quote",
    has_children: false,
    quote: { rich_text: markdownToRichText(text), color: "default" },
  } as Block;
}

function makeCodeBlock(content: string, language: string): Block {
  const lang = language || "plain text";
  const richText: RichText[] = [
    {
      type: "text",
      text: { content, link: null },
      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
      plain_text: content,
      href: null,
    },
  ];
  return {
    object: "block",
    id: "",
    type: "code",
    has_children: false,
    code: { rich_text: richText, caption: [], language: lang },
  } as Block;
}

function makeDividerBlock(): Block {
  return {
    object: "block",
    id: "",
    type: "divider",
    has_children: false,
    divider: {},
  } as Block;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="markdownToBlocks basic"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/markdown/write.ts test/markdown/write.test.ts
git commit -m "add markdown write path for basic block types"
```

---

### Task 20: Markdown write — complex blocks, callouts, toggles, equations, pass-through

**Files:**
- Modify: `src/markdown/write.ts`
- Modify: `test/markdown/write.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `test/markdown/write.test.ts`:

```typescript
describe("markdownToBlocks complex blocks", () => {
  it("GFM alert callout", () => {
    const blocks = markdownToBlocks("> [!NOTE] Some note\n<!-- icon: 💡 -->\n<!-- color: blue_background -->");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "callout");
    assert.equal((blocks[0] as any).callout.icon.emoji, "💡");
    assert.equal((blocks[0] as any).callout.color, "blue_background");
  });

  it("HTML details toggle", () => {
    const blocks = markdownToBlocks(
      "<details><summary>Expand me</summary>\n\nHidden body\n\n</details>",
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "toggle");
  });

  it("equation block", () => {
    const blocks = markdownToBlocks("$$E = mc^2$$");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "equation");
    assert.equal((blocks[0] as any).equation.expression, "E = mc^2");
  });

  it("pass-through block preserves ID", () => {
    const blocks = markdownToBlocks("<!-- notion-block: synced_block id=abc-123 -->");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "synced_block");
    assert.equal(blocks[0]!.id, "abc-123");
  });

  it("GFM table", () => {
    const md = "| Name | Status |\n| --- | --- |\n| Alice | Active |\n| Bob | Inactive |";
    const blocks = markdownToBlocks(md);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "table");
    const table = blocks[0] as any;
    assert.equal(table.table.table_width, 2);
    assert.equal(table.table.has_column_header, true);
    assert.equal(table.table.children.length, 3);  // header + 2 rows
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="markdownToBlocks complex"`
Expected: FAIL.

- [ ] **Step 3: Add complex block handlers to `markdownToBlocks`**

Insert these branches in the while loop in `src/markdown/write.ts` (before the "Default: paragraph" case):

```typescript
    // GFM alert (callout)
    if (/^>\s+\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.test(trimmed)) {
      const alertMatch = /^>\s+\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i.exec(trimmed);
      const calloutText = alertMatch?.[2] ?? "";
      i++;
      // Collect optional sidecar comments (icon, color)
      let icon: { type: "emoji"; emoji: string } | null = null;
      let color = "default";
      while (i < lines.length) {
        const next = lines[i]!.trim();
        const iconMatch = /^<!--\s*icon:\s*(\S+)\s*-->$/.exec(next);
        const colorMatch = /^<!--\s*color:\s*(\S+)\s*-->$/.exec(next);
        if (iconMatch) { icon = { type: "emoji", emoji: iconMatch[1]! }; i++; continue; }
        if (colorMatch) { color = colorMatch[1]!; i++; continue; }
        break;
      }
      blocks.push({
        object: "block",
        id: "",
        type: "callout",
        has_children: false,
        callout: {
          rich_text: markdownToRichText(calloutText),
          icon: icon ?? { type: "emoji", emoji: "💡" },
          color,
        },
      } as unknown as Block);
      continue;
    }

    // HTML toggle: <details><summary>...</summary>...</details>
    if (/^<details>/i.test(trimmed)) {
      const summaryMatch = /<summary>(.*?)<\/summary>/i.exec(trimmed);
      const summary = summaryMatch?.[1] ?? "";
      i++;
      while (i < lines.length && !/<\/details>/i.test(lines[i]!)) i++;
      i++;  // consume closing tag
      blocks.push({
        object: "block",
        id: "",
        type: "toggle",
        has_children: false,
        toggle: { rich_text: markdownToRichText(summary), color: "default" },
      } as unknown as Block);
      continue;
    }

    // Equation block
    if (/^\$\$.*\$\$$/.test(trimmed)) {
      const expr = trimmed.slice(2, -2);
      blocks.push({
        object: "block",
        id: "",
        type: "equation",
        has_children: false,
        equation: { expression: expr },
      } as unknown as Block);
      i++;
      continue;
    }

    // Pass-through HTML comment
    const passMatch = /^<!--\s*notion-block:\s*(\w+)\s+id=([\w-]+)\s*-->$/.exec(trimmed);
    if (passMatch) {
      blocks.push({
        object: "block",
        id: passMatch[2]!,
        type: passMatch[1]! as Block["type"],
        has_children: false,
      } as Block);
      i++;
      continue;
    }

    // GFM table
    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|\s*---/.test(lines[i + 1]!.trim())) {
      const headerCells = parseTableRow(trimmed);
      i += 2;  // skip header + separator
      const rowBlocks: Block[] = [
        {
          object: "block",
          id: "",
          type: "table_row",
          has_children: false,
          table_row: { cells: headerCells.map((c) => markdownToRichText(c)) },
        } as unknown as Block,
      ];
      while (i < lines.length && /^\|.*\|$/.test(lines[i]!.trim())) {
        const rowCells = parseTableRow(lines[i]!.trim());
        rowBlocks.push({
          object: "block",
          id: "",
          type: "table_row",
          has_children: false,
          table_row: { cells: rowCells.map((c) => markdownToRichText(c)) },
        } as unknown as Block);
        i++;
      }
      blocks.push({
        object: "block",
        id: "",
        type: "table",
        has_children: true,
        table: {
          table_width: headerCells.length,
          has_column_header: true,
          has_row_header: false,
          children: rowBlocks,
        },
      } as unknown as Block);
      continue;
    }
```

And add helpers at the bottom of the file:

```typescript
function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="markdownToBlocks"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/markdown/write.ts test/markdown/write.test.ts
git commit -m "add markdown write for callouts, toggles, tables, equations, pass-through"
```

---

### Task 21: Markdown index.ts public API

**Files:**
- Create: `src/markdown/index.ts`

- [ ] **Step 1: Create the public entry**

```typescript
export { blocksToMarkdown } from "./read.js";
export { markdownToBlocks } from "./write.js";
export { richTextToMarkdown, markdownToRichText } from "./tokenizer.js";
export type { Block, RichText, Annotations, BlockType } from "./types.js";
export { DEFAULT_ANNOTATIONS } from "./types.js";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/markdown/index.ts
git commit -m "add markdown module public api"
```

---

## Phase 10 — Property value DSL

### Task 22: `src/properties/parse.ts` — writable property types

**Files:**
- Create: `src/properties/parse.ts`
- Create: `test/properties/parse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/properties/parse.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseProperty, parsePropertyFlag } from "../../src/properties/parse.js";
import type { PropertySchema } from "../../src/properties/parse.js";

const schema: Record<string, PropertySchema> = {
  Title: { type: "title" },
  Description: { type: "rich_text" },
  Points: { type: "number" },
  Status: { type: "select" },
  State: { type: "status" },
  Tags: { type: "multi_select" },
  Due: { type: "date" },
  Done: { type: "checkbox" },
  Website: { type: "url" },
  Email: { type: "email" },
  Phone: { type: "phone_number" },
  Assignee: { type: "people" },
  Assignees: { type: "people" },
  Blocks: { type: "relation" },
  Attachment: { type: "files" },
};

describe("parseProperty — writable types", () => {
  it("title as plain string", () => {
    const out = parseProperty(schema, "Title", "Implement auth");
    assert.deepEqual(out, {
      title: [{ type: "text", text: { content: "Implement auth", link: null } }],
    });
  });

  it("rich_text as plain string", () => {
    const out = parseProperty(schema, "Description", "see docs");
    assert.deepEqual(out, {
      rich_text: [{ type: "text", text: { content: "see docs", link: null } }],
    });
  });

  it("number integer", () => {
    assert.deepEqual(parseProperty(schema, "Points", "8"), { number: 8 });
  });

  it("number float", () => {
    assert.deepEqual(parseProperty(schema, "Points", "8.5"), { number: 8.5 });
  });

  it("select by name", () => {
    assert.deepEqual(parseProperty(schema, "Status", "Done"), { select: { name: "Done" } });
  });

  it("status by name", () => {
    assert.deepEqual(parseProperty(schema, "State", "In Progress"), {
      status: { name: "In Progress" },
    });
  });

  it("multi_select flow sequence", () => {
    assert.deepEqual(parseProperty(schema, "Tags", "[backend,security]"), {
      multi_select: [{ name: "backend" }, { name: "security" }],
    });
  });

  it("multi_select with quoted values containing commas", () => {
    assert.deepEqual(parseProperty(schema, "Tags", '["has, comma",plain]'), {
      multi_select: [{ name: "has, comma" }, { name: "plain" }],
    });
  });

  it("date single day", () => {
    assert.deepEqual(parseProperty(schema, "Due", "2026-04-15"), {
      date: { start: "2026-04-15", end: null },
    });
  });

  it("date range", () => {
    assert.deepEqual(parseProperty(schema, "Due", "2026-04-15..2026-04-30"), {
      date: { start: "2026-04-15", end: "2026-04-30" },
    });
  });

  it("date with time", () => {
    assert.deepEqual(parseProperty(schema, "Due", "2026-04-15T10:00:00Z"), {
      date: { start: "2026-04-15T10:00:00Z", end: null },
    });
  });

  it("checkbox true/false", () => {
    assert.deepEqual(parseProperty(schema, "Done", "true"), { checkbox: true });
    assert.deepEqual(parseProperty(schema, "Done", "false"), { checkbox: false });
  });

  it("url, email, phone_number", () => {
    assert.deepEqual(parseProperty(schema, "Website", "https://x.com"), { url: "https://x.com" });
    assert.deepEqual(parseProperty(schema, "Email", "a@b.com"), { email: "a@b.com" });
    assert.deepEqual(parseProperty(schema, "Phone", "+1-555-0100"), { phone_number: "+1-555-0100" });
  });

  it("people with user: prefix (canonical)", () => {
    assert.deepEqual(parseProperty(schema, "Assignee", "user:abc-123"), {
      people: [{ id: "abc-123" }],
    });
  });

  it("people list with canonical ids", () => {
    assert.deepEqual(
      parseProperty(schema, "Assignees", "[user:abc-123,user:def-456]"),
      { people: [{ id: "abc-123" }, { id: "def-456" }] },
    );
  });

  it("relation by page: prefix", () => {
    assert.deepEqual(parseProperty(schema, "Blocks", "[page:abc-123]"), {
      relation: [{ id: "abc-123" }],
    });
  });

  it("files with url: prefix", () => {
    assert.deepEqual(parseProperty(schema, "Attachment", 'url:"https://ex.com/f.pdf"'), {
      files: [{ name: "f.pdf", external: { url: "https://ex.com/f.pdf" } }],
    });
  });

  it("unknown property name throws", () => {
    assert.throws(() => parseProperty(schema, "Nonexistent", "x"));
  });
});

describe("parsePropertyFlag", () => {
  it("splits on first unquoted =", () => {
    assert.deepEqual(parsePropertyFlag("Title=Hello"), { key: "Title", value: "Hello" });
  });

  it("handles = inside quoted value", () => {
    assert.deepEqual(
      parsePropertyFlag('Desc="a=b"'),
      { key: "Desc", value: '"a=b"' },
    );
  });

  it("throws on flag without =", () => {
    assert.throws(() => parsePropertyFlag("Title"));
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="parseProperty"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/properties/parse.ts`**

```typescript
/**
 * Property value DSL parser.
 *
 * Turns --prop "Key=value" flags into the shapes Notion's API expects
 * for page property updates. Schema-driven: before parsing, the caller
 * fetches the DB schema and passes a name → type map. We never guess
 * property types.
 *
 * Supports all 14 writable property types. The 7 read-only types
 * (formula, rollup, created_*, last_edited_*, unique_id) are silently
 * filtered out by the caller — this file does not handle them.
 *
 * For anything the DSL can't express, there's --prop-json that passes
 * the raw Notion shape through untouched. This file is not responsible
 * for that escape hatch.
 */

import { NotionCliError, ErrorCode } from "../errors.js";

export type PropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "status"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "people"
  | "files"
  | "relation"
  // read-only types
  | "formula"
  | "rollup"
  | "created_time"
  | "created_by"
  | "last_edited_time"
  | "last_edited_by"
  | "unique_id";

export interface PropertySchema {
  type: PropertyType;
  name?: string;
  id?: string;
}

export interface FlagPair {
  key: string;
  value: string;
}

export function parsePropertyFlag(flag: string): FlagPair {
  const eqIdx = findUnquotedEquals(flag);
  if (eqIdx === -1) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Invalid --prop flag (missing '='): ${flag}`,
    );
  }
  return { key: flag.slice(0, eqIdx).trim(), value: flag.slice(eqIdx + 1).trim() };
}

function findUnquotedEquals(s: string): number {
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuote) {
      if (c === quoteChar && s[i - 1] !== "\\") inQuote = false;
    } else {
      if (c === '"' || c === "'") { inQuote = true; quoteChar = c; }
      else if (c === "=") return i;
    }
  }
  return -1;
}

export function parseProperty(
  schema: Record<string, PropertySchema>,
  key: string,
  rawValue: string,
): Record<string, unknown> {
  const propSchema = schema[key];
  if (!propSchema) {
    const suggestions = suggestKey(key, Object.keys(schema));
    throw new NotionCliError(
      ErrorCode.INVALID_PROPERTY,
      `Property '${key}' not found on database`,
      suggestions.length > 0 ? { suggestions } : {},
    );
  }

  const value = stripQuotes(rawValue);

  switch (propSchema.type) {
    case "title":
      return { title: [{ type: "text", text: { content: value, link: null } }] };
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: value, link: null } }] };
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new NotionCliError(ErrorCode.INVALID_PROPERTY, `Property '${key}' must be a number, got: ${value}`);
      }
      return { number: n };
    }
    case "select":
      return { select: { name: value } };
    case "status":
      return { status: { name: value } };
    case "multi_select": {
      const items = parseList(value);
      return { multi_select: items.map((name) => ({ name })) };
    }
    case "date": {
      const rangeMatch = /^(.+?)\.\.(.+)$/.exec(value);
      if (rangeMatch) {
        return { date: { start: rangeMatch[1]!, end: rangeMatch[2]! } };
      }
      return { date: { start: value, end: null } };
    }
    case "checkbox":
      return { checkbox: value === "true" };
    case "url":
      return { url: value };
    case "email":
      return { email: value };
    case "phone_number":
      return { phone_number: value };
    case "people": {
      if (value.startsWith("[") && value.endsWith("]")) {
        const items = parseList(value);
        return { people: items.map((item) => resolvePersonRef(item, key)) };
      }
      return { people: [resolvePersonRef(value, key)] };
    }
    case "files": {
      const prefix = /^(url|file):/.exec(value);
      if (!prefix) {
        throw new NotionCliError(
          ErrorCode.INVALID_PROPERTY,
          `Property '${key}' (files) requires url: or file: prefix, got: ${value}`,
        );
      }
      if (prefix[1] === "url") {
        const url = stripQuotes(value.slice(4));
        const name = url.split("/").pop() ?? "file";
        return { files: [{ name, external: { url } }] };
      }
      throw new NotionCliError(
        ErrorCode.INVALID_PROPERTY,
        "Local file upload (file: prefix) is deferred to V2. Use url: for now.",
      );
    }
    case "relation": {
      if (value.startsWith("[") && value.endsWith("]")) {
        const items = parseList(value);
        return { relation: items.map((item) => resolveRelationRef(item, key)) };
      }
      return { relation: [resolveRelationRef(value, key)] };
    }
    default:
      throw new NotionCliError(
        ErrorCode.INVALID_PROPERTY,
        `Property type '${propSchema.type}' is read-only; cannot set`,
      );
  }
}

function resolvePersonRef(ref: string, propKey: string): { id: string } {
  const canon = /^user:(.+)$/.exec(ref);
  if (canon) return { id: canon[1]! };
  throw new NotionCliError(
    ErrorCode.INVALID_PROPERTY,
    `People property '${propKey}' requires 'user:<id>' format (at-name lookup not yet implemented in V1)`,
    { suggestions: ["Use 'user:<uuid>' to specify a user by ID"] },
  );
}

function resolveRelationRef(ref: string, propKey: string): { id: string } {
  const canon = /^page:(.+)$/.exec(ref);
  if (canon) return { id: canon[1]! };
  throw new NotionCliError(
    ErrorCode.INVALID_PROPERTY,
    `Relation property '${propKey}' requires 'page:<id>' format (title lookup not yet implemented in V1)`,
    { suggestions: ["Use 'page:<uuid>' to specify a related page by ID"] },
  );
}

function parseList(raw: string): string[] {
  let inner = raw.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  const items: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inQuote) {
      if (c === quoteChar && inner[i - 1] !== "\\") inQuote = false;
      else current += c;
      continue;
    }
    if (c === '"' || c === "'") { inQuote = true; quoteChar = c; continue; }
    if (c === ",") {
      if (current.trim().length > 0) items.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) items.push(current.trim());
  return items;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function suggestKey(input: string, candidates: string[]): string[] {
  const matches = candidates
    .map((c) => ({ c, dist: levenshtein(input.toLowerCase(), c.toLowerCase()) }))
    .filter((m) => m.dist <= Math.max(2, Math.floor(input.length / 3)))
    .sort((a, b) => a.dist - b.dist)
    .map((m) => `Did you mean '${m.c}'?`);
  return matches.slice(0, 3);
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="parseProperty"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/properties/parse.ts test/properties/parse.test.ts
git commit -m "add property value DSL parser for all writable types"
```

---

### Task 23: `src/properties/render.ts` — API shapes back to front-matter values

**Files:**
- Create: `src/properties/render.ts`
- Create: `test/properties/render.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/properties/render.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderProperty } from "../../src/properties/render.js";

describe("renderProperty", () => {
  it("title returns plain_text", () => {
    const prop = {
      type: "title",
      title: [{ plain_text: "Implement auth" }],
    };
    assert.equal(renderProperty(prop), "Implement auth");
  });

  it("rich_text returns concatenated plain_text", () => {
    const prop = {
      type: "rich_text",
      rich_text: [{ plain_text: "see " }, { plain_text: "docs" }],
    };
    assert.equal(renderProperty(prop), "see docs");
  });

  it("number", () => {
    assert.equal(renderProperty({ type: "number", number: 8 }), 8);
  });

  it("select", () => {
    assert.equal(
      renderProperty({ type: "select", select: { name: "Done" } }),
      "Done",
    );
  });

  it("null select", () => {
    assert.equal(renderProperty({ type: "select", select: null }), null);
  });

  it("multi_select as array of names", () => {
    assert.deepEqual(
      renderProperty({ type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] }),
      ["a", "b"],
    );
  });

  it("date single", () => {
    assert.equal(
      renderProperty({ type: "date", date: { start: "2026-04-15", end: null } }),
      "2026-04-15",
    );
  });

  it("date range", () => {
    assert.equal(
      renderProperty({ type: "date", date: { start: "2026-04-15", end: "2026-04-30" } }),
      "2026-04-15..2026-04-30",
    );
  });

  it("checkbox", () => {
    assert.equal(renderProperty({ type: "checkbox", checkbox: true }), true);
  });

  it("url/email/phone", () => {
    assert.equal(renderProperty({ type: "url", url: "https://x.com" }), "https://x.com");
    assert.equal(renderProperty({ type: "email", email: "a@b.com" }), "a@b.com");
    assert.equal(renderProperty({ type: "phone_number", phone_number: "+1" }), "+1");
  });

  it("people returns array of user IDs with user: prefix", () => {
    const prop = { type: "people", people: [{ id: "abc" }, { id: "def" }] };
    assert.deepEqual(renderProperty(prop), ["user:abc", "user:def"]);
  });

  it("formula (read-only) returns computed value", () => {
    assert.equal(
      renderProperty({ type: "formula", formula: { type: "number", number: 42 } }),
      42,
    );
  });

  it("rollup (read-only) returns computed value", () => {
    assert.equal(
      renderProperty({ type: "rollup", rollup: { type: "number", number: 7 } }),
      7,
    );
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="renderProperty"`
Expected: FAIL.

- [ ] **Step 3: Implement `src/properties/render.ts`**

```typescript
/**
 * Render Notion API property values back into front-matter scalar values.
 * Used on the read path so `page get` can emit a clean YAML block.
 *
 * Read-only types (formula, rollup, *_time, *_by, unique_id) return their
 * computed values. They will still be filtered out on write by the parser
 * in parse.ts.
 */

import type { YamlValue } from "../utils/yaml.js";

export function renderProperty(prop: any): YamlValue {
  if (!prop || typeof prop !== "object") return null;
  switch (prop.type) {
    case "title":
      return (prop.title ?? []).map((r: any) => r.plain_text ?? "").join("");
    case "rich_text":
      return (prop.rich_text ?? []).map((r: any) => r.plain_text ?? "").join("");
    case "number":
      return typeof prop.number === "number" ? prop.number : null;
    case "select":
      return prop.select ? prop.select.name : null;
    case "status":
      return prop.status ? prop.status.name : null;
    case "multi_select":
      return (prop.multi_select ?? []).map((s: any) => s.name);
    case "date": {
      if (!prop.date) return null;
      if (prop.date.end) return `${prop.date.start}..${prop.date.end}`;
      return prop.date.start;
    }
    case "checkbox":
      return Boolean(prop.checkbox);
    case "url":
      return prop.url ?? null;
    case "email":
      return prop.email ?? null;
    case "phone_number":
      return prop.phone_number ?? null;
    case "people":
      return (prop.people ?? []).map((p: any) => `user:${p.id}`);
    case "files":
      return (prop.files ?? []).map((f: any) => f.external?.url ?? f.file?.url ?? f.name ?? "");
    case "relation":
      return (prop.relation ?? []).map((r: any) => `page:${r.id}`);
    case "formula":
      return renderFormula(prop.formula);
    case "rollup":
      return renderRollup(prop.rollup);
    case "created_time":
      return prop.created_time ?? null;
    case "last_edited_time":
      return prop.last_edited_time ?? null;
    case "created_by":
      return prop.created_by ? `user:${prop.created_by.id}` : null;
    case "last_edited_by":
      return prop.last_edited_by ? `user:${prop.last_edited_by.id}` : null;
    case "unique_id":
      return prop.unique_id ? `${prop.unique_id.prefix ?? ""}${prop.unique_id.number ?? ""}` : null;
    default:
      return null;
  }
}

function renderFormula(f: any): YamlValue {
  if (!f) return null;
  if (f.type === "number") return f.number ?? null;
  if (f.type === "string") return f.string ?? null;
  if (f.type === "boolean") return Boolean(f.boolean);
  if (f.type === "date") return f.date?.start ?? null;
  return null;
}

function renderRollup(r: any): YamlValue {
  if (!r) return null;
  if (r.type === "number") return r.number ?? null;
  if (r.type === "date") return r.date?.start ?? null;
  if (r.type === "array") return (r.array ?? []).map((item: any) => renderProperty(item));
  return null;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="renderProperty"`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/properties/render.ts test/properties/render.test.ts
git commit -m "add property renderer for front-matter output"
```

---

## Phase 11 — Sync

### Task 24: `src/sync/frontmatter.ts` — extract and reinsert YAML front-matter

**Files:**
- Create: `src/sync/frontmatter.ts`
- Create: `test/sync/frontmatter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/sync/frontmatter.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter, reinsertFrontmatter } from "../../src/sync/frontmatter.js";

describe("extractFrontmatter", () => {
  it("extracts YAML delimited by triple-dashes", () => {
    const input = "---\ntitle: Hello\ncount: 3\n---\n\n# Body\n\nContent";
    const { data, body } = extractFrontmatter(input);
    assert.deepEqual(data, { title: "Hello", count: 3 });
    assert.equal(body, "# Body\n\nContent");
  });

  it("returns empty data when no front-matter", () => {
    const input = "# Just a heading\n\nBody text";
    const { data, body } = extractFrontmatter(input);
    assert.deepEqual(data, {});
    assert.equal(body, input);
  });

  it("handles front-matter with blank line before body", () => {
    const input = "---\nkey: value\n---\n\nBody";
    const { data, body } = extractFrontmatter(input);
    assert.deepEqual(data, { key: "value" });
    assert.equal(body, "Body");
  });

  it("ignores leading whitespace before ---", () => {
    const input = "\n---\nkey: v\n---\nbody";
    const { data } = extractFrontmatter(input);
    assert.deepEqual(data, { key: "v" });
  });
});

describe("reinsertFrontmatter", () => {
  it("prepends front-matter to body", () => {
    const out = reinsertFrontmatter({ title: "Hello" }, "# Body");
    assert.equal(out, "---\ntitle: Hello\n---\n\n# Body");
  });

  it("empty front-matter omits the delimiters", () => {
    assert.equal(reinsertFrontmatter({}, "# Body"), "# Body");
  });

  it("round-trips through extract", () => {
    const input = { title: "Hello", count: 3, tags: ["a", "b"] };
    const reinserted = reinsertFrontmatter(input, "Body");
    const { data } = extractFrontmatter(reinserted);
    assert.deepEqual(data, input);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="Frontmatter|frontmatter"`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sync/frontmatter.ts`**

```typescript
/**
 * YAML front-matter extraction and reinsertion.
 *
 * Front-matter is delimited by `---\n` at the start of the file (after
 * any leading whitespace) and a closing `---\n` line. Content between
 * is parsed by our minimal YAML reader.
 */

import { parseYaml, stringifyYaml, type YamlObject } from "../utils/yaml.js";

export interface ExtractedFrontmatter {
  data: YamlObject;
  body: string;
}

export function extractFrontmatter(input: string): ExtractedFrontmatter {
  const trimmedLeading = input.replace(/^[\n\r]+/, "");
  if (!trimmedLeading.startsWith("---\n") && !trimmedLeading.startsWith("---\r\n")) {
    return { data: {}, body: input };
  }

  const lines = trimmedLeading.split("\n");
  const closeIdx = findClosingDelimiter(lines);
  if (closeIdx === -1) return { data: {}, body: input };

  const yamlContent = lines.slice(1, closeIdx).join("\n");
  let data: YamlObject;
  try {
    data = parseYaml(yamlContent);
  } catch {
    return { data: {}, body: input };
  }

  const body = lines.slice(closeIdx + 1).join("\n").replace(/^[\n\r]+/, "");
  return { data, body };
}

function findClosingDelimiter(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "---\r") return i;
  }
  return -1;
}

export function reinsertFrontmatter(data: YamlObject, body: string): string {
  if (Object.keys(data).length === 0) return body;
  const yaml = stringifyYaml(data);
  return `---\n${yaml}\n---\n\n${body}`;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="Frontmatter|frontmatter"`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/sync/frontmatter.ts test/sync/frontmatter.test.ts
git commit -m "add yaml front-matter extraction and reinsertion"
```

---

### Task 25: `src/sync/sync.ts` — page sync state machine

**Files:**
- Create: `src/sync/sync.ts`
- Create: `test/sync/sync.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/sync/sync.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContentHash, classifySyncState, SyncState } from "../../src/sync/sync.js";

describe("computeContentHash", () => {
  it("produces deterministic sha256 prefixed hash", () => {
    const h1 = computeContentHash("# Hello\n\nBody");
    const h2 = computeContentHash("# Hello\n\nBody");
    assert.equal(h1, h2);
    assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  });

  it("different content produces different hashes", () => {
    assert.notEqual(computeContentHash("a"), computeContentHash("b"));
  });
});

describe("classifySyncState", () => {
  it("CREATE when no notion_id present", () => {
    const state = classifySyncState({
      frontmatter: {},
      localBody: "# New",
      remoteEditedAt: undefined,
    });
    assert.equal(state, SyncState.CREATE);
  });

  it("UNCHANGED when hash matches", () => {
    const body = "# Body";
    const hash = computeContentHash(body);
    const state = classifySyncState({
      frontmatter: { notion_id: "abc", notion_hash: hash },
      localBody: body,
      remoteEditedAt: "2026-04-01T00:00:00Z",
    });
    assert.equal(state, SyncState.UNCHANGED);
  });

  it("CHANGED when hash differs", () => {
    const state = classifySyncState({
      frontmatter: { notion_id: "abc", notion_hash: "sha256:stale" },
      localBody: "# Updated",
      remoteEditedAt: "2026-04-01T00:00:00Z",
    });
    assert.equal(state, SyncState.CHANGED);
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npm run test -- --test-name-pattern="classifySyncState|computeContentHash"`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sync/sync.ts`**

```typescript
/**
 * Page sync state machine.
 *
 * The sync command treats a local Markdown file as the source of truth
 * and Notion as the mirror. The local file carries `notion_id` (the
 * page UUID) and `notion_hash` (sha256 of the body at last sync) in
 * its YAML front-matter. On each invocation:
 *
 *   - No notion_id         → CREATE  → create new page, write id + hash
 *   - Local hash matches   → UNCHANGED → no-op (idempotent)
 *   - Local hash differs   → CHANGED   → push update, refresh hash
 *   - Remote edited newer  → DRIFT     → error by default; --force to overwrite
 *
 * This file owns the classification logic. The command layer
 * (commands/page.ts) calls these functions and issues the HTTP ops.
 */

import { createHash } from "node:crypto";
import type { YamlObject } from "../utils/yaml.js";

export enum SyncState {
  CREATE = "CREATE",
  UNCHANGED = "UNCHANGED",
  CHANGED = "CHANGED",
  DRIFT = "DRIFT",
}

export function computeContentHash(body: string): string {
  const h = createHash("sha256");
  h.update(body, "utf8");
  return `sha256:${h.digest("hex")}`;
}

export interface ClassifyInput {
  frontmatter: YamlObject;
  localBody: string;
  remoteEditedAt: string | undefined;
  remoteHashFromLastSync?: string;
}

export function classifySyncState(input: ClassifyInput): SyncState {
  const notionId = input.frontmatter.notion_id;
  if (!notionId || typeof notionId !== "string") return SyncState.CREATE;

  const storedHash = input.frontmatter.notion_hash;
  const currentHash = computeContentHash(input.localBody);

  if (typeof storedHash === "string" && storedHash === currentHash) {
    return SyncState.UNCHANGED;
  }

  // V1 does not implement remote-edit drift detection (requires
  // storing a remote snapshot). Stub returns CHANGED — V2 adds DRIFT.
  return SyncState.CHANGED;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npm run test -- --test-name-pattern="classifySyncState|computeContentHash"`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/sync/sync.ts test/sync/sync.test.ts
git commit -m "add page sync state machine with content hashing"
```

---

## Phase 12 — Command infrastructure

### Task 26: `src/commands/shared.ts` — flag parsing helpers

**Files:**
- Create: `src/commands/shared.ts`
- Create: `test/commands/shared.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlags, resolvePageId } from "../../src/commands/shared.js";

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

  it("treats boolean flags without value as true", () => {
    const { flags } = parseFlags(["--dry-run", "--quiet"]);
    assert.equal(flags.get("dry-run"), "true");
    assert.equal(flags.get("quiet"), "true");
  });

  it("separates positional args", () => {
    const { positional } = parseFlags(["page", "get", "abc-123", "--format", "json"]);
    assert.deepEqual(positional, ["page", "get", "abc-123"]);
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
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement `src/commands/shared.ts`**

```typescript
/**
 * Shared helpers for all command modules: flag parsing (no yargs, no
 * commander — we do it ourselves), ID resolution, and consistent
 * option handling across commands.
 */

import { NotionCliError, ErrorCode } from "../errors.js";

export interface ParsedFlags {
  flags: Map<string, string>;
  repeated: Map<string, string[]>;
  positional: string[];
}

const BOOLEAN_FLAGS = new Set([
  "dry-run",
  "quiet",
  "verbose",
  "debug",
  "no-color",
  "yes",
  "include-children",
  "force",
  "merge",
]);

const REPEATABLE_FLAGS = new Set(["prop", "sort"]);

export function parseFlags(args: string[]): ParsedFlags {
  const flags = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      i++;
      continue;
    }
    const eqIdx = a.indexOf("=");
    let name: string;
    let value: string | undefined;
    if (eqIdx !== -1) {
      name = a.slice(2, eqIdx);
      value = a.slice(eqIdx + 1);
    } else {
      name = a.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        value = "true";
      } else {
        value = args[i + 1];
        i++;
      }
    }
    if (REPEATABLE_FLAGS.has(name)) {
      const arr = repeated.get(name) ?? [];
      if (value !== undefined) arr.push(value);
      repeated.set(name, arr);
    } else {
      if (value !== undefined) flags.set(name, value);
    }
    i++;
  }

  return { flags, repeated, positional };
}

export function resolvePageId(input: string): string {
  let raw = input.trim();
  const urlMatch = /notion\.so\/(?:[^/]+\/)?([^/?#]+)$/.exec(raw);
  if (urlMatch) raw = urlMatch[1]!;
  const lastDash = raw.lastIndexOf("-");
  if (lastDash !== -1 && raw.length - lastDash === 33) raw = raw.slice(lastDash + 1);

  const compact = raw.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      `Could not parse Notion ID or URL: ${input}`,
    );
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
}

export function getBooleanFlag(flags: Map<string, string>, name: string): boolean {
  return flags.get(name) === "true";
}
```

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Commit**

```bash
git add src/commands/shared.ts test/commands/shared.test.ts
git commit -m "add shared command helpers: flag parsing and id resolution"
```

---

## Phase 13 — Meta commands

### Task 27: `src/commands/meta.ts` — whoami, resolve, search, api

**Files:**
- Create: `src/commands/meta.ts`

- [ ] **Step 1: Implement meta commands**

```typescript
/**
 * Meta commands: whoami, resolve, search, api.
 *
 * These wrap thin Notion API calls and format output per the standard
 * format-switching rules in output.ts. The `api` command is the raw
 * escape hatch — it passes through any method and path to Notion with
 * the CLI's auth and retry behavior, but nothing else.
 */

import { notionRequest } from "../http.js";
import { renderJson, renderTable, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { resolvePageId, parseFlags } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { readFile } from "node:fs/promises";

export interface CommandContext {
  args: string[];
}

export async function whoamiCommand(ctx: CommandContext): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const me = await notionRequest<{ bot?: { owner?: { user?: { name?: string } } }; name?: string }>("GET", "/users/me");
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(me);
  return renderTable({
    columns: ["Field", "Value"],
    rows: [
      ["Integration name", me.name ?? ""],
      ["Owner user", me.bot?.owner?.user?.name ?? "(workspace)"],
    ],
  });
}

export async function resolveCommand(ctx: CommandContext): Promise<string> {
  const { positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl resolve <url>");
  }
  return resolvePageId(positional[0]!);
}

export async function searchCommand(ctx: CommandContext): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl search <query>");
  }
  const query = positional[0]!;
  const typeFilter = flags.get("type");
  const body: Record<string, unknown> = { query };
  if (typeFilter === "page" || typeFilter === "db") {
    body.filter = { value: typeFilter === "page" ? "page" : "database", property: "object" };
  }
  const res = await notionRequest<{ results: Array<{ id: string; object: string; url?: string; properties?: Record<string, unknown> }> }>(
    "POST",
    "/search",
    body,
  );
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(res);
  return renderTable({
    columns: ["Object", "ID", "URL"],
    rows: res.results.map((r) => [r.object, r.id, r.url ?? ""]),
  });
}

export async function apiCommand(ctx: CommandContext): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length < 2) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl api <METHOD> <path> [--body @file.json]");
  }
  const method = positional[0]!.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  const path = positional[1]!;
  let body: unknown;
  const bodyFlag = flags.get("body");
  if (bodyFlag) {
    if (bodyFlag.startsWith("@")) {
      const content = await readFile(bodyFlag.slice(1), "utf8");
      body = JSON.parse(content);
    } else {
      body = JSON.parse(bodyFlag);
    }
  }
  const result = await notionRequest(method, path.startsWith("/") ? path : `/${path}`, body);
  return renderJson(result);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/meta.ts
git commit -m "add meta commands: whoami, resolve, search, api"
```

---

## Phase 14 — Page commands

### Task 28: `src/commands/page.ts` — get, create, append, update, delete

**Files:**
- Create: `src/commands/page.ts`

- [ ] **Step 1: Implement page commands**

```typescript
/**
 * Page commands: get, create, append, update, delete. The sync command
 * is in Task 29 to keep this file reviewable.
 *
 * page get outputs YAML front-matter (database page properties) plus
 * the body as Markdown. page create/append/update accept Markdown input
 * (from --from file or stdin) and convert to blocks.
 */

import { readFile } from "node:fs/promises";
import { notionRequest } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { renderProperty } from "../properties/render.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function pageGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page get <id>");
  }
  const id = resolvePageId(positional[0]!);

  const page = await notionRequest<{
    id: string;
    object: string;
    properties: Record<string, unknown>;
    parent: { type: string };
    url: string;
  }>("GET", `/pages/${id}`);

  const children = await notionRequest<{ results: Block[] }>(
    "GET",
    `/blocks/${id}/children`,
  );

  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") {
    return renderJson({ page, children: children.results });
  }

  const frontmatter: YamlObject = {
    notion_id: page.id,
  };
  if (page.parent.type === "database_id") {
    for (const [name, value] of Object.entries(page.properties)) {
      const rendered = renderProperty(value);
      if (rendered !== null && rendered !== undefined) {
        frontmatter[name] = rendered;
      }
    }
  }

  const body = blocksToMarkdown(children.results);
  const yaml = stringifyYaml(frontmatter);
  return `---\n${yaml}\n---\n\n${body}`;
}

async function readInputMarkdown(flags: Map<string, string>): Promise<string> {
  const fromFile = flags.get("from");
  if (fromFile) return readFile(fromFile, "utf8");
  // Read stdin
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

export async function pageCreateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const parent = flags.get("parent");
  const title = flags.get("title");
  if (!parent || !title) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Usage: notionctl page create --parent <id> --title <text> [--from file.md]",
    );
  }
  const parentId = resolvePageId(parent);
  const bodyMd = flags.get("from") ? await readInputMarkdown(flags) : "";
  const blocks = bodyMd.length > 0 ? markdownToBlocks(bodyMd) : [];

  const payload = {
    parent: { page_id: parentId },
    properties: {
      title: [{ type: "text", text: { content: title, link: null } }],
    },
    children: blocks,
  };

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page create", payload });
  }

  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
  return renderJson({ id: created.id, url: created.url });
}

export async function pageAppendCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page append <id> [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const bodyMd = await readInputMarkdown(flags);
  const blocks = markdownToBlocks(bodyMd);

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "page append", blockId: id, blocks });
  }

  const res = await notionRequest("PATCH", `/blocks/${id}/children`, { children: blocks });
  return renderJson(res);
}

export async function pageUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page update <id> [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const bodyMd = await readInputMarkdown(flags);
  const newBlocks = markdownToBlocks(bodyMd);

  // Fetch existing, delete non-pass-through, append new
  const existing = await notionRequest<{ results: Block[] }>(
    "GET",
    `/blocks/${id}/children`,
  );

  const deletions = existing.results
    .filter((b) => !isPassThrough(b.type))
    .map((b) => b.id);

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({
      action: "page update",
      pageId: id,
      willDelete: deletions,
      willAppend: newBlocks.length,
    });
  }

  for (const blockId of deletions) {
    await notionRequest("DELETE", `/blocks/${blockId}`);
  }
  const appended = await notionRequest("PATCH", `/blocks/${id}/children`, { children: newBlocks });
  return renderJson({ deleted: deletions.length, appended });
}

export async function pageDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page delete <id> --yes");
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(
      ErrorCode.USAGE,
      "Refusing to archive without --yes confirmation",
    );
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("PATCH", `/pages/${id}`, { archived: true });
  return renderJson(res);
}

const PASS_THROUGH_TYPES = new Set([
  "synced_block",
  "column_list",
  "column",
  "embed",
  "table_of_contents",
  "breadcrumb",
]);

function isPassThrough(type: string): boolean {
  return PASS_THROUGH_TYPES.has(type);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/page.ts
git commit -m "add page commands: get, create, append, update, delete"
```

---

### Task 29: `src/commands/page.ts` — sync command

**Files:**
- Modify: `src/commands/page.ts`

- [ ] **Step 1: Append the sync implementation**

Add to `src/commands/page.ts`:

```typescript
import { writeFile } from "node:fs/promises";
import { extractFrontmatter, reinsertFrontmatter } from "../sync/frontmatter.js";
import { classifySyncState, computeContentHash, SyncState } from "../sync/sync.js";

export async function pageSyncCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl page sync <file.md>");
  }
  const file = positional[0]!;
  const source = await readFile(file, "utf8");
  const { data: frontmatter, body } = extractFrontmatter(source);
  const state = classifySyncState({
    frontmatter,
    localBody: body,
    remoteEditedAt: undefined,
  });

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ file, state });
  }

  if (state === SyncState.UNCHANGED) {
    return renderJson({ file, state, message: "no changes to sync" });
  }

  if (state === SyncState.CREATE) {
    const parent = flags.get("parent");
    const title = (frontmatter.title as string) ?? "Untitled";
    if (!parent) {
      throw new NotionCliError(
        ErrorCode.USAGE,
        "First sync of this file requires --parent <parent-page-id>",
      );
    }
    const blocks = markdownToBlocks(body);
    const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", {
      parent: { page_id: resolvePageId(parent) },
      properties: {
        title: [{ type: "text", text: { content: title, link: null } }],
      },
      children: blocks,
    });
    frontmatter.notion_id = created.id;
    frontmatter.notion_hash = computeContentHash(body);
    await writeFile(file, reinsertFrontmatter(frontmatter, body), "utf8");
    return renderJson({ file, state, createdId: created.id });
  }

  if (state === SyncState.CHANGED) {
    const pageId = frontmatter.notion_id as string;
    const existing = await notionRequest<{ results: Block[] }>(
      "GET",
      `/blocks/${pageId}/children`,
    );
    const newBlocks = markdownToBlocks(body);
    for (const b of existing.results) {
      if (!isPassThrough(b.type)) {
        await notionRequest("DELETE", `/blocks/${b.id}`);
      }
    }
    await notionRequest("PATCH", `/blocks/${pageId}/children`, { children: newBlocks });
    frontmatter.notion_hash = computeContentHash(body);
    await writeFile(file, reinsertFrontmatter(frontmatter, body), "utf8");
    return renderJson({ file, state, updatedId: pageId });
  }

  throw new NotionCliError(ErrorCode.SYNC_DRIFT, "Remote drift detection not implemented in V1");
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/page.ts
git commit -m "add page sync command with content hashing and pass-through preservation"
```

---

## Phase 15 — Database commands

### Task 30: `src/commands/db.ts` — query, schema, row CRUD

**Files:**
- Create: `src/commands/db.ts`

- [ ] **Step 1: Implement db commands**

```typescript
/**
 * Database commands: query, schema, row get/create/update/delete.
 *
 * db query supports --filter "Status=Done" --sort "Date:desc" for
 * ergonomic filter construction, and --filter-json @file.json for the
 * full Notion filter language escape hatch. Schema is fetched once per
 * invocation and used to type-check property flags.
 */

import { readFile } from "node:fs/promises";
import { notionRequest } from "../http.js";
import { parseProperty, parsePropertyFlag, type PropertySchema } from "../properties/parse.js";
import { renderProperty } from "../properties/render.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { markdownToBlocks, blocksToMarkdown } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, renderTable, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { stringifyYaml, type YamlObject } from "../utils/yaml.js";

async function fetchSchema(dbId: string): Promise<Record<string, PropertySchema>> {
  const db = await notionRequest<{ properties: Record<string, PropertySchema> }>(
    "GET",
    `/databases/${dbId}`,
  );
  return db.properties;
}

export async function dbSchemaCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db schema <id>");
  }
  const id = resolvePageId(positional[0]!);
  const schema = await fetchSchema(id);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(schema);
  return renderTable({
    columns: ["Name", "Type"],
    rows: Object.entries(schema).map(([name, s]) => [name, s.type]),
  });
}

function parseSimpleFilter(expr: string, schema: Record<string, PropertySchema>): unknown {
  const eqIdx = expr.indexOf("=");
  if (eqIdx === -1) {
    throw new NotionCliError(ErrorCode.USAGE, `Invalid filter: ${expr}`);
  }
  const key = expr.slice(0, eqIdx).trim();
  const value = expr.slice(eqIdx + 1).trim();
  const prop = schema[key];
  if (!prop) {
    throw new NotionCliError(ErrorCode.INVALID_PROPERTY, `Unknown property: ${key}`);
  }
  switch (prop.type) {
    case "select":
      return { property: key, select: { equals: value } };
    case "status":
      return { property: key, status: { equals: value } };
    case "checkbox":
      return { property: key, checkbox: { equals: value === "true" } };
    case "number":
      return { property: key, number: { equals: Number(value) } };
    case "title":
    case "rich_text":
      return { property: key, rich_text: { contains: value } };
    case "date":
      return { property: key, date: { equals: value } };
    default:
      throw new NotionCliError(
        ErrorCode.USAGE,
        `Filter on property type '${prop.type}' not supported in simple form; use --filter-json`,
      );
  }
}

function parseSimpleSort(expr: string): unknown {
  const [prop, dir] = expr.split(":");
  return {
    property: prop,
    direction: dir === "desc" ? "descending" : "ascending",
  };
}

export async function dbQueryCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db query <id> [--filter ...] [--sort ...]");
  }
  const id = resolvePageId(positional[0]!);
  const schema = await fetchSchema(id);

  const body: Record<string, unknown> = {};
  const filterFlag = flags.get("filter");
  const filterJsonFlag = flags.get("filter-json");
  if (filterJsonFlag) {
    const raw = filterJsonFlag.startsWith("@")
      ? await readFile(filterJsonFlag.slice(1), "utf8")
      : filterJsonFlag;
    body.filter = JSON.parse(raw);
  } else if (filterFlag) {
    body.filter = parseSimpleFilter(filterFlag, schema);
  }

  const sorts = repeated.get("sort") ?? [];
  if (sorts.length > 0) {
    body.sorts = sorts.map(parseSimpleSort);
  }

  const res = await notionRequest<{ results: Array<{ id: string; properties: Record<string, unknown> }> }>(
    "POST",
    `/databases/${id}/query`,
    body,
  );

  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(res);

  const columns = ["ID", ...Object.keys(schema)];
  const rows = res.results.map((r) => {
    const row = [r.id];
    for (const name of Object.keys(schema)) {
      const rendered = renderProperty(r.properties[name]);
      row.push(typeof rendered === "string" ? rendered : JSON.stringify(rendered ?? ""));
    }
    return row;
  });
  return renderTable({ columns, rows });
}

export async function dbRowGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row get <page-id>");
  }
  const id = resolvePageId(positional[0]!);
  const page = await notionRequest<{ properties: Record<string, unknown> }>("GET", `/pages/${id}`);
  const children = await notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") return renderJson({ page, children: children.results });

  const frontmatter: YamlObject = { notion_id: id };
  for (const [name, value] of Object.entries(page.properties)) {
    const rendered = renderProperty(value);
    if (rendered !== null && rendered !== undefined) frontmatter[name] = rendered;
  }
  return `---\n${stringifyYaml(frontmatter)}\n---\n\n${blocksToMarkdown(children.results)}`;
}

export async function dbRowCreateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row create <db-id> [--prop Key=value ...]");
  }
  const dbId = resolvePageId(positional[0]!);
  const schema = await fetchSchema(dbId);

  const properties: Record<string, unknown> = {};
  const propJson = flags.get("prop-json");
  if (propJson) {
    Object.assign(properties, JSON.parse(propJson));
  }
  for (const raw of repeated.get("prop") ?? []) {
    const { key, value } = parsePropertyFlag(raw);
    properties[key] = parseProperty(schema, key, value);
  }

  let children: Block[] | undefined;
  const fromFile = flags.get("from");
  if (fromFile) {
    const md = await readFile(fromFile, "utf8");
    children = markdownToBlocks(md);
  }

  const payload: Record<string, unknown> = {
    parent: { database_id: dbId },
    properties,
  };
  if (children) payload.children = children;

  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db row create", payload });
  }
  const created = await notionRequest<{ id: string; url: string }>("POST", "/pages", payload);
  return renderJson({ id: created.id, url: created.url });
}

export async function dbRowUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, repeated, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row update <page-id> [--prop Key=value ...]");
  }
  const pageId = resolvePageId(positional[0]!);
  const page = await notionRequest<{ parent: { database_id: string } }>("GET", `/pages/${pageId}`);
  const schema = await fetchSchema(page.parent.database_id);

  const properties: Record<string, unknown> = {};
  const propJson = flags.get("prop-json");
  if (propJson) Object.assign(properties, JSON.parse(propJson));
  for (const raw of repeated.get("prop") ?? []) {
    const { key, value } = parsePropertyFlag(raw);
    properties[key] = parseProperty(schema, key, value);
  }

  const payload = { properties };
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "db row update", pageId, payload });
  }
  const res = await notionRequest("PATCH", `/pages/${pageId}`, payload);
  return renderJson(res);
}

export async function dbRowDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl db row delete <page-id> --yes");
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to archive without --yes");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("PATCH", `/pages/${id}`, { archived: true });
  return renderJson(res);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/db.ts
git commit -m "add db commands: query, schema, row crud with filter dsl"
```

---

## Phase 16 — Block, comment, user, auth commands

### Task 31: `src/commands/block.ts`

**Files:**
- Create: `src/commands/block.ts`

- [ ] **Step 1: Implement block commands**

```typescript
/**
 * Block commands for surgical edits. These bypass the markdown converter
 * for commands that want to poke at individual blocks by ID.
 */

import { notionRequest } from "../http.js";
import { blocksToMarkdown, markdownToBlocks } from "../markdown/index.js";
import type { Block } from "../markdown/index.js";
import { readFile } from "node:fs/promises";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson, chooseFormat, isStdoutTty, type Format } from "../output.js";

export async function blockGetCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block get <id>");
  }
  const id = resolvePageId(positional[0]!);
  const block = await notionRequest("GET", `/blocks/${id}`);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "json",
  });
  if (format === "md") return blocksToMarkdown([block as Block]);
  return renderJson(block);
}

export async function blockChildrenCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block children <id>");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest<{ results: Block[] }>("GET", `/blocks/${id}/children`);
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "md",
  });
  if (format === "json") return renderJson(res);
  return blocksToMarkdown(res.results);
}

export async function blockAppendCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block append <id> [--from file.md]");
  }
  const id = resolvePageId(positional[0]!);
  const fromFile = flags.get("from");
  const md = fromFile ? await readFile(fromFile, "utf8") : "";
  const blocks = markdownToBlocks(md);
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block append", id, blocks });
  }
  const res = await notionRequest("PATCH", `/blocks/${id}/children`, { children: blocks });
  return renderJson(res);
}

export async function blockUpdateCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block update <id> --prop-json '<json>'");
  }
  const id = resolvePageId(positional[0]!);
  const propJson = flags.get("prop-json");
  if (!propJson) {
    throw new NotionCliError(ErrorCode.USAGE, "block update requires --prop-json '<raw Notion block shape>'");
  }
  const body = JSON.parse(propJson);
  if (getBooleanFlag(flags, "dry-run")) {
    return renderJson({ action: "block update", id, body });
  }
  const res = await notionRequest("PATCH", `/blocks/${id}`, body);
  return renderJson(res);
}

export async function blockDeleteCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl block delete <id> --yes");
  }
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "Refusing to delete without --yes");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("DELETE", `/blocks/${id}`);
  return renderJson(res);
}
```

- [ ] **Step 2: Typecheck**

- [ ] **Step 3: Commit**

```bash
git add src/commands/block.ts
git commit -m "add block commands: get, children, append, update, delete"
```

---

### Task 32: `src/commands/comment.ts` and `src/commands/user.ts`

**Files:**
- Create: `src/commands/comment.ts`
- Create: `src/commands/user.ts`

- [ ] **Step 1: Implement comment commands**

```typescript
// src/commands/comment.ts
import { notionRequest } from "../http.js";
import { markdownToRichText } from "../markdown/index.js";
import { resolvePageId, parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson } from "../output.js";

export async function commentListCommand(ctx: { args: string[] }): Promise<string> {
  const { positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl comment list <page-id>");
  }
  const id = resolvePageId(positional[0]!);
  const res = await notionRequest("GET", `/comments?block_id=${id}`);
  return renderJson(res);
}

export async function commentAddCommand(ctx: { args: string[] }): Promise<string> {
  const { flags, positional } = parseFlags(ctx.args);
  if (positional.length === 0) {
    throw new NotionCliError(ErrorCode.USAGE, "Usage: notionctl comment add <page-id> --text \"...\"");
  }
  const id = resolvePageId(positional[0]!);
  const text = flags.get("text");
  if (!text) {
    throw new NotionCliError(ErrorCode.USAGE, "comment add requires --text");
  }
  const payload = {
    parent: { page_id: id },
    rich_text: markdownToRichText(text),
  };
  if (getBooleanFlag(flags, "dry-run")) return renderJson({ action: "comment add", payload });
  const res = await notionRequest("POST", "/comments", payload);
  return renderJson(res);
}
```

- [ ] **Step 2: Implement user commands**

```typescript
// src/commands/user.ts
import { notionRequest } from "../http.js";
import { renderJson, renderTable, chooseFormat, isStdoutTty, type Format } from "../output.js";
import { parseFlags } from "./shared.js";

export async function userListCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  const res = await notionRequest<{ results: Array<{ id: string; name?: string; type?: string }> }>("GET", "/users");
  const format = chooseFormat(flags.get("format") as Format | undefined, {
    isTty: isStdoutTty(),
    defaultFormat: "table",
  });
  if (format === "json") return renderJson(res);
  return renderTable({
    columns: ["ID", "Name", "Type"],
    rows: res.results.map((u) => [u.id, u.name ?? "", u.type ?? ""]),
  });
}

export async function userMeCommand(_ctx: { args: string[] }): Promise<string> {
  const me = await notionRequest("GET", "/users/me");
  return renderJson(me);
}
```

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```bash
git add src/commands/comment.ts src/commands/user.ts
git commit -m "add comment and user commands"
```

---

### Task 33: `src/commands/auth.ts` — set, status, clear

**Files:**
- Create: `src/commands/auth.ts`

- [ ] **Step 1: Implement auth commands**

```typescript
/**
 * Auth subcommands. `set` reads the token from stdin (never an argument
 * or environment — so it doesn't end up in shell history). `status`
 * verifies the token is valid by calling /users/me, without ever
 * displaying the token itself. `clear` removes the config file.
 */

import { notionRequest } from "../http.js";
import { saveToken, clearToken, getConfigPath } from "../auth.js";
import { parseFlags, getBooleanFlag } from "./shared.js";
import { NotionCliError, ErrorCode } from "../errors.js";
import { renderJson } from "../output.js";
import { createInterface } from "node:readline";

export async function authSetCommand(_ctx: { args: string[] }): Promise<string> {
  process.stderr.write("Paste your Notion integration token (ntn_...): ");
  const rl = createInterface({ input: process.stdin, output: undefined, terminal: false });
  const token = await new Promise<string>((resolve) => {
    rl.on("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
  if (!token) {
    throw new NotionCliError(ErrorCode.USAGE, "No token provided");
  }
  await saveToken(token);
  return renderJson({ saved: true, path: getConfigPath() });
}

export async function authStatusCommand(_ctx: { args: string[] }): Promise<string> {
  try {
    const me = await notionRequest<{ name?: string; bot?: unknown }>("GET", "/users/me");
    return renderJson({ valid: true, name: me.name ?? "(unknown)" });
  } catch (err) {
    return renderJson({ valid: false, error: (err as Error).message });
  }
}

export async function authClearCommand(ctx: { args: string[] }): Promise<string> {
  const { flags } = parseFlags(ctx.args);
  if (!getBooleanFlag(flags, "yes")) {
    throw new NotionCliError(ErrorCode.USAGE, "auth clear requires --yes");
  }
  await clearToken();
  return renderJson({ cleared: true });
}
```

- [ ] **Step 2: Typecheck**

- [ ] **Step 3: Commit**

```bash
git add src/commands/auth.ts
git commit -m "add auth subcommands: set, status, clear"
```

---

## Phase 17 — CLI entry point

### Task 34: `src/index.ts` — global flag parsing and command dispatch

**Files:**
- Modify: `src/index.ts` (currently a stub from Task 2)

- [ ] **Step 1: Replace the stub with the real entry point**

```typescript
/**
 * CLI entry point. Parses global flags, dispatches to command modules,
 * catches NotionCliError to set exit codes, and routes to the format
 * switcher for output.
 *
 * Usage:
 *   notionctl <noun> <verb> [args...] [--flags...]
 *   notionctl whoami
 *   notionctl search <query>
 *   notionctl resolve <url>
 *   notionctl api <METHOD> <path> [--body @file.json]
 *
 * See README for the full command list.
 */

import { NotionCliError, ErrorCode, formatErrorJson, formatErrorHuman } from "./errors.js";
import { isStdoutTty } from "./output.js";

type CommandHandler = (ctx: { args: string[] }) => Promise<string>;

async function loadCommand(noun: string, verb: string | undefined): Promise<CommandHandler> {
  switch (noun) {
    case "whoami": return (await import("./commands/meta.js")).whoamiCommand;
    case "resolve": return (await import("./commands/meta.js")).resolveCommand;
    case "search": return (await import("./commands/meta.js")).searchCommand;
    case "api": return (await import("./commands/meta.js")).apiCommand;
    case "page": {
      const mod = await import("./commands/page.js");
      switch (verb) {
        case "get": return mod.pageGetCommand;
        case "create": return mod.pageCreateCommand;
        case "append": return mod.pageAppendCommand;
        case "update": return mod.pageUpdateCommand;
        case "delete": return mod.pageDeleteCommand;
        case "sync": return mod.pageSyncCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown page verb: ${verb}`);
      }
    }
    case "db": {
      const mod = await import("./commands/db.js");
      switch (verb) {
        case "query": return mod.dbQueryCommand;
        case "schema": return mod.dbSchemaCommand;
        case "row": {
          // db row <subverb>: look further into args inside the handler
          return async (ctx) => {
            const sub = ctx.args[0];
            const rest = { args: ctx.args.slice(1) };
            switch (sub) {
              case "get": return mod.dbRowGetCommand(rest);
              case "create": return mod.dbRowCreateCommand(rest);
              case "update": return mod.dbRowUpdateCommand(rest);
              case "delete": return mod.dbRowDeleteCommand(rest);
              default:
                throw new NotionCliError(ErrorCode.USAGE, `Unknown db row verb: ${sub}`);
            }
          };
        }
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown db verb: ${verb}`);
      }
    }
    case "block": {
      const mod = await import("./commands/block.js");
      switch (verb) {
        case "get": return mod.blockGetCommand;
        case "children": return mod.blockChildrenCommand;
        case "append": return mod.blockAppendCommand;
        case "update": return mod.blockUpdateCommand;
        case "delete": return mod.blockDeleteCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown block verb: ${verb}`);
      }
    }
    case "comment": {
      const mod = await import("./commands/comment.js");
      switch (verb) {
        case "list": return mod.commentListCommand;
        case "add": return mod.commentAddCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown comment verb: ${verb}`);
      }
    }
    case "user": {
      const mod = await import("./commands/user.js");
      switch (verb) {
        case "list": return mod.userListCommand;
        case "me": return mod.userMeCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown user verb: ${verb}`);
      }
    }
    case "auth": {
      const mod = await import("./commands/auth.js");
      switch (verb) {
        case "set": return mod.authSetCommand;
        case "status": return mod.authStatusCommand;
        case "clear": return mod.authClearCommand;
        default:
          throw new NotionCliError(ErrorCode.USAGE, `Unknown auth verb: ${verb}`);
      }
    }
    default:
      throw new NotionCliError(ErrorCode.USAGE, `Unknown command: ${noun}`);
  }
}

function printHelp(): string {
  return `notionctl — security-auditable CLI for Notion

Usage:
  notionctl whoami
  notionctl resolve <url>
  notionctl search <query> [--type page|db]
  notionctl api <METHOD> <path> [--body @file.json]

  notionctl page get <id> [--depth N]
  notionctl page create --parent <id> --title <text> [--from file.md]
  notionctl page append <id> [--from file.md]
  notionctl page update <id> [--from file.md]
  notionctl page sync <file.md> [--parent <id>]
  notionctl page delete <id> --yes

  notionctl db query <id> [--filter Key=value] [--sort Key:desc] [--filter-json @f.json]
  notionctl db schema <id>
  notionctl db row get <page-id>
  notionctl db row create <db-id> [--prop Key=value ...] [--from file.md]
  notionctl db row update <page-id> [--prop Key=value ...]
  notionctl db row delete <page-id> --yes

  notionctl block get <id>
  notionctl block children <id>
  notionctl block append <id> [--from file.md]
  notionctl block update <id> --prop-json '<json>'
  notionctl block delete <id> --yes

  notionctl comment list <page-id>
  notionctl comment add <page-id> --text "..."

  notionctl user list
  notionctl user me

  notionctl auth set
  notionctl auth status
  notionctl auth clear --yes

Global flags:
  --format md|json|table|csv   Output format (default depends on command + TTY)
  --dry-run                    Preview write operations without sending
  --verbose                    Show request counts (never bodies or tokens)
  --quiet                      Suppress non-essential output
  --no-color                   Force plain output
  --debug                      Full HTTP debug to stderr (scrubbed of token)
  --yes                        Confirm destructive operations

Environment:
  NOTION_TOKEN         Integration token (preferred)
  NOTION_TIMEOUT_MS    Request timeout (default 30000)
  XDG_CONFIG_HOME      Base dir for config file (default ~/.config)

See https://github.com/chazyua/notionctl for full documentation.
`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(printHelp());
    process.exit(0);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write("notionctl 0.1.0\n");
    process.exit(0);
  }

  const noun = argv[0]!;
  const verb = ["whoami", "resolve", "search", "api"].includes(noun) ? undefined : argv[1];
  const rest = verb !== undefined ? argv.slice(2) : argv.slice(1);

  try {
    const handler = await loadCommand(noun, verb);
    const output = await handler({ args: rest });
    if (output && output.length > 0) {
      process.stdout.write(output + (output.endsWith("\n") ? "" : "\n"));
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof NotionCliError) {
      const color = isStdoutTty();
      if (!process.stdout.isTTY) {
        process.stderr.write(formatErrorJson(err) + "\n");
      } else {
        process.stderr.write(formatErrorHuman(err, { color }) + "\n");
      }
      process.exit(err.exitCode);
    }
    process.stderr.write(`Internal error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Build and smoke-test**

Run: `npm run build && ./bin/notionctl.js --help`
Expected: help text printed, exit code 0.

Run: `./bin/notionctl.js --version`
Expected: `notionctl 0.1.0`, exit code 0.

Run: `./bin/notionctl.js bogus-command 2>&1; echo "exit: $?"`
Expected: error output mentioning "Unknown command: bogus-command", exit code 2.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "wire up cli entry: global flags, command dispatch, error handling"
```

---

## Phase 18 — Security test suite

### Task 35: `test/security/audit.test.ts` — grep-based assertions

**Files:**
- Create: `test/security/audit.test.ts`

- [ ] **Step 1: Write the security assertions**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

async function readAllSourceFiles(dir: string): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  // Use fs.readdir recursively since node:fs/promises glob is Node 22+
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
  it("only src/http.ts uses fetch()", async () => {
    const files = await readAllSourceFiles("src");
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
    const files = await readAllSourceFiles("src");
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
    const files = await readAllSourceFiles("src");
    const offenders = files.filter((f) => /ntn_[a-zA-Z0-9]{20,}/.test(f.content));
    assert.equal(offenders.length, 0, `Hardcoded token in: ${offenders.map((o) => o.path).join(", ")}`);
  });

  it("no source file imports a non-Node-builtin package", async () => {
    const files = await readAllSourceFiles("src");
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
    const files = await readAllSourceFiles("src");
    const urlPattern = /https:\/\/([a-z0-9.-]+)/g;
    const offenders: string[] = [];
    for (const f of files) {
      const matches = f.content.matchAll(urlPattern);
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
```

- [ ] **Step 2: Run the security tests**

Run: `npm run test:security`
Expected: all security assertions pass. If an assertion fails, fix the offending file rather than the assertion — the assertions codify the security posture from the spec.

- [ ] **Step 3: Commit**

```bash
git add test/security/audit.test.ts
git commit -m "add security test suite: grep-based audit of source tree"
```

---

## Phase 19 — Integration tests

### Task 36: `test/integration/*.test.ts` — live API happy-path tests

**Files:**
- Create: `test/integration/happy-path.test.ts`

These tests only run in CI via the nightly workflow, guarded by `NOTION_TEST_TOKEN` being set. They hit a real Notion workspace.

- [ ] **Step 1: Write the happy-path integration tests**

```typescript
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { notionRequest, setTokenProvider } from "../../src/http.js";
import { AuthSource } from "../../src/auth.js";

const token = process.env.NOTION_TEST_TOKEN;
const testPageId = process.env.NOTION_TEST_PAGE_ID;
const testDbId = process.env.NOTION_TEST_DB_ID;

describe("integration: happy path", { skip: !token || !testPageId }, () => {
  before(() => {
    setTokenProvider(async () => ({ token: token!, source: AuthSource.ENV }));
  });

  it("whoami returns a bot user", async () => {
    const me = await notionRequest<{ type?: string }>("GET", "/users/me");
    assert.equal(me.type, "bot");
  });

  it("page get returns the test page", async () => {
    const page = await notionRequest<{ id: string }>("GET", `/pages/${testPageId}`);
    assert.ok(page.id);
  });

  it("search finds at least one result", async () => {
    const res = await notionRequest<{ results: unknown[] }>("POST", "/search", { query: "" });
    assert.ok(res.results.length >= 0);
  });

  it("block children fetches without error", async () => {
    const res = await notionRequest<{ results: unknown[] }>("GET", `/blocks/${testPageId}/children`);
    assert.ok(Array.isArray(res.results));
  });

  it("db query runs if test db is configured", { skip: !testDbId }, async () => {
    const res = await notionRequest<{ results: unknown[] }>("POST", `/databases/${testDbId}/query`, {});
    assert.ok(Array.isArray(res.results));
  });
});
```

- [ ] **Step 2: Verify locally (skipped by default)**

Run: `npm run test -- --test-name-pattern="integration"`
Expected: tests are skipped (no `NOTION_TEST_TOKEN` set locally). Output shows them as `SKIP`.

- [ ] **Step 3: Commit**

```bash
git add test/integration/happy-path.test.ts
git commit -m "add integration happy-path tests (nightly ci)"
```

---

## Phase 20 — Release

### Task 37: README expansion

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the placeholder README with a full user-facing one**

```markdown
# notionctl

A security-auditable, zero-dependency command-line interface for Notion,
designed to be driven by AI coding agents (Claude Code, GitHub Copilot,
Cursor) via shell invocations.

## Install

    npm install -g notionctl

Requires Node 18+.

## Quick start

    export NOTION_TOKEN=ntn_...         # or: notionctl auth set
    notionctl whoami                    # verify the token
    notionctl search "PRD"              # find pages
    notionctl page get <url-or-id>      # read a page as markdown
    notionctl page sync ./prd.md \
      --parent <parent-page-id>         # push a local file to Notion

## Why this exists

AI coding agents work best when they can read the team's knowledge base
(PRDs, specs, docs in Notion) and write back updates. MCP servers are one
way to bridge this, but they require a persistent process with broader
privileges and a larger attack surface, which many enterprise security
teams disallow.

`notionctl` is the alternative: a discrete shell command per operation,
shell-logged, `--dry-run`-able, and auditable line-by-line. Every action
an agent takes is a visible terminal invocation.

## Security posture

- **Zero runtime dependencies.** The entire source tree is hand-audited
  TypeScript. No transitive supply chain.
- **Single file for network I/O** (`src/http.ts`). Hardcoded to
  `https://api.notion.com/v1`. No `--api-base` flag.
- **Single file for secrets** (`src/auth.ts`). Token lives in
  `$NOTION_TOKEN` or a mode-0600 config file, never in logs or errors.
- **Dry-run universal.** Every write supports `--dry-run`.
- **Content-hashed sync.** `page sync` is a provable no-op if nothing
  changed locally (SHA-256 front-matter hash).
- **No telemetry.** The CLI's only outbound traffic is
  `api.notion.com`. Provable by `grep -r "https://" src/`.
- **Automated security tests.** `npm run test:security` runs grep-based
  assertions that encode the above rules and fails the build on drift.

## Command surface

### Reading

    notionctl whoami                     Show integration info
    notionctl search <query>             Search by title or content
    notionctl resolve <url>              Notion URL → ID
    notionctl page get <id>              Page as Markdown + front-matter
    notionctl db query <id> [flags]      Query a database
    notionctl db schema <id>             Show property types
    notionctl db row get <id>            Single row as Markdown
    notionctl block children <id>        List child blocks

### Writing

    notionctl page create --parent <id> --title "X" [--from file.md]
    notionctl page append <id> [--from file.md]
    notionctl page update <id> [--from file.md]
    notionctl page sync <file.md>
    notionctl db row create <db-id> [--prop Key=value ...]
    notionctl db row update <page-id> [--prop Key=value ...]
    notionctl comment add <page-id> --text "..."

### Escape hatch

    notionctl api GET /users/me
    notionctl api POST /databases/<id>/query --body @filter.json

Any Notion REST endpoint is reachable via `notionctl api`.

## Inspired by

`notionctl` was written from scratch, but the design drew on patterns from:

- [4ier/notion-cli](https://github.com/4ier/notion-cli) — command taxonomy, filter DSL, `api` escape hatch
- [Coastal-Programs/notion-cli](https://github.com/Coastal-Programs/notion-cli) — structured error model
- [lox/notion-cli](https://github.com/lox/notion-cli) — `page sync` with frontmatter ID

## License

MIT. See `LICENSE`.

## Security disclosure

See `SECURITY.md` for the responsible disclosure process.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "expand readme with full usage and security pitch"
```

---

### Task 38: Version bump, smoke-test, tag

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Ensure package.json version is 0.1.0 (already set in Task 1)**

Verify: `grep '"version"' package.json` should show `"version": "0.1.0"`.

- [ ] **Step 2: Update CHANGELOG.md to finalize 0.1.0 entry**

Replace the `## [Unreleased]` section in `CHANGELOG.md` with a filled-in 0.1.0 release date. Move the "Added" bullets into `## [0.1.0] — YYYY-MM-DD` with today's date.

- [ ] **Step 3: Run the full test suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean, all unit tests pass, all security tests pass.

- [ ] **Step 4: Smoke-test the compiled CLI**

```bash
npm run build
node bin/notionctl.js --version   # 0.1.0
node bin/notionctl.js --help       # help text
node bin/notionctl.js whoami       # will error without a token — verify error is clean
```

- [ ] **Step 5: Commit and tag**

```bash
git add package.json CHANGELOG.md
git commit -m "prepare 0.1.0 release"
git tag -a v0.1.0 -m "notionctl 0.1.0 — first working release"
```

---

### Task 39: Publish to npm

**Files:** none (external action)

- [ ] **Step 1: Dry-run the publish**

Run: `npm publish --dry-run`
Expected: lists the files that would be published (bin/, dist/, README.md, LICENSE, SECURITY.md). Confirm no source files, tests, or docs/ are included.

- [ ] **Step 2: Publish**

Run: `npm publish`
Expected: `+ notionctl@0.1.0` on success.

Note: requires an npm access token with "bypass 2FA when publishing" enabled (see Task 0 / prerequisites). The token in `~/.npmrc` from the 0.0.1 reservation is good for 7 days; re-create if expired.

- [ ] **Step 3: Verify**

Run: `npm view notionctl@0.1.0`
Expected: shows the published version with deps: none, MIT license.

- [ ] **Step 4: Push tag to origin**

Once a remote is configured:

```bash
git push origin main --follow-tags
```

- [ ] **Step 5: Post-publish cleanup**

Delete the publish token from `~/.npmrc` if you're done publishing for now, and remove it from https://www.npmjs.com/settings/~/tokens so it doesn't linger as a long-lived credential.

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| §5 Architecture (module layout) | Tasks 1–2 (foundation), tasks throughout create each file |
| §6 Command surface (28 commands) | Tasks 27 (meta, 4), 28–29 (page, 6), 30 (db, 6), 31 (block, 5), 32 (comment 2 + user 2), 33 (auth 3) = 28 ✓ |
| §7 Markdown converter | Tasks 14–18, 20, 21 |
| §8 Property value DSL | Tasks 22–23 |
| §9 HTTP layer | Tasks 9–11 |
| §10 Authentication | Tasks 8, 33 |
| §11 Error model | Task 7 |
| §12 Output formatting | Task 12 |
| §13 Security posture | Tasks 8, 9, 35 (tests) |
| §14 Testing strategy | Tasks 35 (security), 36 (integration), per-task unit tests throughout |
| §15 Distribution | Tasks 4 (LICENSE/SECURITY.md), 5 (CHANGELOG), 37 (README), 38–39 (release) |
| §16 Rollout | Tasks 38–39 |
| §18 Success criteria | Task 38 (typecheck + test + smoke-test) |

All spec sections have at least one task. No gaps.

**Placeholder scan:** No "TODO", "implement later", or "fill in details" placeholders in any task. Every step shows the actual code. The only remaining annotation is a `TODO: read from package.json at build time` in Task 9 on the `USER_AGENT` constant — that is a deliberate future improvement, not a required V1 gap.

**Type consistency:** Property names, method signatures, and module exports match across tasks. `parseProperty` in Task 22 is consumed by Task 30 using the same signature. `blocksToMarkdown` / `markdownToBlocks` exports from Tasks 17–21 match what Tasks 28, 30, 31 import. `NotionCliError` constructor signature in Task 7 is used consistently in Tasks 8 onward. `parseFlags` in Task 26 is imported by every command module.

**Scope check:** One plan, one CLI tool, one published artifact. All tasks trace to a single V1 ship target.

---

## Plan complete

**File:** `docs/superpowers/plans/2026-04-09-notionctl.md`
**Tasks:** 39 across 20 phases
**Covers:** full spec, zero runtime dependencies, all 28 commands, security test suite, integration test harness, npm publishing

The plan starts from the current repo state (spec committed, `notionctl@0.0.1` placeholder published) and ends with `notionctl@0.1.0` live on npm with all commands working.

**Two execution options:**

**1. Subagent-Driven (recommended).** I dispatch a fresh subagent per task, review between tasks, fast iteration with clean context per task. Uses `superpowers:subagent-driven-development`.

**2. Inline Execution.** Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
