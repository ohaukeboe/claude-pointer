// Stand-in for a Claude Code session: the real socket listener and prompt renderer,
// with the MCP side replaced by a recorder (tasks.md T022).

import type { ErrorCode, Session } from "../../../shared/types";
import { errorResponse } from "../../../shared/types";
import { buildNotification, type ChannelNotification } from "../../src/channel/render";
import { createListener } from "../../src/registry/listener";

export interface FakeSession {
  session: Session;
  socketPath: string;
  prompts: ChannelNotification[];
  /** When set, the next deliveries answer with this error instead of recording. */
  failWith: ErrorCode | null;
  close(): Promise<void>;
}

export async function startFakeSession(o: {
  dir: string;
  id: string;
  projectDir: string;
  startedAt?: string;
}): Promise<FakeSession> {
  const session: Session = {
    id: o.id,
    projectDir: o.projectDir,
    projectName: o.projectDir.split("/").pop() ?? o.projectDir,
    startedAt: o.startedAt ?? new Date().toISOString(),
  };
  const prompts: ChannelNotification[] = [];
  const fake = { failWith: null as ErrorCode | null };
  const listener = await createListener({
    dir: o.dir,
    session,
    onDeliver: async (batch) => {
      if (fake.failWith) return errorResponse(fake.failWith, "simulated failure");
      const r = buildNotification(batch);
      if (!r.ok) return errorResponse("too-large", "too large");
      prompts.push(r.notification);
      return { v: 1, ok: true, batchId: batch.id, deliveredAt: new Date().toISOString() };
    },
  });
  return Object.assign(fake, {
    session,
    socketPath: listener.path,
    prompts,
    close: () => listener.close(),
  });
}
