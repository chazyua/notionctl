import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apiCommand } from "../../src/commands/meta.js";
import { NotionCliError, ErrorCode } from "../../src/errors.js";

// The --yes gate is a synchronous check that fires before any HTTP call,
// so these tests do not need a token provider or a network connection —
// they only exercise the guard itself.

describe("bug hunt round 6 audit — api command DELETE gate", () => {
  it("refuses api DELETE without --yes and throws a USAGE error", async () => {
    let caught: NotionCliError | undefined;
    try {
      await apiCommand({ args: ["DELETE", "/blocks/00000000-0000-0000-0000-000000000000"] });
    } catch (e) {
      if (e instanceof NotionCliError) caught = e;
    }
    assert.ok(caught, "expected NotionCliError");
    assert.equal(caught!.code, ErrorCode.USAGE);
    assert.match(caught!.message, /Refusing to perform api DELETE without --yes/);
    // Suggestions should include the --yes hint and a pointer to typed commands.
    assert.ok(caught!.suggestions.length >= 2);
    assert.ok(caught!.suggestions.some((s) => /--yes/.test(s)));
  });

  it("refuses api delete (lowercase) too — method is upcased before gating", async () => {
    let caught: NotionCliError | undefined;
    try {
      await apiCommand({ args: ["delete", "/blocks/00000000-0000-0000-0000-000000000000"] });
    } catch (e) {
      if (e instanceof NotionCliError) caught = e;
    }
    assert.ok(caught, "expected NotionCliError");
    assert.equal(caught!.code, ErrorCode.USAGE);
    assert.match(caught!.message, /Refusing to perform api DELETE/);
  });

  it("usage check still fires before the gate when args are missing", async () => {
    let caught: NotionCliError | undefined;
    try {
      await apiCommand({ args: ["DELETE"] });
    } catch (e) {
      if (e instanceof NotionCliError) caught = e;
    }
    assert.ok(caught);
    assert.equal(caught!.code, ErrorCode.USAGE);
    assert.match(caught!.message, /Usage:/);
  });
});
