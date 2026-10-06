// US2: connect to the correct session (tasks.md T049).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Key } from "selenium-webdriver";
import { By, startHarness, until, type Harness } from "./harness";

let h: Harness;
let devServer: ChildProcess;
let devUrl = "";
let projects = "";

const fixture = fileURLToPath(new URL("fixtures/basic.html", import.meta.url));

/** A "dev server" for project A: its own process, running from inside A's directory. */
function startDevServer(cwd: string): Promise<{ child: ChildProcess; url: string }> {
  const code = `
    const http = require("node:http"), fs = require("node:fs");
    const s = http.createServer((q, r) => { r.writeHead(200, {"content-type": "text/html"}); r.end(fs.readFileSync(${JSON.stringify(fixture)})); });
    s.listen(0, "127.0.0.1", () => console.log(s.address().port));`;
  const child = spawn(process.execPath, ["-e", code], {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve) =>
    child.stdout!.once("data", (d) =>
      resolve({ child, url: `http://127.0.0.1:${String(d).trim()}/basic.html` }),
    ),
  );
}

beforeAll(async () => {
  h = await startHarness();
  projects = realpathSync(mkdtempSync(join(tmpdir(), "cp-projects-")));
  mkdirSync(join(projects, "alpha/web"), { recursive: true });
  mkdirSync(join(projects, "beta"), { recursive: true });
  const dev = await startDevServer(join(projects, "alpha/web"));
  devServer = dev.child;
  devUrl = dev.url;
});

afterAll(async () => {
  devServer?.kill();
  await h?.close();
  rmSync(projects, { recursive: true, force: true });
});

async function comment(text: string) {
  const td = await h.driver.findElement(By.css("h1"));
  await h.driver.actions().move({ origin: td }).click(td).perform();
  const textarea = await h.waitForUi("textarea");
  await textarea.sendKeys(text);
  await (await h.ui("[data-action=send]")).click();
}

async function status(): Promise<string> {
  const s = await h.uiAll("[data-role=status]");
  return s.length ? s[0]!.getText() : "";
}

describe("US2 correct session", () => {
  it("suggests the dev-server session, remembers it, shows it, and recovers when it ends", async () => {
    const alpha = await h.startSession("201-1", join(projects, "alpha"), "2026-10-06T08:00:00Z");
    const beta = await h.startSession("202-1", join(projects, "beta"), "2026-10-06T09:00:00Z");

    let tab = await h.openUrl(devUrl);
    await h.togglePicker(tab);
    await comment("first");

    // Suggestion: alpha, because its dev server serves this page, although beta is newer.
    await h.waitForUi(".session-chooser");
    const checked = await h.ui(".sessions input:checked");
    expect(await checked.getAttribute("value")).toBe("201-1");
    expect(await (await h.ui("[data-session='201-1']")).getText()).toContain("dev server");
    await (await h.ui("[data-action=confirm]")).click();
    await h.driver.wait(async () => (await status()) === "Delivered to alpha", 2000);

    // Second send: no question, same session.
    tab = await h.openUrl(devUrl);
    await h.togglePicker(tab);
    await comment("second");
    await h.driver.wait(async () => (await status()) === "Delivered to alpha", 2000);
    expect((await h.uiAll(".session-chooser")).length).toBe(0);
    expect(
      alpha.prompts.map(
        (p) =>
          p.params.content.includes("Comment: first") ||
          p.params.content.includes("Comment: second"),
      ),
    ).toEqual([true, true]);
    expect(beta.prompts).toHaveLength(0);

    // Popup shows the target before sending (FR-011).
    await h.openPopup(tab);
    const target = await h.driver.wait(until.elementLocated(By.css("#target")), 3000);
    const text = await target.getText();
    expect(text).toContain("alpha");
    expect(text).toContain(join(projects, "alpha"));
    await h.driver.close();
    await h.driver.switchTo().window(h.pageHandle);

    // The chosen session ends: sending fails clearly, keeps the comment, and asks again.
    await alpha.close();
    tab = await h.openUrl(devUrl);
    await h.togglePicker(tab);
    await comment("third");
    await h.waitForUi(".session-chooser");
    expect(await (await h.ui("[data-role=hint]")).getText()).toBe(
      "The session you chose for this site has ended. Choose another one:",
    );
    const options = await h.uiAll(".sessions input");
    expect(options).toHaveLength(1);
    await (await h.ui("[data-action=cancel]")).click();
    expect(await (await h.ui("textarea")).getAttribute("value")).toBe("third");
    await (await h.ui("textarea")).sendKeys(Key.ESCAPE);
    expect(beta.prompts).toHaveLength(0);
  });
});
