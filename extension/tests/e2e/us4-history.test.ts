// US4: see what happened to a comment (tasks.md T065).
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

describe("US4 history", () => {
  it("lists a delivered and a failed send in the popup", async () => {
    const session = await h.startSession("401-1", "/home/u/projects/shelf");
    let tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await send("#title", "works");
    await (await h.waitForUi("[data-action=confirm]")).click();
    await h.driver.wait(async () => (await status()) === "Delivered to shelf", 2000);
    await h.driver.wait(
      async () => (await h.driver.findElements(By.css("claude-pointer-ui"))).length === 0,
      4000,
    );

    session.failWith = "timeout";
    tab = await h.open("basic.html");
    await h.togglePicker(tab);
    await send("#btn", "fails");
    await h.driver.wait(
      async () => (await status()) === "The session did not answer in time.",
      3000,
    );

    await h.openPopup(tab);
    const list = await h.driver.wait(until.elementLocated(By.css(".history")), 3000);
    const rows = await list.findElements(By.css("li"));
    const texts = await Promise.all(rows.map((r) => r.getText()));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("1 comment → shelf");
    expect(texts[0]).toContain("failed");
    expect(texts[0]).toContain("The session did not answer in time.");
    expect(texts[1]).toContain("delivered");
    expect(session.prompts).toHaveLength(1);
  });
});
