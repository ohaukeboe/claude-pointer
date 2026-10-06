// US1: select an element and send a comment (tasks.md T031).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Key } from "selenium-webdriver";
import { By, startHarness, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

async function hoverAndClick(selector: string) {
  const el = await h.driver.findElement(By.css(selector));
  await h.driver.actions().move({ origin: el }).perform();
  await h.driver.sleep(50);
  await h.driver.actions().click(el).perform();
}

describe("US1 send one comment", () => {
  it("picks the table, sends a comment, and the session receives one prompt", async () => {
    const session = await h.startSession("101-1", "/home/u/projects/shelf");
    const tab = await h.open("basic.html");
    const toggled = await h.togglePicker(tab);
    expect(toggled, JSON.stringify({ tab, toggled })).toEqual({ ok: true });

    const table = await h.driver.findElement(By.css("table.review-queue"));
    await h.driver.actions().move({ origin: table }).perform();
    await h.waitForUi("[data-role=outline]");
    const label = async () => (await h.ui("[data-role=outline-label]")).getText();
    expect(await label()).toBe("td");
    // Alt+ArrowUp widens the selection to the parent (FR-003): td -> tr -> tbody -> table.
    for (let i = 0; i < 3; i++) {
      await h.driver.actions().keyDown(Key.ALT).sendKeys(Key.ARROW_UP).keyUp(Key.ALT).perform();
    }
    expect(await label()).toBe("table.review-queue");
    const outlineRect = await (await h.ui("[data-role=outline]")).getRect();
    const tableRect = await table.getRect();
    expect(Math.abs(outlineRect.width - tableRect.width)).toBeLessThan(2);

    await h.driver.actions().sendKeys(Key.ENTER).perform();
    const textarea = await h.waitForUi("textarea");
    await textarea.sendKeys("make this table denser");
    await (await h.ui("[data-action=send]")).click();

    // First send from this origin: choose the session.
    const confirm = await h.waitForUi("[data-action=confirm]");
    expect(await (await h.ui(".session-chooser")).getText()).toContain("shelf");
    await confirm.click();

    await h.driver.wait(
      async () => {
        const status = await h.uiAll("[data-role=status]");
        return status.length > 0 && (await status[0]!.getText()) === "Delivered to shelf";
      },
      2000,
      "delivery confirmation within 2 s",
    );

    expect(session.prompts).toHaveLength(1);
    const content = session.prompts[0]!.params.content;
    expect(content).toContain(`Browser comments from ${h.baseUrl}/basic.html (1)`);
    expect(content).toContain("Comment: make this table denser");
    expect(content).toContain("selector: table");
    expect(content).toContain("[VIZ Media] Vagabond");
    expect(await h.driver.executeScript("return window.__clicked")).toEqual([]);

    // Pick mode ends by itself after delivery and leaves the page untouched.
    await h.driver.wait(
      async () => (await h.driver.findElements(By.css("claude-pointer-ui"))).length === 0,
      4000,
    );
  });

  it("blocks page clicks while picking and Escape sends nothing", async () => {
    const session = await h.startSession("102-1", "/home/u/projects/other");
    const tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await hoverAndClick("#link");
    expect(await h.driver.executeScript("return window.__clicked")).toEqual([]);
    expect(await h.driver.getCurrentUrl()).not.toContain("#navigated");

    const textarea = await h.waitForUi("textarea");
    await textarea.sendKeys("never sent");
    await textarea.sendKeys(Key.ESCAPE);
    await h.driver.wait(
      async () => (await h.driver.findElements(By.css("claude-pointer-ui"))).length === 0,
      2000,
    );
    expect(session.prompts).toHaveLength(0);

    // The page behaves normally again.
    await h.driver.findElement(By.css("#btn")).click();
    expect(await h.driver.executeScript("return window.__clicked")).toEqual(["btn"]);
  });

  it("Escape without a selection leaves pick mode", async () => {
    const tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await h.driver.findElement(By.css("claude-pointer-ui"));
    await h.driver.actions().sendKeys(Key.ESCAPE).perform();
    await h.driver.wait(
      async () => (await h.driver.findElements(By.css("claude-pointer-ui"))).length === 0,
      2000,
    );
  });
});
