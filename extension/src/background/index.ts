// Background event page: registers listeners only.

import { ext } from "../lib/browser";
import { handleMessage, togglePicker } from "./router";

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-picker") void ext.activeTab().then(togglePicker);
});

browser.runtime.onMessage.addListener((msg: unknown) =>
  handleMessage(msg as Parameters<typeof handleMessage>[0]),
);
