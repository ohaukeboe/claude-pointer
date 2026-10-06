// Transport-only session socket: answers `info` and `deliver` (contracts/session-socket.md).
// The channel server plugs in `onDeliver`; tests plug in a recorder.

import { chmodSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import type { Batch, DeliveredResponse, ErrorResponse, Session } from "../../../shared/types";
import { errorResponse } from "../../../shared/types";
import { LIMITS, parseSocketRequest } from "../../../shared/validate";
import { ensureSocketDir, removeStale, socketPathFor } from "./index";

export interface ListenerOptions {
  dir: string;
  session: Session;
  onDeliver(batch: Batch): Promise<DeliveredResponse | ErrorResponse>;
}

export interface Listener {
  path: string;
  close(opts?: { keepFile?: boolean }): Promise<void>;
}

// Room for a 1 MB batch plus the request envelope.
const MAX_LINE_BYTES = LIMITS.batchBytes + 4096;

export async function createListener({
  dir,
  session,
  onDeliver,
}: ListenerOptions): Promise<Listener> {
  ensureSocketDir(dir);
  const path = socketPathFor(dir, session.id);
  removeStale(path);

  const handle = async (line: string): Promise<unknown> => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return errorResponse("invalid-request", "Request is not valid JSON.");
    }
    const parsed = parseSocketRequest(raw);
    if (!parsed.ok) return { v: 1, ok: false, error: parsed.error };
    const req = parsed.value;
    if (req.type === "info") return { v: 1, ok: true, session };
    if (req.batch.sessionId !== session.id) {
      return errorResponse("invalid-request", "Batch is addressed to another session.");
    }
    try {
      return await onDeliver(req.batch);
    } catch (e) {
      return errorResponse("internal", e instanceof Error ? e.message : String(e));
    }
  };

  const onConnection = (sock: Socket) => {
    let buf = "";
    let answered = false;
    sock.setEncoding("utf8");
    sock.on("error", () => sock.destroy());
    sock.on("data", (chunk: string) => {
      if (answered) return;
      buf += chunk;
      if (buf.length > MAX_LINE_BYTES) {
        answered = true;
        sock.end(JSON.stringify(errorResponse("too-large", "Request is too large.")) + "\n");
        return;
      }
      const i = buf.indexOf("\n");
      if (i < 0) return;
      answered = true;
      void handle(buf.slice(0, i)).then((res) => sock.end(JSON.stringify(res) + "\n"));
    });
  };

  const server = createServer(onConnection);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(path, 0o600);

  return {
    path,
    close: ({ keepFile = false } = {}) =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        if (!keepFile) removeStale(path);
      }),
  };
}
