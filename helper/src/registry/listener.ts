// Transport-only session socket (contracts/session-socket.md of features 001 and 002).
// The channel server plugs in its handlers; tests plug in recorders.

import { chmodSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import type {
  Batch,
  DeliveredResponse,
  ErrorResponse,
  PeekResponse,
  Session,
  StatusResponse,
  WaitResponse,
} from "../../../shared/types";
import { errorResponse } from "../../../shared/types";
import { LIMITS, parseSocketRequest } from "../../../shared/validate";
import { ensureSocketDir, removeStale, socketPathFor } from "./index";

/** A request whose handler is missing is answered with `invalid-request`. */
export interface SessionHandlers {
  deliver?(batch: Batch): Promise<DeliveredResponse | ErrorResponse>;
  status?(batchIds: string[]): StatusResponse;
  peek?(): PeekResponse;
  /** May stay pending for a long time; `signal` aborts when the client goes away. */
  wait?(signal: AbortSignal): Promise<WaitResponse>;
}

export interface ListenerOptions {
  dir: string;
  /** Read on every `info`: mode and watch state change while the session runs. */
  session(): Session;
  handlers: SessionHandlers;
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
  handlers,
}: ListenerOptions): Promise<Listener> {
  ensureSocketDir(dir);
  const sessionId = session().id;
  const path = socketPathFor(dir, sessionId);
  removeStale(path);
  const sockets = new Set<Socket>();

  const handle = async (line: string, signal: AbortSignal): Promise<unknown> => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return errorResponse("invalid-request", "Request is not valid JSON.");
    }
    const parsed = parseSocketRequest(raw);
    if (!parsed.ok) return { v: 1, ok: false, error: parsed.error };
    const req = parsed.value;
    if (req.type === "info") return { v: 1, ok: true, session: session() };
    const unsupported = () =>
      errorResponse("invalid-request", `This session does not support ${req.type}.`);
    try {
      switch (req.type) {
        case "deliver":
          if (!handlers.deliver) return unsupported();
          if (req.batch.sessionId !== sessionId) {
            return errorResponse("invalid-request", "Batch is addressed to another session.");
          }
          return await handlers.deliver(req.batch);
        case "status":
          return handlers.status ? handlers.status(req.batchIds) : unsupported();
        case "peek":
          return handlers.peek ? handlers.peek() : unsupported();
        case "wait":
          return handlers.wait ? await handlers.wait(signal) : unsupported();
      }
    } catch (e) {
      return errorResponse("internal", e instanceof Error ? e.message : String(e));
    }
  };

  const onConnection = (sock: Socket) => {
    let buf = "";
    let answered = false;
    const aborter = new AbortController();
    sockets.add(sock);
    sock.on("close", () => {
      sockets.delete(sock);
      aborter.abort();
    });
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
      void handle(buf.slice(0, i), aborter.signal).then((res) => {
        if (!sock.destroyed) sock.end(JSON.stringify(res) + "\n");
      });
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
        // Open `wait` connections would keep the server open forever.
        for (const sock of sockets) sock.destroy();
        if (!keepFile) removeStale(path);
      }),
  };
}
