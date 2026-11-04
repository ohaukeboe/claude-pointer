// Feature 002 US1: comments wait in a no-channel session (specs/002-no-channel-delivery
// tasks.md T014, quickstart V1 and V5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, startHarness, until, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

async function send(selector: string, text: string) {
  const el = await h.driver.findElement(By.css(selector));
  await h.driver.actions().move({ origin: el }).click(el).perform();
  await (await h.waitForUi("textarea")).sendKeys(text);
  await (await h.ui("[data-action=send]")).click();
}

async function status(): Promise<string> {
  const s = await h.uiAll("[data-role=status]");
  return s.length ? s[0]!.getText() : "";
}

async function historyState(batchId: string): Promise<string> {
  const rows = await h.driver.findElements(By.css(`.history li[data-batch='${batchId}']`));
  return rows.length ? ((await rows[0]!.getAttribute("data-state")) ?? "") : "";
}

describe("US1 (002) no-channel session", () => {
  it("shows waiting, then picked up while the popup is open", async () => {
    const session = await h.startSession("501-1", "/home/u/projects/shelf");
    session.mode = "no-channel";
    const tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await send("#title", "works");
    await (await h.waitForUi("[data-action=confirm]")).click();
    await h.driver.wait(async () => (await status()) === "Waiting for Claude in shelf", 2000);
    const batchId = [...session.states.keys()][0]!;
    expect(session.states.get(batchId)).toBe("waiting");

    await h.openPopup(tab);
    await h.driver.wait(until.elementLocated(By.css(".history")), 3000);
    expect(await historyState(batchId)).toBe("waiting");
    expect(await await h.driver.findElement(By.css(".history")).getText()).toContain("Waiting");

    session.states.set(batchId, "picked-up");
    await h.driver.wait(async () => (await historyState(batchId)) === "picked-up", 2500);
    expect(await h.driver.findElement(By.css(".history")).getText()).toContain("Picked up");

    // T037: the target's watch state follows the session while the popup is open.
    const watchText = async () => (await h.driver.findElement(By.css("#watch"))).getText();
    expect(await watchText()).toBe("Not watching — type /mcp__claude-pointer__comments");
    session.watch = "busy";
    await h.driver.wait(async () => (await watchText()) === "Watching (busy)", 2500);
    session.watch = "gap";
    await h.driver.wait(async () => (await watchText()) === "Watching", 2500);
    await h.driver.close();
    await h.driver.switchTo().window(h.pageHandle);
  });

  it("shows not picked up when the session ends and resends to a pending marker", async () => {
    // The first test's session ends, so this send asks for a session again.
    await h.sessions[0]!.close();
    const session = await h.startSession("502-1", "/home/u/projects/shelf");
    session.mode = "no-channel";
    let tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await send("#btn", "lost");
    await (await h.waitForUi("[data-action=confirm]")).click();
    await h.driver.wait(async () => (await status()) === "Waiting for Claude in shelf", 2000);
    const batchId = [...session.states.keys()][0]!;
    await session.close();

    await h.openPopup(tab);
    await h.driver.wait(async () => (await historyState(batchId)) === "not-picked-up", 3000);
    const row = await h.driver.findElement(By.css(`.history li[data-batch='${batchId}']`));
    expect(await row.getText()).toContain("Not picked up");
    await (await row.findElement(By.css("[data-action=resend]"))).click();
    await h.driver.wait(
      async () =>
        (await h.driver.findElements(By.css(`.history li[data-batch='${batchId}']`))).length === 0,
      2000,
    );
    await h.driver.close();
    await h.driver.switchTo().window(h.pageHandle);

    tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await h.driver.wait(async () => (await h.uiAll(".marker")).length === 1, 3000);
  });
});
