// Content script entry. Injected on demand (activeTab); guards against double injection.

import { ext } from "../lib/browser";
import type { BackgroundCall, TabMessage } from "../lib/messages";
import { Controller } from "./controller";
import { probeSource } from "./probe";

declare global {
  interface Window {
    __claudePointer?: Controller;
  }
}

if (!window.__claudePointer) {
  const controller = new Controller({
    doc: document,
    win: window,
    send: (msg: BackgroundCall) => ext.sendMessage(msg),
    probe: probeSource,
  });
  window.__claudePointer = controller;
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as TabMessage;
    if (m.type === "toggle") {
      controller.toggle();
      return Promise.resolve(controller.active);
    }
    if (m.type === "ping") return Promise.resolve(true);
    return undefined;
  });
}
