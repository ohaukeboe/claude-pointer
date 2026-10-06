// US3: collect several comments and send them together (tasks.md T059).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, startHarness, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

async function pickAndWrite(selector: string, text: string) {
  const el = await h.driver.findElement(By.css(selector));
  await h.driver.actions().move({ origin: el }).click(el).perform();
  const textarea = await h.waitForUi("textarea");
  await textarea.sendKeys(text);
}

async function markers(): Promise<string[]> {
  const all = await h.uiAll(".marker");
  const out: string[] = [];
  for (const m of all) if (await m.isDisplayed()) out.push(await m.getText());
  return out;
}

describe("US3 batch", () => {
  it("adds three comments, survives reload, and sends them as one prompt", async () => {
    const session = await h.startSession("301-1", "/home/u/projects/shelf");
    let tab = await h.open("basic.html");
    await h.togglePicker(tab);

    await pickAndWrite("#title", "one");
    await (await h.ui("[data-action=add]")).click();
    await h.driver.wait(async () => (await markers()).length === 1, 2000);
    await pickAndWrite("#btn", "two");
    await (await h.ui("[data-action=add]")).click();
    await h.driver.wait(async () => (await markers()).length === 2, 2000);
    await pickAndWrite("#link", "three");
    await (await h.ui("[data-action=add]")).click();
    await h.driver.wait(async () => (await markers()).length === 3, 2000);
    expect(await markers()).toEqual(["1", "2", "3"]);
    expect(session.prompts).toHaveLength(0);

    // Reload: pending comments come back when pick mode starts again.
    await h.driver.navigate().refresh();
    tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await h.driver.wait(async () => (await markers()).length === 3, 3000);

    // Send from a fourth draft: one prompt with all four, in order.
    await pickAndWrite("table.review-queue", "four");
    await (await h.ui("[data-action=send]")).click();
    await h.waitForUi("[data-action=confirm]");
    await (await h.ui("[data-action=confirm]")).click();
    await h.driver.wait(async () => session.prompts.length === 1, 3000);

    const content = session.prompts[0]!.params.content;
    expect(content.split("\n")[0]).toMatch(/\(4\)$/);
    const order = ["one", "two", "three", "four"].map((t) => content.indexOf(`Comment: ${t}`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(session.prompts[0]!.params.meta.count).toBe("4");

    // Markers are cleared after delivery.
    expect(await markers()).toEqual([]);
  });
});
