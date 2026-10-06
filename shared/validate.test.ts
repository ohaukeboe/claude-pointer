import { describe, expect, it } from "vitest";
import { makeBatch, makeComment, makeSelection } from "./fixtures";
import {
  LIMITS,
  boundSelection,
  collapseWhitespace,
  normaliseCommentText,
  parseNativeRequest,
  parseSocketRequest,
  truncate,
  validateBatch,
  validateComment,
  validateSelection,
} from "./validate";

describe("truncate", () => {
  it("keeps short strings", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });
  it("cuts to max length including the ellipsis", () => {
    const out = truncate("abcdefgh", 5);
    expect(out).toBe("abcd…");
    expect(out.length).toBe(5);
  });
});

describe("collapseWhitespace", () => {
  it("collapses runs and trims", () => {
    expect(collapseWhitespace("  a \n\t b  ")).toBe("a b");
  });
});

describe("boundSelection", () => {
  it("applies title max 200 chars", () => {
    expect(boundSelection(makeSelection({ title: "t".repeat(300) })).title.length).toBe(200);
  });
  it("applies classes max 20 entries", () => {
    const classes = Array.from({ length: 30 }, (_, i) => `c${i}`);
    expect(boundSelection(makeSelection({ classes })).classes).toHaveLength(20);
  });
  it("applies text max 500 chars with … if cut", () => {
    const text = boundSelection(makeSelection({ text: "x".repeat(600) })).text;
    expect(text.length).toBe(LIMITS.text);
    expect(text.endsWith("…")).toBe(true);
  });
  it("applies html max 4096 chars with … if cut", () => {
    const html = boundSelection(makeSelection({ html: "<p>" + "x".repeat(5000) })).html;
    expect(html.length).toBe(4096);
    expect(html.endsWith("…")).toBe(true);
  });
});

describe("validateSelection", () => {
  it("accepts a valid selection", () => {
    expect(validateSelection(makeSelection())).toEqual([]);
  });
  it("rejects missing fields and wrong types", () => {
    expect(validateSelection({})).not.toEqual([]);
    expect(validateSelection(makeSelection({ classes: "x" as never }))).not.toEqual([]);
    expect(validateSelection(makeSelection({ rect: { x: 1 } as never }))).not.toEqual([]);
  });
  it("rejects over-limit fields", () => {
    expect(validateSelection(makeSelection({ html: "x".repeat(5000) }))).not.toEqual([]);
  });
  it("accepts a source hint and rejects a bad one", () => {
    const source = { component: "Q", file: "a.tsx", line: 3, column: 1, via: "react" as const };
    expect(validateSelection(makeSelection({ source }))).toEqual([]);
    expect(
      validateSelection(makeSelection({ source: { ...source, via: "x" as never } })),
    ).not.toEqual([]);
  });
});

describe("comment text", () => {
  it("is trimmed", () => {
    expect(normaliseCommentText("  hi  ")).toBe("hi");
  });
  it("rejects empty and whitespace-only (FR-007)", () => {
    expect(validateComment(makeComment({ text: "" }))).not.toEqual([]);
    expect(validateComment(makeComment({ text: "   \n" }))).not.toEqual([]);
  });
  it("accepts 10 000 chars and rejects 10 001", () => {
    expect(validateComment(makeComment({ text: "a".repeat(10_000) }))).toEqual([]);
    expect(validateComment(makeComment({ text: "a".repeat(10_001) }))).not.toEqual([]);
  });
  it("rejects unknown state", () => {
    expect(validateComment(makeComment({ state: "nope" as never }))).not.toEqual([]);
  });
});

describe("validateBatch", () => {
  it("accepts 1 to 50 comments", () => {
    expect(validateBatch(makeBatch())).toEqual({ ok: true });
    const fifty = Array.from({ length: 50 }, (_, i) => makeComment({ id: `c${i}` }));
    expect(validateBatch(makeBatch({ comments: fifty }))).toEqual({ ok: true });
  });
  it("rejects 0 and 51 comments", () => {
    expect(validateBatch(makeBatch({ comments: [] }))).toMatchObject({
      ok: false,
      code: "invalid-request",
    });
    const many = Array.from({ length: 51 }, (_, i) => makeComment({ id: `c${i}` }));
    expect(validateBatch(makeBatch({ comments: many }))).toMatchObject({
      ok: false,
      code: "invalid-request",
    });
  });
  it("rejects batch over 1 MB serialised", () => {
    const big = Array.from({ length: 50 }, (_, i) =>
      makeComment({
        id: `c${i}`,
        text: "a".repeat(10_000),
        selection: makeSelection({ html: "h".repeat(4096), text: "t".repeat(500) }),
      }),
    );
    // 50 × ~15 KB = ~750 KB; push it over with long selectors.
    for (const c of big) c.selection.selector = "s".repeat(10_000);
    expect(validateBatch(makeBatch({ comments: big }))).toMatchObject({
      ok: false,
      code: "too-large",
    });
  });
  it("rejects non-object", () => {
    expect(validateBatch(null)).toMatchObject({ ok: false, code: "invalid-request" });
  });
});

describe("parseNativeRequest", () => {
  it("parses list-sessions", () => {
    const r = parseNativeRequest({
      v: 1,
      type: "list-sessions",
      pageUrl: "http://a/",
      pageTitle: "A",
    });
    expect(r.ok).toBe(true);
  });
  it("parses send-batch", () => {
    const r = parseNativeRequest({
      v: 1,
      type: "send-batch",
      sessionId: "100-200",
      batch: makeBatch(),
    });
    expect(r.ok).toBe(true);
  });
  it("rejects unknown v", () => {
    expect(parseNativeRequest({ v: 2, type: "list-sessions" })).toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });
  });
  it("rejects unknown type and malformed batch", () => {
    expect(parseNativeRequest({ v: 1, type: "nope" })).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(
      parseNativeRequest({ v: 1, type: "send-batch", sessionId: "x", batch: {} }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(parseNativeRequest({ v: 1, type: "list-sessions", pageUrl: 3 })).toMatchObject({
      ok: false,
    });
    expect(parseNativeRequest("x")).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
  });
  it("rejects send-batch whose sessionId differs from batch.sessionId", () => {
    const r = parseNativeRequest({
      v: 1,
      type: "send-batch",
      sessionId: "other",
      batch: makeBatch(),
    });
    expect(r).toMatchObject({ ok: false, error: { code: "invalid-request" } });
  });
});

describe("parseSocketRequest", () => {
  it("parses info and deliver", () => {
    expect(parseSocketRequest({ v: 1, type: "info" }).ok).toBe(true);
    expect(parseSocketRequest({ v: 1, type: "deliver", batch: makeBatch() }).ok).toBe(true);
  });
  it("rejects bad input", () => {
    expect(parseSocketRequest({ v: 9, type: "info" })).toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });
    expect(parseSocketRequest({ v: 1, type: "deliver", batch: { comments: [] } })).toMatchObject({
      ok: false,
    });
    expect(parseSocketRequest({ v: 1, type: "x" })).toMatchObject({ ok: false });
  });
});
