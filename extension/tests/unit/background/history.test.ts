import { describe, expect, it, vi } from "vitest";
import {
  HISTORY_LIMIT,
  applyStatuses,
  getHistory,
  markSessionGone,
  recordSend,
  resend,
  type HistoryEntry,
} from "../../../src/background/history";
import { pendingKey } from "../../../src/content/pending";
import type { Comment } from "../../../../shared/types";
import { handleMessage, popupState, togglePicker, canPick } from "../../../src/background/router";
import { ext } from "../../../src/lib/browser";
import { makeComment } from "../../../../shared/fixtures";

const entry = (batchId: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  batchId,
  sentAt: "2026-10-06T10:00:00.000Z",
  count: 1,
  sessionId: "1-1",
  projectName: "shelf",
  state: "delivered",
  error: null,
  ...over,
});

describe("history (US4)", () => {
  it("keeps newest first and only the last 20", async () => {
    for (let i = 0; i < 25; i++) await recordSend("http://a", entry(`b${i}`));
    const h = await getHistory("http://a");
    expect(h).toHaveLength(HISTORY_LIMIT);
    expect(HISTORY_LIMIT).toBe(20);
    expect(h[0]!.batchId).toBe("b24");
    expect(h[19]!.batchId).toBe("b5");
  });

  it("a retry updates the entry with the same batchId", async () => {
    await recordSend("http://a", entry("x", { state: "failed", error: "ended" }));
    await recordSend("http://a", entry("y"));
    await recordSend("http://a", entry("x", { state: "delivered" }));
    expect((await getHistory("http://a")).map((e) => [e.batchId, e.state])).toEqual([
      ["x", "delivered"],
      ["y", "delivered"],
    ]);
  });

  it("each send through the router appends an entry", async () => {
    vi.spyOn(ext, "sendNative")
      .mockResolvedValueOnce({ v: 1, ok: true, batchId: "B1", deliveredAt: "t" })
      .mockResolvedValueOnce({ v: 1, ok: false, error: { code: "session-gone", message: "x" } });
    const base = {
      type: "send" as const,
      pageUrl: "http://localhost:5173/p",
      sessionId: "1-1",
      projectName: "shelf",
    };
    await handleMessage({
      ...base,
      comments: [makeComment(), makeComment({ id: "c2" })],
      batchId: "B1",
    });
    await handleMessage({ ...base, comments: [makeComment()], batchId: "B2" });
    const h = await getHistory("http://localhost:5173");
    expect(h.map((e) => [e.batchId, e.count, e.projectName, e.state, e.error])).toEqual([
      ["B2", 1, "shelf", "failed", "The Claude Code session has ended."],
      ["B1", 2, "shelf", "delivered", null],
    ]);
  });
});

