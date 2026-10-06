// Bundles the helper CLI to one executable ESM file for Node 24.
import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
chmodSync("dist/cli.js", 0o755);
