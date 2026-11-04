// `claude-pointer notice`: UserPromptSubmit hook that tells Claude comments are waiting
// (specs/002-no-channel-delivery/contracts/cli.md, research R14). Prints only the count and
// page addresses, never comment text, and always exits 0 so it can never block a prompt.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { PeekResponse } from "../../shared/types";
import { oneLine } from "./channel/render";
import { discoverSessions } from "./native-host/index";
import { listSockets, sessionIdFor, socketDir, socketPathFor } from "./registry/index";
import { request } from "./registry/socket-client";

const MAX_LEVELS = 8;
const TIMEOUT_MS = 1000;

export interface NoticeOptions {
  stdin?: Readable;
  procRoot?: string;
  dir?: string;
  pid?: number;
  timeoutMs?: number;
  out?: (line: string) => void;
}

async function readAll(stream: Readable): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += String(chunk);
  return text;
}

function parentOf(pid: number, procRoot: string): number | null {
  try {
    const stat = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

/** The session whose `claude` process is an ancestor of `pid`, if any. */
function sessionFromAncestors(pid: number, procRoot: string, dir: string): string | null {
  const sockets = new Set(listSockets(dir));
  let current: number | null = pid;
  for (let level = 0; level < MAX_LEVELS; level++) {
    current = current === null ? null : parentOf(current, procRoot);
    if (current === null) return null;
    try {
      const path = socketPathFor(dir, sessionIdFor(current, procRoot));
      if (sockets.has(path)) return path;
    } catch {
      return null;
    }
  }
  return null;
}

async function sessionFromCwd(cwd: unknown, dir: string): Promise<string | null> {
  if (typeof cwd !== "string") return null;
  const matches = (await discoverSessions(dir)).filter((s) => s.projectDir === cwd);
  return matches.length === 1 ? socketPathFor(dir, matches[0]!.id) : null;
}

export function noticeLine(peek: { waiting: number; pages: string[] }): string {
  const count =
    peek.waiting === 1
      ? "1 browser comment batch is"
      : `${peek.waiting} browser comment batches are`;
  const pages = peek.pages.map(oneLine).join(", ");
  return (
    `Claude Pointer: ${count} waiting (from ${pages}). ` +
    "Tell the user and offer to read them with pick_up_comments."
  );
}

async function notice(o: Required<Omit<NoticeOptions, "timeoutMs">>): Promise<string | null> {
  let cwd: unknown;
  try {
    cwd = (JSON.parse(await readAll(o.stdin)) as { cwd?: unknown }).cwd;
  } catch {
    cwd = undefined;
  }
  const path = sessionFromAncestors(o.pid, o.procRoot, o.dir) ?? (await sessionFromCwd(cwd, o.dir));
  if (!path) return null;
  const res = (await request(path, { v: 1, type: "peek" })) as PeekResponse | { ok: false };
  if (!res.ok || res.waiting <= 0) return null;
  return noticeLine(res);
}

export async function runNotice({
  stdin = process.stdin,
  procRoot = "/proc",
  dir = socketDir(),
  pid = process.pid,
  timeoutMs = TIMEOUT_MS,
  out = (line) => process.stdout.write(line + "\n"),
}: NoticeOptions = {}): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const line = await Promise.race([
      notice({ stdin, procRoot, dir, pid, out }).catch(() => null),
      timeout,
    ]);
    if (line) out(line);
  } finally {
    clearTimeout(timer);
  }
  return 0;
}
