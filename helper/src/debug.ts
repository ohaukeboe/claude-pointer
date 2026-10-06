// `debug-list` and `debug-send` (quickstart S0): exercise the native host without Firefox.

import { randomUUID } from "node:crypto";
import type { Batch, NativeResponse } from "../../shared/types";
import { discoverSessions, handleNativeRequest } from "./native-host/index";
import { socketDir } from "./registry/index";

export async function debugList(out: (s: string) => void = console.log): Promise<number> {
  const sessions = await discoverSessions(socketDir());
  if (sessions.length === 0) out("No claude-pointer sessions running.");
  for (const s of sessions) out(`${s.id}\t${s.projectName}\t${s.projectDir}\t${s.startedAt}`);
  return 0;
}

export async function debugSend(
  text: string,
  sessionId: string | undefined,
  out: (s: string) => void = console.log,
): Promise<number> {
  const sessions = await discoverSessions(socketDir());
  const target = sessionId ?? sessions[0]?.id;
  if (!target) {
    out("No claude-pointer sessions running.");
    return 1;
  }
  const now = new Date().toISOString();
  const batch: Batch = {
    id: randomUUID(),
    sessionId: target,
    pageUrl: "about:claude-pointer-debug",
    comments: [
      {
        id: randomUUID(),
        text,
        createdAt: now,
        state: "sending",
        error: null,
        selection: {
          url: "about:claude-pointer-debug",
          title: "debug",
          selector: "body",
          tag: "body",
          id: null,
          classes: [],
          text: "",
          html: "<body></body>",
          rect: { x: 0, y: 0, width: 0, height: 0 },
          viewport: { width: 0, height: 0 },
          source: null,
          frame: null,
        },
      },
    ],
  };
  const res: NativeResponse = await handleNativeRequest({
    v: 1,
    type: "send-batch",
    sessionId: target,
    batch,
  });
  out(JSON.stringify(res));
  return res.ok ? 0 : 1;
}
