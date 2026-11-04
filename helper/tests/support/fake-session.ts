// Stand-in for a Claude Code session: the real socket listener and prompt renderer,
// with the MCP side replaced by a recorder (tasks.md T022; feature 002 T007).

import type {
  BatchState,
  DeliveryMode,
  ErrorCode,
  Session,
  WaitResponse,
  WatchState,
} from "../../../shared/types";
import { errorResponse } from "../../../shared/types";
import { buildNotification, type ChannelNotification } from "../../src/channel/render";
import { createListener } from "../../src/registry/listener";

export interface FakeSession {
  session: Session;
  socketPath: string;
  prompts: ChannelNotification[];
  /** When set, the next deliveries answer with this error instead of recording. */
  failWith: ErrorCode | null;
  mode: DeliveryMode;
  watch: WatchState;
  /** Batch states reported by `status`; deliveries in no-channel mode start as `waiting`. */
  states: Map<string, BatchState>;
  /** Requests other than `info`, in arrival order. */
  calls: string[];
  /** Answer for `peek`. */
  peekAnswer: { waiting: number; pages: string[] };
  /** Answer the next `wait` with this response (it stays pending until set). */
  answerWait(res: Omit<WaitResponse, "v" | "ok">): void;
  close(): Promise<void>;
}

export async function startFakeSession(o: {
  dir: string;
  id: string;
  projectDir: string;
  startedAt?: string;
  mode?: DeliveryMode;
  watch?: WatchState;
}): Promise<FakeSession> {
  const session: Session = {
    id: o.id,
    projectDir: o.projectDir,
    projectName: o.projectDir.split("/").pop() ?? o.projectDir,
    startedAt: o.startedAt ?? new Date().toISOString(),
  };
  const prompts: ChannelNotification[] = [];
  let pendingWait: ((res: WaitResponse) => void) | null = null;
  const fake = {
    failWith: null as ErrorCode | null,
    mode: o.mode ?? "channel",
    watch: o.watch ?? "off",
    states: new Map<string, BatchState>(),
    calls: [] as string[],
    peekAnswer: { waiting: 0, pages: [] as string[] },
    answerWait(res: Omit<WaitResponse, "v" | "ok">) {
      pendingWait?.({ v: 1, ok: true, ...res });
      pendingWait = null;
    },
  };
  const listener = await createListener({
    dir: o.dir,
    session: () => ({ ...session, mode: fake.mode, watch: fake.watch }),
    handlers: {
      deliver: async (batch) => {
        fake.calls.push("deliver");
        if (fake.failWith) return errorResponse(fake.failWith, "simulated failure");
        const r = buildNotification(batch);
        if (!r.ok) return errorResponse("too-large", "too large");
        prompts.push(r.notification);
        const push = fake.mode === "channel";
        if (!push) fake.states.set(batch.id, "waiting");
        return {
          v: 1,
          ok: true,
          batchId: batch.id,
          deliveredAt: new Date().toISOString(),
          status: push ? "pushed" : "waiting",
        };
      },
      status: (batchIds) => {
        fake.calls.push("status");
        return {
          v: 1,
          ok: true,
          statuses: batchIds.map((batchId) => {
            const state = fake.states.get(batchId) ?? "unknown";
            return { batchId, state, at: state === "picked-up" ? new Date().toISOString() : null };
          }),
        };
      },
      peek: () => {
        fake.calls.push("peek");
        return { v: 1, ok: true, ...fake.peekAnswer };
      },
      wait: () => {
        fake.calls.push("wait");
        return new Promise<WaitResponse>((resolve) => (pendingWait = resolve));
      },
    },
  });
  return Object.assign(fake, {
    session,
    socketPath: listener.path,
    prompts,
    close: () => listener.close(),
  });
}
