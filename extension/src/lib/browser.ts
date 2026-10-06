// The single seam over browser.* (Constitution Principle II). Everything else imports `ext`,
// so unit tests can replace one method at a time.

export const NATIVE_HOST = "claude_pointer";

export interface TabInfo {
  id: number;
  url: string;
  title: string;
}

export const ext = {
  async storageGet<T>(key: string): Promise<T | undefined> {
    const got = await browser.storage.local.get(key);
    return got[key] as T | undefined;
  },

  storageSet(items: Record<string, unknown>): Promise<void> {
    return browser.storage.local.set(items);
  },

  storageRemove(key: string): Promise<void> {
    return browser.storage.local.remove(key);
  },

  sendNative(message: unknown): Promise<unknown> {
    return browser.runtime.sendNativeMessage(NATIVE_HOST, message);
  },

  sendMessage<T>(message: unknown): Promise<T> {
    return browser.runtime.sendMessage(message) as Promise<T>;
  },

  async activeTab(): Promise<TabInfo | undefined> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return undefined;
    return { id: tab.id, url: tab.url ?? "", title: tab.title ?? "" };
  },

  async getTab(tabId: number): Promise<TabInfo | undefined> {
    try {
      const tab = await browser.tabs.get(tabId);
      return { id: tabId, url: tab.url ?? "", title: tab.title ?? "" };
    } catch {
      return undefined;
    }
  },

  async injectContent(tabId: number): Promise<void> {
    await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  },

  async injectPageWorld(tabId: number): Promise<void> {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["source-probe.js"],
      world: "MAIN",
    } as browser.scripting.ScriptInjection);
  },

  sendToTab<T>(tabId: number, message: unknown): Promise<T> {
    return browser.tabs.sendMessage(tabId, message) as Promise<T>;
  },

  async setBadge(tabId: number, text: string, title: string): Promise<void> {
    await browser.action.setBadgeText({ tabId, text });
    await browser.action.setTitle({ tabId, title });
  },
};
