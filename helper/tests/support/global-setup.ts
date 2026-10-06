import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Contract tests run the real built CLI.
export default function setup(): void {
  execFileSync(process.execPath, ["build.mjs"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdio: "ignore",
  });
}
