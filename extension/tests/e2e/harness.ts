// End-to-end harness: headless Firefox + geckodriver with the e2e build installed as a
// temporary add-on, a real native host, and fake Claude Code sessions (tasks.md T021).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until, type WebDriver, type WebElement } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { install } from "../../../helper/src/install";
import { startFakeSession, type FakeSession } from "../../../helper/tests/support/fake-session";

export const EXTENSION_ID = "claude-pointer@ohaukeboe";
export const EXTENSION_UUID = "6d1f3c52-8a0e-4c7b-9a51-3e2f7b0c9d11";
export const EXTENSION_ORIGIN = `moz-extension://${EXTENSION_UUID}`;

const root = fileURLToPath(new URL("../../..", import.meta.url));
const extensionDir = join(root, "extension");
const helperDir = join(root, "helper");
const fixturesDir = join(extensionDir, "tests/e2e/fixtures");

function which(bin: string): string {
  return execFileSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim();
}

export interface Harness {
  driver: WebDriver;
  baseUrl: string;
  runtimeDir: string;
  socketDir: string;
  sessions: FakeSession[];
  startSession(id: string, projectDir: string, startedAt?: string): Promise<FakeSession>;
  /** Open a fixture in the page tab and return its tab id (as seen by the extension). */
  open(fixture: string): Promise<number>;
  /** Open any URL in the page tab and return its tab id. */
  openUrl(url: string): Promise<number>;
  /** Start or stop pick mode in a tab, as the toolbar button does. */
  togglePicker(tabId: number): Promise<{ ok: boolean; message?: string }>;
  /** Open the popup page for a tab in a new tab and switch to it. */
  openPopup(tabId: number): Promise<void>;
  setViewport(width: number, height?: number): Promise<void>;
  ui(selector: string): Promise<WebElement>;
  uiAll(selector: string): Promise<WebElement[]>;
  waitForUi(selector: string, timeout?: number): Promise<WebElement>;
  /** Run a script in browser chrome context (prefs, zoom). */
  chrome<T>(script: string, ...args: unknown[]): Promise<T>;
  pageHandle: string;
  close(): Promise<void>;
}

function serveFixtures(): Promise<{ server: Server; baseUrl: string }> {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(
      /^\/+/,
      "",
    );
    if (path.includes("..")) {
      res.writeHead(400).end();
      return;
    }
    try {
      const body = readFileSync(join(fixturesDir, path || "basic.html"));
      res
        .writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    }),
  );
}

