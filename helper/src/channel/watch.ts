// Watch: whether a watching Claude is parked on a `wait` connection
// (specs/002-no-channel-delivery/data-model.md "Watch", research R13).

import type { WaitOutcome, WaitResponse, WatchState } from "../../../shared/types";

/** A `wait` answers `timeout` after this, so Claude restarts it under the runtime caps. */
export const WAIT_TIMEOUT_MS = 45 * 60_000;
/** After a timeout or a dropped connection, a new `wait` must come within this. */
export const GAP_MS = 120_000;
/** Watching stops this long after the start or the last comment. */
export const IDLE_MS = 8 * 3_600_000;

/** Schedules `fn` after `ms`; returns a function that cancels it. */
export type SetTimer = (fn: () => void, ms: number) => () => void;

export interface WatchOptions {
  setTimer?: SetTimer;
  /** Waiting batches that were not pushed. */
  waiting(): number;
}

export interface Watch {
  state(): WatchState;
  start(): void;
  stop(): void;
  /** Called after an unpushed batch enters the inbox. */
  commentArrived(): void;
  wait(signal: AbortSignal): Promise<WaitResponse>;
  close(): void;
}

const realTimer: SetTimer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};

export function createWatch({ setTimer = realTimer, waiting }: WatchOptions): Watch {
  let state: WatchState = "off";
  let open: { answer(outcome: WaitOutcome): void } | null = null;
  let cancelIdle: (() => void) | null = null;
  let cancelStep: (() => void) | null = null; // the wait timeout or the gap timer

  const clearStep = () => {
    cancelStep?.();
    cancelStep = null;
  };

  const answerOpen = (outcome: WaitOutcome) => {
    const o = open;
    open = null;
    o?.answer(outcome);
  };

  const off = (outcome: WaitOutcome) => {
    clearStep();
    cancelIdle?.();
    cancelIdle = null;
    state = "off";
    answerOpen(outcome);
  };

  const toGap = () => {
    clearStep();
    state = "gap";
    cancelStep = setTimer(() => off("stopped"), GAP_MS);
  };

  const armIdle = () => {
    cancelIdle?.();
    cancelIdle = setTimer(() => off("expired"), IDLE_MS);
  };

  const toBusy = () => {
    clearStep();
    state = "busy";
    answerOpen("comments");
  };

  return {
    state: () => state,

    start() {
      if (state !== "off") return;
      armIdle();
      toGap();
    },

    stop: () => off("stopped"),

    commentArrived() {
      if (state === "off") return;
      armIdle();
      if (state === "waiting") toBusy();
    },

    wait(signal) {
      return new Promise<WaitResponse>((resolve) => {
        const respond = (outcome: WaitOutcome) =>
          resolve({ v: 1, ok: true, outcome, waiting: waiting() });
        if (state === "off") return respond("stopped");
        answerOpen("replaced");
        if (waiting() > 0) {
          clearStep();
          state = "busy";
          return respond("comments");
        }
        clearStep();
        state = "waiting";
        const self = { answer: respond };
        open = self;
        cancelStep = setTimer(() => {
          answerOpen("timeout");
          toGap();
        }, WAIT_TIMEOUT_MS);
        signal.addEventListener("abort", () => {
          if (open !== self) return;
          open = null;
          toGap();
        });
      });
    },

    close() {
      clearStep();
      cancelIdle?.();
      cancelIdle = null;
      open = null;
    },
  };
}