describe("popup state and toggling", () => {
  const tab = { id: 4, url: "http://localhost:5173/p", title: "P" };

  it("reports the target, sessions and history for a page", async () => {
    const shelf = { id: "1-1", projectDir: "/p/shelf", projectName: "shelf", startedAt: "t" };
    vi.spyOn(ext, "sendNative").mockResolvedValue({
      v: 1,
      ok: true,
      sessions: [{ session: shelf, reason: "recent", score: 49 }],
    });
    await handleMessage({ type: "confirm-target", pageUrl: tab.url, session: shelf });
    await recordSend("http://localhost:5173", entry("b"));
    expect(await popupState(tab)).toMatchObject({
      available: true,
      origin: "http://localhost:5173",
      target: shelf,
      staleBinding: false,
      hostError: null,
      history: [{ batchId: "b" }],
    });
  });

  it("flags a stale binding and a missing host", async () => {
    vi.spyOn(ext, "sendNative").mockRejectedValue(new Error("no host"));
    await handleMessage({
      type: "confirm-target",
      pageUrl: tab.url,
      session: { id: "9-9", projectDir: "/x", projectName: "x", startedAt: "t" },
    });
    expect(await popupState(tab)).toMatchObject({
      target: null,
      staleBinding: true,
      hostError: expect.stringContaining("install"),
    });
  });

  it("is unavailable on browser pages", async () => {
    expect(await popupState({ id: 1, url: "about:addons", title: "" })).toMatchObject({
      available: false,
    });
    expect(await popupState(undefined)).toMatchObject({ available: false });
    expect(canPick("file:///x.html")).toBe(true);
    expect(canPick("moz-extension://x/popup.html")).toBe(false);
  });

  it("toggles by injecting the content script and messaging the tab", async () => {
    const inject = vi.spyOn(ext, "injectContent").mockResolvedValue();
    const page = vi.spyOn(ext, "injectPageWorld").mockRejectedValue(new Error("blocked"));
    const send = vi.spyOn(ext, "sendToTab").mockResolvedValue(true);
    const badge = vi.spyOn(ext, "setBadge").mockResolvedValue();
    expect(await togglePicker(tab)).toEqual({ ok: true });
    expect(inject).toHaveBeenCalledWith(4);
    expect(page).toHaveBeenCalledWith(4);
    expect(send).toHaveBeenCalledWith(4, { type: "toggle" });
    expect(badge).toHaveBeenCalledWith(4, "", "Claude Pointer");
  });

  it("shows a badge where pick mode is not available", async () => {
    const badge = vi.spyOn(ext, "setBadge").mockResolvedValue();
    expect(await togglePicker({ id: 2, url: "about:config", title: "" })).toMatchObject({
      ok: false,
    });
    expect(badge).toHaveBeenCalledWith(2, "!", "Pick mode is not available on this page.");
    vi.spyOn(ext, "injectContent").mockRejectedValue(new Error("Missing host permission"));
    expect(
      await togglePicker({ id: 3, url: "https://addons.mozilla.org/", title: "" }),
    ).toMatchObject({ ok: false });
    expect(await togglePicker(undefined)).toMatchObject({ ok: false });
  });

  it("routes toggle and popup-state to a given tab id or the active tab", async () => {
    const get = vi.spyOn(ext, "getTab").mockResolvedValue(undefined);
    const active = vi.spyOn(ext, "activeTab").mockResolvedValue(undefined);
    await handleMessage({ type: "toggle-picker", tabId: 9 });
    await handleMessage({ type: "popup-state" });
    expect(get).toHaveBeenCalledWith(9);
    expect(active).toHaveBeenCalled();
    vi.spyOn(ext, "sendNative").mockResolvedValue({ v: 1, ok: true, sessions: [] });
    expect(await handleMessage({ type: "list-sessions", pageUrl: tab.url, pageTitle: "" })).toEqual(
      { ok: true, sessions: [] },
    );
    expect(await handleMessage({ type: "nope" } as never)).toBeUndefined();
  });
});

