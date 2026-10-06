import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeFrame, readFrame } from "../../src/native-host/framing";

export const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

export function spawnCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string): ChildProcess {
  return spawn(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Run the native host once with a framed request, like Firefox does. */
export async function nativeCall(request: unknown, env: NodeJS.ProcessEnv): Promise<unknown> {
  const child = spawnCli(["native-host", "/manifest.json", "claude-pointer@ohaukeboe"], env);
  const response = readFrame(child.stdout!);
  child.stdin!.end(encodeFrame(request));
  const [res] = await Promise.all([response, new Promise((r) => child.on("exit", r))]);
  return res;
}
