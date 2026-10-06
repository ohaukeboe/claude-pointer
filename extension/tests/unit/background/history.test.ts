import { describe, expect, it, vi } from "vitest";
import {
  HISTORY_LIMIT,
  getHistory,
  recordSend,
  type HistoryEntry,
} from "../../../src/background/history";
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
