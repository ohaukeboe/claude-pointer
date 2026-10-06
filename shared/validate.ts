// Runtime validation shared by all three processes. No dependencies.
// Limits quoted from specs/001-element-comment-picker/data-model.md.

import type {
  Batch,
  Comment,
  ErrorCode,
  NativeRequest,
  ProtocolError,
  Selection,
  SocketRequest,
} from "./types";
import { PROTOCOL_VERSION } from "./types";

export const LIMITS = {
  title: 200,
  classes: 20,
  text: 500,
  html: 4096,
  commentText: 10_000,
  batchMin: 1,
  batchMax: 50,
  batchBytes: 1024 * 1024,
  promptBytes: 64 * 1024,
} as const;

const ELLIPSIS = "…";
const COMMENT_STATES = new Set(["draft", "pending", "sending", "delivered", "failed"]);
const SOURCE_VIA = new Set(["attribute", "svelte", "vue", "react"]);

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - ELLIPSIS.length) + ELLIPSIS;
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normaliseCommentText(value: string): string {
  return value.trim();
}

/** Apply the size limits for a Selection. */
export function boundSelection(sel: Selection): Selection {
  return {
    ...sel,
    title: truncate(sel.title, LIMITS.title),
    classes: sel.classes.slice(0, LIMITS.classes),
    text: truncate(sel.text, LIMITS.text),
    html: truncate(sel.html, LIMITS.html),
  };
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNullable<T>(v: unknown, check: (x: unknown) => x is T): boolean {
  return v === null || check(v);
}

export function validateSelection(v: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(v)) return ["selection: not an object"];
  for (const key of ["url", "title", "selector", "tag", "text", "html"]) {
    if (!isStr(v[key])) errors.push(`selection.${key}: not a string`);
  }
  if (!isNullable(v.id, isStr)) errors.push("selection.id: not a string or null");
  if (!isNullable(v.frame, isStr)) errors.push("selection.frame: not a string or null");
  if (!Array.isArray(v.classes) || !v.classes.every(isStr)) {
    errors.push("selection.classes: not a string array");
  } else if (v.classes.length > LIMITS.classes) {
    errors.push(`selection.classes: more than ${LIMITS.classes}`);
  }
  const rect = v.rect;
  if (!isObj(rect) || !["x", "y", "width", "height"].every((k) => isNum(rect[k]))) {
    errors.push("selection.rect: invalid");
  }
  const vp = v.viewport;
  if (!isObj(vp) || !isNum(vp.width) || !isNum(vp.height)) {
    errors.push("selection.viewport: invalid");
  }
  if (v.source !== null) {
    const s = v.source;
    if (
      !isObj(s) ||
      !isNullable(s.component, isStr) ||
      !isNullable(s.file, isStr) ||
      !isNullable(s.line, isNum) ||
      !isNullable(s.column, isNum) ||
      !SOURCE_VIA.has(s.via as string)
    ) {
      errors.push("selection.source: invalid");
    }
  }
  if (isStr(v.title) && v.title.length > LIMITS.title) errors.push("selection.title: too long");
  if (isStr(v.text) && v.text.length > LIMITS.text) errors.push("selection.text: too long");
  if (isStr(v.html) && v.html.length > LIMITS.html) errors.push("selection.html: too long");
  return errors;
}

export function validateComment(v: unknown): string[] {
  if (!isObj(v)) return ["comment: not an object"];
  const errors: string[] = [];
  if (!isStr(v.id) || v.id === "") errors.push("comment.id: missing");
  if (!isStr(v.text)) {
    errors.push("comment.text: not a string");
  } else {
    const text = normaliseCommentText(v.text);
    if (text === "") errors.push("comment.text: empty");
    if (text.length > LIMITS.commentText) errors.push("comment.text: too long");
  }
  if (!isStr(v.createdAt)) errors.push("comment.createdAt: not a string");
  if (!COMMENT_STATES.has(v.state as string)) errors.push("comment.state: invalid");
  if (!isNullable(v.error, isStr)) errors.push("comment.error: not a string or null");
  errors.push(...validateSelection(v.selection));
  return errors;
}

export type BatchCheck = { ok: true } | { ok: false; code: ErrorCode; message: string };

export function validateBatch(v: unknown): BatchCheck {
  const invalid = (message: string): BatchCheck => ({
    ok: false,
    code: "invalid-request",
    message,
  });
  if (!isObj(v)) return invalid("batch: not an object");
  if (!isStr(v.id) || v.id === "") return invalid("batch.id: missing");
  if (!isStr(v.sessionId) || v.sessionId === "") return invalid("batch.sessionId: missing");
  if (!isStr(v.pageUrl)) return invalid("batch.pageUrl: not a string");
  if (!Array.isArray(v.comments)) return invalid("batch.comments: not an array");
  const n = v.comments.length;
  if (n < LIMITS.batchMin || n > LIMITS.batchMax) {
    return invalid(
      `batch.comments: must have ${LIMITS.batchMin}–${LIMITS.batchMax} entries, got ${n}`,
    );
  }
  for (const c of v.comments) {
    const errors = validateComment(c);
    if (errors.length > 0) return invalid(errors.join("; "));
  }
  if (new TextEncoder().encode(JSON.stringify(v)).length > LIMITS.batchBytes) {
    return { ok: false, code: "too-large", message: "Batch is larger than 1 MB." };
  }
  return { ok: true };
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ProtocolError };

function fail<T>(code: ErrorCode, message: string): Parsed<T> {
  return { ok: false, error: { code, message } };
}

function checkVersion<T>(v: Obj): Parsed<T> | null {
  if (v.v !== PROTOCOL_VERSION)
    return fail("unsupported-version", `Unsupported protocol version ${String(v.v)}.`);
  return null;
}

export function parseNativeRequest(v: unknown): Parsed<NativeRequest> {
  if (!isObj(v)) return fail("invalid-request", "Request is not an object.");
  const bad = checkVersion<NativeRequest>(v);
  if (bad) return bad;
  if (v.type === "list-sessions") {
    if (!isStr(v.pageUrl) || !isStr(v.pageTitle))
      return fail("invalid-request", "pageUrl and pageTitle required.");
    return {
      ok: true,
      value: { v: 1, type: "list-sessions", pageUrl: v.pageUrl, pageTitle: v.pageTitle },
    };
  }
  if (v.type === "send-batch") {
    if (!isStr(v.sessionId)) return fail("invalid-request", "sessionId required.");
    const check = validateBatch(v.batch);
    if (!check.ok) return fail(check.code, check.message);
    const batch = v.batch as Batch;
    if (batch.sessionId !== v.sessionId)
      return fail("invalid-request", "sessionId does not match batch.sessionId.");
    return { ok: true, value: { v: 1, type: "send-batch", sessionId: v.sessionId, batch } };
  }
  return fail("invalid-request", `Unknown request type ${String(v.type)}.`);
}

export function parseSocketRequest(v: unknown): Parsed<SocketRequest> {
  if (!isObj(v)) return fail("invalid-request", "Request is not an object.");
  const bad = checkVersion<SocketRequest>(v);
  if (bad) return bad;
  if (v.type === "info") return { ok: true, value: { v: 1, type: "info" } };
  if (v.type === "deliver") {
    const check = validateBatch(v.batch);
    if (!check.ok) return fail(check.code, check.message);
    return { ok: true, value: { v: 1, type: "deliver", batch: v.batch as Batch } };
  }
  return fail("invalid-request", `Unknown request type ${String(v.type)}.`);
}

/** Narrow helper for callers that build Comments. */
export function isValidComment(c: Comment): boolean {
  return validateComment(c).length === 0;
}
