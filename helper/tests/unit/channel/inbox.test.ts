// specs/002-no-channel-delivery/data-model.md "InboxEntry".
import { describe, expect, it } from "vitest";
import { createInbox, INBOX_LIMITS } from "../../../src/channel/inbox";
import { makeBatch } from "../../../../shared/fixtures";

const size = () => 10;

function inboxAt(t = 1000) {
  const clock = { t };
  return { clock, inbox: createInbox({ now: () => clock.t }) };
}

describe("inbox", () => {
  it("adds a batch as waiting", () => {
    const { inbox } = inboxAt();
    const r = inbox.add(makeBatch({ id: "a" }), { pushed: false });
    expect(r).toEqual({ kind: "added", receivedAt: 1000, pushed: false });
    expect(inbox.status(["a"])).toEqual([{ batchId: "a", state: "waiting", at: null }]);
  });

  it("refuses the 51st waiting batch that was not pushed", () => {
    const { inbox } = inboxAt();
    for (let i = 0; i < INBOX_LIMITS.waiting; i++) {
      expect(inbox.add(makeBatch({ id: `b${i}` }), { pushed: false }).kind).toBe("added");
    }
    expect(inbox.add(makeBatch({ id: "over" }), { pushed: false })).toEqual({ kind: "full" });
    expect(inbox.status(["over"])[0]!.state).toBe("unknown");
  });

  it("returns the first answer for a known batch id and adds nothing", () => {
    const { clock, inbox } = inboxAt();
    inbox.add(makeBatch({ id: "a" }), { pushed: false });
    clock.t = 5000;
    expect(inbox.add(makeBatch({ id: "a" }), { pushed: true })).toEqual({
      kind: "duplicate",
      receivedAt: 1000,
      pushed: false,
    });
    expect(inbox.take(1e9, size).entries).toHaveLength(1);
    // still known after pick-up
    expect(inbox.add(makeBatch({ id: "a" }), { pushed: false }).kind).toBe("duplicate");
  });

  it("takes waiting batches oldest first and marks them picked up", () => {
    const { clock, inbox } = inboxAt();
    inbox.add(makeBatch({ id: "a" }), { pushed: false });
    clock.t = 2000;
    inbox.add(makeBatch({ id: "b" }), { pushed: false });
    clock.t = 3000;
    const r = inbox.take(1e9, size);
    expect(r.entries.map((e) => e.batch.id)).toEqual(["a", "b"]);
    expect(r.remaining).toBe(0);
    expect(inbox.status(["a", "b"])).toEqual([
      { batchId: "a", state: "picked-up", at: new Date(3000).toISOString() },
      { batchId: "b", state: "picked-up", at: new Date(3000).toISOString() },
    ]);
    expect(inbox.take(1e9, size)).toEqual({ entries: [], remaining: 0 });
  });

  it("stops before the total exceeds maxBytes but always takes one", () => {
    const { inbox } = inboxAt();
    for (const id of ["a", "b", "c"]) inbox.add(makeBatch({ id }), { pushed: false });
    const first = inbox.take(25, size);
    expect(first.entries.map((e) => e.batch.id)).toEqual(["a", "b"]);
    expect(first.remaining).toBe(1);
    const big = inbox.take(1, size);
    expect(big.entries.map((e) => e.batch.id)).toEqual(["c"]);
    expect(big.remaining).toBe(0);
  });

  it("never hands the same batch to two takes in the same tick", () => {
    const { inbox } = inboxAt();
    for (const id of ["a", "b"]) inbox.add(makeBatch({ id }), { pushed: false });
    const one = inbox.take(1e9, size).entries.map((e) => e.batch.id);
    const two = inbox.take(1e9, size).entries.map((e) => e.batch.id);
    expect([...one, ...two]).toEqual(["a", "b"]);
    expect(two).toEqual([]);
  });

  it("keeps only the last 200 picked-up records", () => {
    const { inbox } = inboxAt();
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 50; i++)
        inbox.add(makeBatch({ id: `r${round}-${i}` }), { pushed: false });
      inbox.take(1e9, size);
    }
    expect(inbox.status(["r0-49"])[0]!.state).toBe("unknown");
    expect(inbox.status(["r1-0"])[0]!.state).toBe("picked-up");
    expect(inbox.status(["r4-49"])[0]!.state).toBe("picked-up");
  });

  it("answers unknown for ids it never saw", () => {
    const { inbox } = inboxAt();
    expect(inbox.status(["zz"])).toEqual([{ batchId: "zz", state: "unknown", at: null }]);
  });

  it("counts waiting batches", () => {
    const { inbox } = inboxAt();
    inbox.add(makeBatch({ id: "a" }), { pushed: false });
    inbox.add(makeBatch({ id: "b" }), { pushed: true });
    expect(inbox.waitingCount()).toBe(1);
  });

  it("keeps at most 50 pushed batches, dropping the oldest", () => {
    const { inbox } = inboxAt();
    for (let i = 0; i < INBOX_LIMITS.pushed + 1; i++) {
      expect(inbox.add(makeBatch({ id: `p${i}` }), { pushed: true }).kind).toBe("added");
    }
    expect(inbox.status(["p0"])[0]!.state).toBe("unknown");
    expect(inbox.status(["p1"])[0]!.state).toBe("waiting");
    expect(INBOX_LIMITS.pushed).toBe(50);
  });

  it("never refuses a pushed batch", () => {
    const { inbox } = inboxAt();
    for (let i = 0; i < 50; i++) inbox.add(makeBatch({ id: `w${i}` }), { pushed: false });
    expect(inbox.add(makeBatch({ id: "p" }), { pushed: true }).kind).toBe("added");
  });
});
