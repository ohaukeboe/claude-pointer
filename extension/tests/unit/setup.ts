import { fakeBrowser } from "@webext-core/fake-browser";
import { afterEach, beforeEach, vi } from "vitest";

(globalThis as unknown as { browser: unknown }).browser = fakeBrowser;

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.replaceChildren();
});
