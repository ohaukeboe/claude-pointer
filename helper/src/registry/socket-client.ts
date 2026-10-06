// One NDJSON request/response over a session's Unix socket (contracts/session-socket.md).

import { createConnection } from "node:net";
import type { ErrorResponse, SocketRequest } from "../../../shared/types";
import { errorResponse } from "../../../shared/types";

export const SOCKET_TIMEOUT_MS = 1500;

export function request(
  socketPath: string,
  message: SocketRequest,
  timeoutMs = SOCKET_TIMEOUT_MS,
): Promise<unknown | ErrorResponse> {
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = (value: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(value);
    };
    const sock = createConnection(socketPath);
    const timer = setTimeout(
      () => finish(errorResponse("timeout", `No answer from session within ${timeoutMs} ms.`)),
      timeoutMs,
    );
    sock.on("connect", () => sock.write(JSON.stringify(message) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      const i = buf.indexOf("\n");
      if (i < 0) return;
      try {
        finish(JSON.parse(buf.slice(0, i)));
      } catch {
        finish(errorResponse("internal", "Session sent an invalid response."));
      }
    });
    sock.on("end", () =>
      finish(errorResponse("internal", "Session closed the connection without answering.")),
    );
    sock.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED") {
        finish(errorResponse("session-gone", "The Claude Code session has ended."));
      } else {
        finish(errorResponse("internal", e.message));
      }
    });
  });
}
