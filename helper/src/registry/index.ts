// Session registry: one Unix socket per session in a private directory (research R2).

import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export function socketDir(
  env: NodeJS.ProcessEnv = process.env,
  uid: number = process.getuid?.() ?? 0,
): string {
  const runtime = env.XDG_RUNTIME_DIR;
  return runtime ? join(runtime, "claude-pointer") : `/tmp/claude-pointer-${uid}`;
}

/** Create the socket dir (mode 0700) or verify an existing one is private to this user. */
export function ensureSocketDir(dir: string, uid: number = process.getuid?.() ?? 0): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  checkSocketDir(dir, uid);
}

export function checkSocketDir(dir: string, uid: number = process.getuid?.() ?? 0): void {
  const st = statSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (st.uid !== uid) throw new Error(`${dir} is owned by uid ${st.uid}, not ${uid}`);
  if ((st.mode & 0o077) !== 0) {
    throw new Error(
      `${dir} has group/world permissions (${(st.mode & 0o777).toString(8)}); expected 700`,
    );
  }
}

/** Process start time in clock ticks (field 22 of /proc/<pid>/stat). */
export function readStartTicks(pid: number, procRoot = "/proc"): string {
  const stat = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
  // comm (field 2) may contain spaces and ')', so split after the last ')'.
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = rest[22 - 3];
  if (!ticks) throw new Error(`cannot parse start time for pid ${pid}`);
  return ticks;
}

/** `<pid>-<startTicks>`: unique even if the PID is reused. */
export function sessionIdFor(pid: number, procRoot = "/proc"): string {
  return `${pid}-${readStartTicks(pid, procRoot)}`;
}

const SESSION_ID = /^[0-9]+-[0-9]+$/;

export function socketPathFor(dir: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId))
    throw new Error(`invalid session id ${JSON.stringify(sessionId)}`);
  return join(dir, `${sessionId}.sock`);
}

export function isSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

export function listSockets(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sock"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function removeStale(path: string): void {
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