// specs/002-no-channel-delivery/data-model.md "HistoryEntry"
describe("history (feature 002)", () => {
  const PAGE = "http://localhost:5173/p";
  const ORIGIN = "http://localhost:5173";
  const base = {
    type: "send" as const,
    pageUrl: PAGE,
    sessionId: "1-1",
    projectName: "shelf",
  };

  it("stores waiting with pageKey and comments when the session holds the batch", async () => {
    vi.spyOn(ext, "sendNative").mockResolvedValue({
      v: 1,
      ok: true,
      batchId: "W",
      deliveredAt: "t",
      status: "waiting",
    });
    const c = makeComment();
    await handleMessage({ ...base, comments: [c], batchId: "W" });
    const [h] = await getHistory(ORIGIN);
    expect(h).toMatchObject({ batchId: "W", state: "waiting", pageKey: pendingKey(PAGE) });
    expect(h!.comments).toHaveLength(1);
    expect(h!.comments![0]!.id).toBe(c.id);
  });

  it("stores delivered without comments when the batch was pushed", async () => {
    vi.spyOn(ext, "sendNative").mockResolvedValue({
      v: 1,
      ok: true,
      batchId: "P",
      deliveredAt: "t",
      status: "pushed",
    });
    await handleMessage({ ...base, comments: [makeComment()], batchId: "P" });
    expect((await getHistory(ORIGIN))[0]).toMatchObject({ state: "delivered", comments: null });
  });

  it("turns picked-up batches into picked-up and drops their comments", async () => {
    await recordSend(ORIGIN, entry("a", { state: "waiting", comments: [makeComment()] }));
    await recordSend(ORIGIN, entry("b", { state: "waiting", comments: [makeComment()] }));
    await applyStatuses(ORIGIN, [
      { batchId: "a", state: "picked-up", at: "t" },
      { batchId: "b", state: "unknown", at: null },
    ]);
    const h = await getHistory(ORIGIN);
    expect(h.find((e) => e.batchId === "a")).toMatchObject({
      state: "picked-up",
      comments: null,
    });
    expect(h.find((e) => e.batchId === "b")).toMatchObject({ state: "waiting" });
  });

  it("marks every waiting entry of an ended session not-picked-up and keeps comments", async () => {
    await recordSend(ORIGIN, entry("a", { state: "waiting", comments: [makeComment()] }));
    await recordSend(
      ORIGIN,
      entry("b", { state: "waiting", sessionId: "2-2", comments: [makeComment()] }),
    );
    await recordSend(ORIGIN, entry("c", { state: "delivered" }));
    await markSessionGone(ORIGIN, "1-1");
    const h = await getHistory(ORIGIN);
    expect(h.map((e) => [e.batchId, e.state])).toEqual([
      ["c", "delivered"],
      ["b", "waiting"],
      ["a", "not-picked-up"],
    ]);
    expect(h.find((e) => e.batchId === "a")!.comments).toHaveLength(1);
  });

  it("resend puts the comments back as pending and removes the entry", async () => {
    const key = pendingKey(PAGE);
    const existing = makeComment({ id: "old" });
    await ext.storageSet({ [key]: [existing] });
    await recordSend(
      ORIGIN,
      entry("a", {
        state: "not-picked-up",
        pageKey: key,
        comments: [makeComment({ id: "c1", state: "sending" })],
      }),
    );
    expect(await resend(ORIGIN, "a")).toBe(true);
    const pending = (await ext.storageGet<Comment[]>(key))!;
    expect(pending.map((c) => [c.id, c.state])).toEqual([
      ["old", "pending"],
      ["c1", "pending"],
    ]);
    expect(await getHistory(ORIGIN)).toEqual([]);
    expect(await resend(ORIGIN, "missing")).toBe(false);
  });

  it("polls batch-status per session for waiting entries only", async () => {
    await recordSend(ORIGIN, entry("a", { state: "waiting", comments: [makeComment()] }));
    await recordSend(
      ORIGIN,
      entry("b", { state: "waiting", sessionId: "2-2", comments: [makeComment()] }),
    );
    await recordSend(ORIGIN, entry("c", { state: "delivered" }));
    const calls: unknown[] = [];
    vi.spyOn(ext, "sendNative").mockImplementation(async (m) => {
      calls.push(m);
      const req = m as { sessionId: string; batchIds: string[] };
      if (req.sessionId === "2-2")
        return { v: 1, ok: false, error: { code: "session-gone", message: "x" } };
      return {
        v: 1,
        ok: true,
        statuses: req.batchIds.map((batchId) => ({ batchId, state: "picked-up", at: "t" })),
      };
    });
    const h = (await handleMessage({ type: "batch-status", origin: ORIGIN })) as HistoryEntry[];
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual({ v: 1, type: "batch-status", sessionId: "1-1", batchIds: ["a"] });
    expect(calls).toContainEqual({ v: 1, type: "batch-status", sessionId: "2-2", batchIds: ["b"] });
    expect(h.map((e) => [e.batchId, e.state])).toEqual([
      ["c", "delivered"],
      ["b", "not-picked-up"],
      ["a", "picked-up"],
    ]);
  });

  it("routes resend", async () => {
    await recordSend(
      ORIGIN,
      entry("a", { state: "not-picked-up", pageKey: pendingKey(PAGE), comments: [makeComment()] }),
    );
    expect(await handleMessage({ type: "resend", origin: ORIGIN, batchId: "a" })).toBe(true);
  });

  it("keeps the comments of a send refused with inbox-full", async () => {
    vi.spyOn(ext, "sendNative").mockResolvedValue({
      v: 1,
      ok: false,
      error: { code: "inbox-full", message: "x" },
    });
    const res = await handleMessage({ ...base, comments: [makeComment()], batchId: "F" });
    expect(res).toMatchObject({
      ok: false,
      code: "inbox-full",
      message: "Claude has 50 unread batches; ask it to pick them up.",
    });
    expect((await getHistory(ORIGIN))[0]).toMatchObject({ state: "failed" });
  });
});
