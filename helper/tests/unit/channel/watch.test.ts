// specs/002-no-channel-delivery/data-model.md "Watch", research R13.
import { describe, expect, it } from "vitest";
import { createWatch, GAP_MS, IDLE_MS, WAIT_TIMEOUT_MS } from "../../../src/channel/watch";
import type { WaitResponse } from "../../../../shared/types";

/** Manual clock: timers fire only from `advance`. */
function fakeClock() {
  let t = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => t,
    setTimer(fn: () => void, ms: number) {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        due.live = false;
        due.fn();
      }
      t = end;
    },
    live: () => timers.filter((x) => x.live).length,
  };
}

function setup() {
  const clock = fakeClock();
  const box = { waiting: 0 };
  const watch = createWatch({
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    waiting: () => box.waiting,
  });
  return { clock, box, watch };
}

/** Start a wait and expose its answer once it settles. */
function openWait(watch: ReturnType<typeof setup>["watch"]) {
  const aborter = new AbortController();
  const result: { res?: WaitResponse } = {};
  void watch.wait(aborter.signal).then((r) => (result.res = r));
  return { result, abort: () => aborter.abort() };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("watch", () => {
  it("starts off and answers stopped to a wait", async () => {
    const { watch } = setup();
    expect(watch.state()).toBe("off");
    const w = openWait(watch);
    await settle();
    expect(w.result.res).toEqual({ v: 1, ok: true, outcome: "stopped", waiting: 0 });
  });

  it("goes off -> gap on start, and gap -> waiting when a wait opens", async () => {
    const { watch } = setup();
    watch.start();
    expect(watch.state()).toBe("gap");
    watch.start();
    expect(watch.state()).toBe("gap");
    openWait(watch);
    expect(watch.state()).toBe("waiting");
  });

  it("answers comments at once when comments already wait, and goes busy", async () => {
    const { watch, box } = setup();
    watch.start();
    box.waiting = 2;
    const w = openWait(watch);
    await settle();
    expect(w.result.res).toEqual({ v: 1, ok: true, outcome: "comments", waiting: 2 });
    expect(watch.state()).toBe("busy");
  });

  it("answers comments when one arrives while waiting", async () => {
    const { watch, box } = setup();
    watch.start();
    const w = openWait(watch);
    box.waiting = 1;
    watch.commentArrived();
    await settle();
    expect(w.result.res?.outcome).toBe("comments");
    expect(watch.state()).toBe("busy");
  });

  it("answers timeout after 45 minutes and goes to gap", async () => {
    const { watch, clock } = setup();
    watch.start();
    const w = openWait(watch);
    clock.advance(WAIT_TIMEOUT_MS - 1);
    await settle();
    expect(w.result.res).toBeUndefined();
    clock.advance(1);
    await settle();
    expect(w.result.res?.outcome).toBe("timeout");
    expect(watch.state()).toBe("gap");
    expect(WAIT_TIMEOUT_MS).toBe(45 * 60_000);
  });

  it("goes off when no wait follows within 120 s of a gap", async () => {
    const { watch, clock } = setup();
    watch.start();
    clock.advance(GAP_MS - 1);
    expect(watch.state()).toBe("gap");
    clock.advance(1);
    expect(watch.state()).toBe("off");
    expect(GAP_MS).toBe(120_000);
  });

  it("stays on when the wait restarts within the gap", async () => {
    const { watch, clock } = setup();
    watch.start();
    openWait(watch);
    clock.advance(WAIT_TIMEOUT_MS);
    await settle();
    clock.advance(GAP_MS - 1);
    openWait(watch);
    clock.advance(10 * GAP_MS);
    expect(watch.state()).toBe("waiting");
  });

  /** Advance `ms`, restarting the wait after each timeout like Claude does. */
  async function runFor(ctx: ReturnType<typeof setup>, w: ReturnType<typeof openWait>, ms: number) {
    const end = ctx.clock.now() + ms;
    while (ctx.clock.now() < end) {
      ctx.clock.advance(Math.min(WAIT_TIMEOUT_MS, end - ctx.clock.now()));
      await settle();
      if (w.result.res?.outcome === "timeout") w = openWait(ctx.watch);
    }
    return w;
  }

  it("expires after 8 hours without a comment, answering the open wait", async () => {
    const ctx = setup();
    ctx.watch.start();
    let w = await runFor(ctx, openWait(ctx.watch), IDLE_MS - 1);
    expect(ctx.watch.state()).toBe("waiting");
    w = await runFor(ctx, w, 1);
    expect(w.result.res?.outcome).toBe("expired");
    expect(ctx.watch.state()).toBe("off");
    expect(IDLE_MS).toBe(8 * 3_600_000);
  });

  it("restarts the 8 hours when a comment arrives", async () => {
    const ctx = setup();
    ctx.watch.start();
    await runFor(ctx, openWait(ctx.watch), IDLE_MS - 60_000);
    ctx.box.waiting = 1;
    ctx.watch.commentArrived();
    await settle();
    ctx.box.waiting = 0;
    const w = await runFor(ctx, openWait(ctx.watch), IDLE_MS - 60_000);
    expect(ctx.watch.state()).toBe("waiting");
    expect(w.result.res).toBeUndefined();
  });

  it("answers stopped to the open wait on stop", async () => {
    const { watch, clock } = setup();
    watch.start();
    const w = openWait(watch);
    watch.stop();
    await settle();
    expect(w.result.res?.outcome).toBe("stopped");
    expect(watch.state()).toBe("off");
    expect(clock.live()).toBe(0);
  });

  it("answers replaced to the older wait when a second one opens", async () => {
    const { watch } = setup();
    watch.start();
    const a = openWait(watch);
    const b = openWait(watch);
    await settle();
    expect(a.result.res?.outcome).toBe("replaced");
    expect(b.result.res).toBeUndefined();
    expect(watch.state()).toBe("waiting");
  });

  it("goes to gap when the client disconnects while waiting", async () => {
    const { watch, clock } = setup();
    watch.start();
    const w = openWait(watch);
    w.abort();
    expect(watch.state()).toBe("gap");
    clock.advance(GAP_MS);
    expect(watch.state()).toBe("off");
  });

  it("leaves busy alone until the next wait", async () => {
    const { watch, clock, box } = setup();
    watch.start();
    box.waiting = 1;
    openWait(watch);
    await settle();
    clock.advance(GAP_MS * 10);
    expect(watch.state()).toBe("busy");
  });

  it("clears all timers on close", () => {
    const { watch, clock } = setup();
    watch.start();
    openWait(watch);
    watch.close();
    expect(clock.live()).toBe(0);
  });
});
