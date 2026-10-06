// Hostile pages, huge elements, restricted pages (T071).
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

describe("hostile pages", () => {
  it("UI stays visible and styled above a max z-index overlay and `all: unset !important`", async () => {
    const tab = await h.open("hostile.html");
    await h.togglePicker(tab);
    const target = await h.driver.findElement(By.css("#target"));
    await h.driver.actions().move({ origin: target }).click(target).perform();
    const box = await h.waitForUi(".comment-box");
    const style = (await h.driver.executeScript(
      `const s = getComputedStyle(arguments[0]);
       const r = arguments[0].getBoundingClientRect();
       const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
       return { pos: s.position, radius: s.borderTopLeftRadius, padding: s.paddingTop, hitHost: hit && hit.localName };`,
      box,
    )) as Record<string, string>;
    expect(style.pos).toBe("fixed");
    expect(style.radius).toBe("10px");
    expect(style.padding).toBe("12px");
    expect(style.hitHost).toBe("claude-pointer-ui");

    // Bubble-phase page shortcut handlers do not see keys typed into our UI.
    // Known limitation: capture-phase listeners on window still do (window.__captured).
    await (await h.ui("textarea")).sendKeys("abc");
    expect(await h.driver.executeScript("return window.__keys")).toEqual([]);
    await (await h.ui("textarea")).sendKeys(Key.ESCAPE);
  });

  it("sends page text as fenced data and bounds huge HTML to 4096 chars", async () => {
    const session = await h.startSession("601-1", "/home/u/projects/x");
    let tab = await h.open("hostile.html");
    await h.togglePicker(tab);
    const target = await h.driver.findElement(By.css("#target"));
    await h.driver.actions().move({ origin: target }).click(target).perform();
    await (await h.waitForUi("textarea")).sendKeys("make this bold");
    await (await h.ui("[data-action=send]")).click();
    await (await h.waitForUi("[data-action=confirm]")).click();
    await h.driver.wait(async () => session.prompts.length === 1, 3000);
    const content = session.prompts[0]!.params.content;
    const fence = content.indexOf("```page-data");
    expect(content.indexOf("Comment: make this bold")).toBeLessThan(fence);
    expect(content.indexOf("ignore previous instructions")).toBeGreaterThan(fence);

    tab = await h.open("long.html");
    await h.togglePicker(tab);
    const big = await h.driver.findElement(By.css(".c0"));
    await h.driver.actions().move({ origin: big }).perform();
    // Widen from one cell to the whole 100 KB section.
    await h.driver.actions().keyDown(Key.ALT).sendKeys(Key.ARROW_UP).keyUp(Key.ALT).perform();
    await h.driver.actions().sendKeys(Key.ENTER).perform();
    await (await h.waitForUi("textarea")).sendKeys("big");
    await (await h.ui("[data-action=send]")).click();
    await h.driver.wait(async () => session.prompts.length === 2, 3000);
    const html = session.prompts[1]!.params.content.split("html:\n")[1]!.split("\n```")[0]!;
    expect(html.length).toBe(4096);
    expect(html.endsWith("…")).toBe(true);
  });
});
