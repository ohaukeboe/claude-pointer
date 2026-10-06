import { fakeBrowser } from "@webext-core/fake-browser";
import { describe, expect, it, vi } from "vitest";
import { ext, NATIVE_HOST } from "../../../src/lib/browser";

describe("browser seam", () => {
  it("reads, writes and removes storage.local values", async () => {
    await ext.storageSet({ a: 1, b: { c: 2 } });
    expect(await ext.storageGet<number>("a")).toBe(1);
    expect(await ext.storageGet<{ c: number }>("b")).toEqual({ c: 2 });
    expect(await ext.storageGet("missing")).toBeUndefined();
    await ext.storageRemove("a");
    expect(await ext.storageGet("a")).toBeUndefined();
  });

  it("sends native messages to the claude_pointer host", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    (fakeBrowser.runtime as unknown as { sendNativeMessage: unknown }).sendNativeMessage = send;
    await expect(ext.sendNative({ v: 1 })).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(NATIVE_HOST, { v: 1 });
    expect(NATIVE_HOST).toBe("claude_pointer");
  });

  it("returns the active tab", async () => {
    const tabs = [{ id: 7, url: "https://a.test/", title: "A" }];
    const query = vi
      .spyOn(fakeBrowser.tabs, "query")
      .mockImplementation((async () => tabs) as never);
    expect(await ext.activeTab()).toEqual({ id: 7, url: "https://a.test/", title: "A" });
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    tabs.length = 0;
    expect(await ext.activeTab()).toBeUndefined();
  });

  it("forwards runtime messages", async () => {
    const send = vi.spyOn(fakeBrowser.runtime, "sendMessage").mockResolvedValue("pong" as never);
    await expect(ext.sendMessage({ type: "ping" })).resolves.toBe("pong");
    expect(send).toHaveBeenCalledWith({ type: "ping" });
  });

  it("injects files and page-world scripts and sends tab messages", async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn().mockResolvedValue("ok");
    const g = globalThis as unknown as { browser: Record<string, unknown> };
    g.browser.scripting = { executeScript };
    (g.browser.tabs as Record<string, unknown>).sendMessage = sendMessage;
    await ext.injectContent(5);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 5 }, files: ["content.js"] });
    await ext.injectPageWorld(5);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: true },
      files: ["source-probe.js"],
      world: "MAIN",
    });
    await expect(ext.sendToTab(5, { type: "toggle" })).resolves.toBe("ok");
  });

  it("sets badge text and title", async () => {
    await ext.setBadge(3, "!", "Pick mode is not available on this page");
    expect(await fakeBrowser.action.getBadgeText({ tabId: 3 })).toBe("!");
  });
});

describe("getTab", () => {
  it("returns tab info or undefined", async () => {
    vi.spyOn(fakeBrowser.tabs, "get").mockImplementation((async (id: number) => {
      if (id === 1) return { id: 1, url: "https://a/", title: "A" };
      throw new Error("no tab");
    }) as never);
    expect(await ext.getTab(1)).toEqual({ id: 1, url: "https://a/", title: "A" });
    expect(await ext.getTab(2)).toBeUndefined();
  });
});
