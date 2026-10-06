// Session targeting and delivery through the native host (contracts/native-messaging.md).

import type {
  Batch,
  Comment,
  ErrorCode,
  NativeResponse,
  Session,
  SessionSuggestion,
} from "../../../shared/types";
import { validateBatch } from "../../../shared/validate";
import { ext } from "../lib/browser";
import { getBinding, originOf } from "./binding";

export type TargetResult =
  | { kind: "ready"; session: Session; suggestions: SessionSuggestion[] }
  | { kind: "choose"; suggestions: SessionSuggestion[]; preselect: string | null; stale?: boolean }
  | { kind: "none" }
  | { kind: "no-host"; message: string }
  | { kind: "error"; code: ErrorCode; message: string };

export type SendFailureCode = ErrorCode | "no-host";

export type SendResult =
  | { ok: true; batchId: string; deliveredAt: string }
  | { ok: false; batchId: string; code: SendFailureCode; message: string };

export const NO_HOST_MESSAGE =
  "The claude-pointer helper is not installed. Run `npx claude-pointer install`, then reload the extension.";

const MESSAGES: Record<ErrorCode, string> = {
  "session-gone": "The Claude Code session has ended.",
  timeout: "The session did not answer in time.",
  "too-large": "The comments are too long. Shorten them and try again.",
  "unsupported-version": "Update the claude-pointer helper (npx claude-pointer install).",
  "invalid-request": "Claude Pointer sent an invalid request (this is a bug).",
  internal: "Something went wrong while sending.",
};

export function messageFor(code: ErrorCode): string {
  return MESSAGES[code];
}

async function callNative(message: unknown): Promise<NativeResponse | null> {
  try {
    return (await ext.sendNative(message)) as NativeResponse;
  } catch {
    return null; // Firefox rejects when the host is not installed or crashed.
  }
}

export async function listSessions(
  pageUrl: string,
  pageTitle: string,
): Promise<
  | { ok: true; sessions: SessionSuggestion[] }
  | Exclude<TargetResult, { kind: "ready" | "choose" | "none" }>
> {
  const res = await callNative({ v: 1, type: "list-sessions", pageUrl, pageTitle });
  if (!res) return { kind: "no-host", message: NO_HOST_MESSAGE };
  if (!res.ok) return { kind: "error", code: res.error.code, message: messageFor(res.error.code) };
  if (!("sessions" in res))
    return { kind: "error", code: "internal", message: messageFor("internal") };
  return { ok: true, sessions: res.sessions };
}

/** Decide where comments from this page go (FR-010). Never guesses past a stale binding. */
export async function resolveTarget(pageUrl: string, pageTitle: string): Promise<TargetResult> {
  const listed = await listSessions(pageUrl, pageTitle);
  if (!("ok" in listed)) return listed;
  const { sessions } = listed;
  if (sessions.length === 0) return { kind: "none" };

  const binding = await getBinding(originOf(pageUrl));
  if (binding) {
    const bound = sessions.find((s) => s.session.id === binding.sessionId);
    if (bound) return { kind: "ready", session: bound.session, suggestions: sessions };
    const sameProject = sessions.find((s) => s.session.projectDir === binding.projectDir);
    return {
      kind: "choose",
      suggestions: sessions,
      preselect: (sameProject ?? sessions[0]!).session.id,
      stale: true,
    };
  }
  return { kind: "choose", suggestions: sessions, preselect: sessions[0]!.session.id };
}

export async function sendComments(o: {
  pageUrl: string;
  sessionId: string;
  comments: Comment[];
  batchId?: string;
}): Promise<SendResult> {
  const batch: Batch = {
    id: o.batchId ?? crypto.randomUUID(),
    sessionId: o.sessionId,
    pageUrl: o.pageUrl,
    comments: o.comments.map((c) => ({ ...c, text: c.text.trim(), state: "sending", error: null })),
  };
  const check = validateBatch(batch);
  if (!check.ok)
    return { ok: false, batchId: batch.id, code: check.code, message: messageFor(check.code) };

  const res = await callNative({ v: 1, type: "send-batch", sessionId: o.sessionId, batch });
  if (!res) return { ok: false, batchId: batch.id, code: "no-host", message: NO_HOST_MESSAGE };
  if (!res.ok)
    return {
      ok: false,
      batchId: batch.id,
      code: res.error.code,
      message: messageFor(res.error.code),
    };
  if (!("deliveredAt" in res))
    return { ok: false, batchId: batch.id, code: "internal", message: messageFor("internal") };
  return { ok: true, batchId: batch.id, deliveredAt: res.deliveredAt };
}
