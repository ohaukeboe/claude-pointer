// Responsiveness budget (Principle IV, T072).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, startHarness, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

describe("performance", () => {
  it("hovering 200 times on a large page causes no long task over 50 ms; click feedback < 100 ms", async () => {
    const tab = await h.open("long.html");
    await h.driver.executeScript(`
      window.__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); })
        .observe({ type: "longtask", buffered: false });`);
    await h.togglePicker(tab);
    await h.driver.findElement(By.css("claude-pointer-ui"));
    const cells = await h.driver.findElements(By.css(".cell"));
    let actions = h.driver.actions();
    for (let i = 0; i < 200; i++)
      actions = actions.move({ origin: cells[i % 20]!, x: (i % 7) - 3, y: 0, duration: 0 });
    await actions.perform();
    const long = (await h.driver.executeScript("return window.__long")) as number[];
    expect(
      long.filter((d) => d > 50),
      `long tasks: ${JSON.stringify(long)}`,
    ).toEqual([]);

    // Click -> outline + comment box visible.
    const ms = (await h.driver.executeAsyncScript(`
      const done = arguments[0];
      const target = document.querySelector(".c5");
      const host = document.querySelector("claude-pointer-ui");
      const t0 = performance.now();
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      requestAnimationFrame(() => {
        const box = host.shadowRoot.querySelector(".comment-box");
        done(box ? performance.now() - t0 : -1);
      });`)) as number;
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(100);
  });
});
