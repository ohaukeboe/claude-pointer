// `claude-pointer native-host`: one request per process, started by Firefox
// (contracts/native-messaging.md).

import type { Readable, Writable } from "node:stream";
import type { NativeResponse, Session, SessionSuggestion } from "../../../shared/types";
import { errorResponse } from "../../../shared/types";
import { parseNativeRequest } from "../../../shared/validate";
import { isSessionId, listSockets, removeStale, socketDir, socketPathFor } from "../registry/index";
import { request } from "../registry/socket-client";
import { rankSessions, type RankOptions } from "../ranking/index";
import { FrameTooLargeError, encodeFrame, readFrame } from "./framing";

export interface HostOptions {
  dir?: string;
  rank?: Omit<RankOptions, "pageUrl" | "pageTitle">;
}

function isSession(v: unknown): v is Session {
  const s = v as Session;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.id === "string" &&
    typeof s.projectDir === "string" &&
    typeof s.projectName === "string" &&
    typeof s.startedAt === "string"
  );
}

export async function discoverSessions(dir: string): Promise<Session[]> {
  const found = await Promise.all(
    listSockets(dir).map(async (path) => {
      const res = (await request(path, { v: 1, type: "info" })) as {
        ok?: boolean;
        session?: unknown;
        error?: { code: string };
      };
      if (res.ok === true && isSession(res.session)) return res.session;
      if (res.error?.code === "session-gone") removeStale(path);
      return null;
    }),
  );
  return found.filter((s): s is Session => s !== null);
}

export async function handleNativeRequest(
  raw: unknown,
  opts: HostOptions = {},
): Promise<NativeResponse> {
  const dir = opts.dir ?? socketDir();
  const parsed = parseNativeRequest(raw);
  if (!parsed.ok) return { v: 1, ok: false, error: parsed.error };
  const req = parsed.value;

  if (req.type === "list-sessions") {
    const sessions: SessionSuggestion[] = rankSessions(await discoverSessions(dir), {
      ...opts.rank,
      pageUrl: req.pageUrl,
      pageTitle: req.pageTitle,
    });
    return { v: 1, ok: true, sessions };
  }

  // send-batch: only ever to the socket named by sessionId (FR-013).
  if (!isSessionId(req.sessionId)) return errorResponse("invalid-request", "Invalid session id.");
  const res = (await request(socketPathFor(dir, req.sessionId), {
    v: 1,
    type: "deliver",
    batch: req.batch,
  })) as NativeResponse;
  if (res.ok === false) {
    if (res.error.code === "session-gone") {
      removeStale(socketPathFor(dir, req.sessionId));
      return errorResponse("session-gone", "The selected Claude Code session has ended.");
    }
    return res;
  }
  if ("batchId" in res && res.batchId === req.batch.id) return res;
  return errorResponse("internal", "Unexpected answer from the session.");
}

export async function runNativeHost(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  opts: HostOptions = {},
): Promise<void> {
  let response: NativeResponse;
  try {
    response = await handleNativeRequest(await readFrame(input), opts);
  } catch (e) {
    response =
      e instanceof FrameTooLargeError
        ? errorResponse("too-large", "Request is larger than 1 MB.")
        : errorResponse("invalid-request", e instanceof Error ? e.message : String(e));
  }
  await new Promise<void>((resolve) => output.write(encodeFrame(response), () => resolve()));
}