export async function startHarness(): Promise<Harness> {
  execFileSync(process.execPath, ["build.mjs"], { cwd: helperDir, stdio: "ignore" });
  execFileSync(process.execPath, ["build.mjs", "--e2e"], { cwd: extensionDir, stdio: "ignore" });

  const home = mkdtempSync(join(tmpdir(), "cp-home-"));
  const runtimeDir = mkdtempSync(join(tmpdir(), "cp-run-"));
  const socketDir = join(runtimeDir, "claude-pointer");
  install({
    home,
    execPath: process.execPath,
    cliPath: join(helperDir, "dist/cli.js"),
  });

  const { server, baseUrl } = await serveFixtures();

  const options = new firefox.Options()
    .addArguments("-headless")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID }),
    )
    .setPreference("browser.shell.checkDefaultBrowser", false)
    .setPreference("datareporting.policy.dataSubmissionEnabled", false)
    .setPreference("ui.prefersReducedMotion", 1);
  options.setBinary(which("firefox"));
  options.enableBidi();
  // System access lets the harness open extension pages from chrome context (content
  // navigation to moz-extension:// is blocked).
  const service = new firefox.ServiceBuilder(which("geckodriver"))
    .addArguments("--allow-system-access")
    .setEnvironment({
      ...process.env,
      HOME: home,
      XDG_RUNTIME_DIR: runtimeDir,
      MOZ_HEADLESS: "1",
    });
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  await (driver as unknown as firefox.Driver).installAddon(join(extensionDir, "dist-e2e"), true);
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  const pageHandle = await driver.getWindowHandle();

  const sessions: FakeSession[] = [];

  const openExtensionTab = async (path: string): Promise<string> => {
    const before = await driver.getAllWindowHandles();
    const d = driver as unknown as firefox.Driver;
    d.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript(
        `gBrowser.selectedTab = gBrowser.addTab(arguments[0], {
           triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
        `${EXTENSION_ORIGIN}/${path}`,
      );
    } finally {
      d.setContext(firefox.Context.CONTENT);
    }
    let handle = "";
    await driver.wait(async () => {
      handle = (await driver.getAllWindowHandles()).find((x) => !before.includes(x)) ?? "";
      return handle !== "";
    }, 5000);
    await driver.switchTo().window(handle);
    await driver.wait(
      async () => (await driver.executeScript("return document.readyState")) === "complete",
      5000,
    );
    return handle;
  };

  const extCall = async <T>(script: string, ...args: unknown[]): Promise<T> => {
    const current = await driver.getWindowHandle();
    await openExtensionTab("popup.html?tab=-1");
    try {
      return (await driver.executeAsyncScript(script, ...args)) as T;
    } finally {
      await driver.close();
      await driver.switchTo().window(current);
    }
  };

  const h: Harness = {
    driver,
    baseUrl,
    runtimeDir,
    socketDir,
    sessions,
    pageHandle,
    async startSession(id, projectDir, startedAt) {
      const s = await startFakeSession({ dir: socketDir, id, projectDir, startedAt });
      sessions.push(s);
      return s;
    },
    open(fixture) {
      return h.openUrl(`${baseUrl}/${fixture}`);
    },
    async openUrl(url) {
      await driver.switchTo().window(pageHandle);
      await driver.get(url);
      await driver.wait(
        async () => (await driver.executeScript("return document.readyState")) === "complete",
        5000,
      );
      return extCall<number>(
        `const [url, done] = arguments;
         browser.tabs.query({}).then((tabs) => {
           const t = tabs.find((x) => x.url === url);
           done(t ? t.id : -1);
         });`,
        url,
      );
    },
    togglePicker(tabId) {
      return extCall(
        `const [tabId, done] = arguments;
         browser.runtime.sendMessage({ type: "toggle-picker", tabId }).then(done, (e) => done({ ok: false, message: String(e) }));`,
        tabId,
      );
    },
    async openPopup(tabId) {
      await openExtensionTab(`popup.html?tab=${tabId}`);
    },
    async setViewport(width, height = 800) {
      const bidi = await driver.getBidi();
      const context = await driver.getWindowHandle();
      await bidi.send({
        method: "browsingContext.setViewport",
        params: { context, viewport: { width, height } },
      });
    },
    async ui(selector) {
      const host = await driver.findElement(By.css("claude-pointer-ui"));
      const shadow = await host.getShadowRoot();
      return shadow.findElement(By.css(selector));
    },
    async uiAll(selector) {
      const hosts = await driver.findElements(By.css("claude-pointer-ui"));
      if (hosts.length === 0) return [];
      return (await hosts[0]!.getShadowRoot()).findElements(By.css(selector));
    },
    async waitForUi(selector, timeout = 5000) {
      let found: WebElement | undefined;
      await driver.wait(
        async () => {
          const all = await h.uiAll(selector);
          for (const el of all) {
            if (await el.isDisplayed()) {
              found = el;
              return true;
            }
          }
          return false;
        },
        timeout,
        `waiting for ${selector} in picker UI`,
      );
      return found!;
    },
    async chrome<T>(script: string, ...args: unknown[]) {
      const d = driver as unknown as firefox.Driver;
      d.setContext(firefox.Context.CHROME);
      try {
        return (await driver.executeScript(script, ...args)) as T;
      } finally {
        d.setContext(firefox.Context.CONTENT);
      }
    },
    async close() {
      await Promise.all(sessions.splice(0).map((s) => s.close()));
      await driver.quit();
      server.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
  return h;
}

export { By, until };
