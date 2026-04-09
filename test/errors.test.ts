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
