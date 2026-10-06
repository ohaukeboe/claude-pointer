// Bundles each extension entry point to one unminified IIFE (MV3 scripts cannot use import).
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const e2e = process.argv.includes("--e2e");
// The e2e build differs only in an open shadow root, so WebDriver can reach the UI.
const outdir = e2e ? "dist-e2e" : "dist";
const watch = process.argv.includes("--watch");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync("popup.html", `${outdir}/popup.html`);
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
// e2e only: WebDriver cannot press the toolbar button, so no activeTab grant exists.
if (e2e) manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
cpSync("icons", `${outdir}/icons`, { recursive: true });

const options = {
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    "source-probe": "src/page-world/source-probe.ts",
    popup: "src/popup/index.ts",
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "firefox140",
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  loader: { ".css": "text" },
  define: { __CP_SHADOW_MODE__: e2e ? '"open"' : '"closed"' },
};

if (watch) await (await context(options)).watch();
else await build(options);
