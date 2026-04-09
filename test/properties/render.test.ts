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
