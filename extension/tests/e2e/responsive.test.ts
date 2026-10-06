// Responsive layout at 320/768/1280 px and 200 % zoom; light/dark; reduced motion (T069, T070).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, startHarness, until, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
  await h.startSession("501-1", "/home/u/projects/shelf");
});

afterAll(async () => {
  await h?.close();
});

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function rectOf(selector: string): Promise<Box> {
  const el = await h.ui(selector);
  return (await h.driver.executeScript(
    "const r = arguments[0].getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };",
    el,
  )) as Box;
}

async function viewport(): Promise<{ w: number; h: number; scrollW: number }> {
  return (await h.driver.executeScript(
    "return { w: innerWidth, h: innerHeight, scrollW: document.documentElement.scrollWidth };",
  )) as { w: number; h: number; scrollW: number };
}

let pageScrollWidth = 0;

async function openBoxAt(width: number) {
  await h.setViewport(width, 700);
  const tab = await h.open("basic.html");
  pageScrollWidth = (await viewport()).scrollW;
  await h.togglePicker(tab);
  const el = await h.driver.findElement(By.css("#title"));
  await h.driver.actions().move({ origin: el }).click(el).perform();
  await h.waitForUi("textarea");
}

async function expectInside(selector: string) {
  const vp = await viewport();
  const r = await rectOf(selector);
  expect(r.left, `${selector} left @${vp.w}`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${selector} right @${vp.w}`).toBeLessThanOrEqual(vp.w);
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.bottom).toBeLessThanOrEqual(vp.h);
  // The fixture page may overflow by itself; our UI must not add to it.
  expect(vp.scrollW, `no extra horizontal scroll @${vp.w}`).toBeLessThanOrEqual(
    Math.max(vp.w, pageScrollWidth),
  );
}

describe("responsive picker UI (Principle III)", () => {
  for (const width of [320, 768, 1280]) {
    it(`comment box and chooser fit at ${width} px`, async () => {
      await openBoxAt(width);
      expect((await viewport()).w).toBe(width);
      await expectInside(".comment-box");
      await (await h.ui("textarea")).sendKeys("fits?");
      await (await h.ui("[data-action=send]")).click();
      await h.waitForUi(".session-chooser");
      await expectInside(".session-chooser");
      await (await h.ui("[data-action=cancel]")).click();
      await (await h.ui("[data-action=close]")).click();
    });
  }

  it("fits at 200 % zoom", async () => {
    await h.setViewport(1280, 800);
    const tab = await h.open("basic.html");
    pageScrollWidth = (await viewport()).scrollW;
    await h.chrome("FullZoom.setZoom(2, gBrowser.selectedBrowser);");
    pageScrollWidth = (await viewport()).scrollW;
    await h.togglePicker(tab);
    const el = await h.driver.findElement(By.css("#title"));
    await h.driver.actions().move({ origin: el }).click(el).perform();
    await h.waitForUi("textarea");
    expect((await viewport()).w).toBeLessThanOrEqual(640);
    await expectInside(".comment-box");
    await h.chrome("FullZoom.reset(gBrowser.selectedBrowser);");
    await (await h.ui("[data-action=close]")).click();
  });

  it("popup has no horizontal scroll at 320 px", async () => {
    const tab = await h.open("basic.html");
    await h.openPopup(tab);
    await h.setViewport(320, 600);
    await h.driver.wait(until.elementLocated(By.css("#pick")), 3000);
    const vp = await viewport();
    expect(vp.scrollW).toBeLessThanOrEqual(vp.w);
    await h.driver.close();
    await h.driver.switchTo().window(h.pageHandle);
  });

  it("follows the dark colour scheme and reduced motion", async () => {
    await h.setViewport(1280, 800);
    const tab = await h.open("basic.html");
    await h.togglePicker(tab);
    const el = await h.driver.findElement(By.css("#title"));
    await h.driver.actions().move({ origin: el }).click(el).perform();
    const box = await h.waitForUi(".comment-box");
    const bg = () =>
      h.driver.executeScript("return getComputedStyle(arguments[0]).backgroundColor", box);
    // 0 = dark, 1 = light (content colour-scheme override pref).
    await h.chrome(
      `Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 1);`,
    );
    await h.driver.wait(async () => (await bg()) === "rgb(255, 255, 255)", 3000);
    await h.chrome(
      `Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 0);`,
    );
    await h.driver.wait(async () => (await bg()) === "rgb(38, 38, 36)", 3000);
    await h.chrome(
      `Services.prefs.clearUserPref("layout.css.prefers-color-scheme.content-override");`,
    );
    const transition = await h.driver.executeScript(
      "return getComputedStyle(arguments[0]).transitionDuration",
      await h.ui("[data-role=outline]"),
    );
    expect(transition).toBe("0s");
  });
});
