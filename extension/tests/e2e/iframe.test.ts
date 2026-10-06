// Elements inside same-origin iframes (T073).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, startHarness, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

describe("iframes", () => {
  it("picks an element inside a same-origin iframe and reports its frame", async () => {
    const session = await h.startSession("701-1", "/home/u/projects/frames");
    const tab = await h.open("iframe.html");
    await h.togglePicker(tab);
    const frame = await h.driver.findElement(By.css("#frame"));
    const r = await frame.getRect();
    // Move over the frame's button and click (top-level coordinates).
    const inner = (await h.driver.executeScript(
      `const b = document.getElementById("frame").contentDocument.getElementById("btn").getBoundingClientRect();
       return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`,
    )) as { x: number; y: number };
    await h.driver
      .actions()
      .move({ x: Math.round(r.x + inner.x), y: Math.round(r.y + inner.y) })
      .perform();
    await h.driver.wait(
      async () => (await (await h.ui("[data-role=outline-label]")).getText()) === "button#btn",
      2000,
    );
    await h.driver.actions().click().perform();
    await (await h.waitForUi("textarea")).sendKeys("in frame");
    await (await h.ui("[data-action=send]")).click();
    await (await h.waitForUi("[data-action=confirm]")).click();
    await h.driver.wait(async () => session.prompts.length === 1, 3000);
    const content = session.prompts[0]!.params.content;
    expect(content).toContain("selector: #btn");
    expect(content).toContain(`frame: ${h.baseUrl}/basic.html`);
    expect(
      await h.driver.executeScript(
        `return document.getElementById("frame").contentWindow.__clicked`,
      ),
    ).toEqual([]);
  });
});
