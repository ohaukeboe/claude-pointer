// Finds the working directory of the process listening on a TCP port (research R3, Linux).

import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const LISTEN = "0A";

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h)
  );
}

/** Socket inodes in LISTEN state on `port` (any address), from /proc/net/tcp{,6}. */
export function listeningInodes(port: number, procRoot = "/proc"): Set<string> {
  const inodes = new Set<string>();
  for (const file of ["tcp", "tcp6"]) {
    let text = "";
    try {
      text = readFileSync(join(procRoot, "net", file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const local = cols[1];
      if (!local || cols[3] !== LISTEN) continue;
      const hexPort = local.slice(local.lastIndexOf(":") + 1);
      if (parseInt(hexPort, 16) === port && cols[9]) inodes.add(cols[9]);
    }
  }
  return inodes;
}

/** Working directories of processes holding one of the listening sockets for `port`. */
export function portOwnerDirs(port: number, procRoot = "/proc"): string[] {
  const inodes = listeningInodes(port, procRoot);
  if (inodes.size === 0) return [];
  const dirs = new Set<string>();
  for (const pid of readdirSync(procRoot).filter((d) => /^\d+$/.test(d))) {
    let fds: string[];
    try {
      fds = readdirSync(join(procRoot, pid, "fd"));
    } catch {
      continue; // other users' processes or races
    }
    const owns = fds.some((fd) => {
      try {
        const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(join(procRoot, pid, "fd", fd)));
        return m !== null && inodes.has(m[1]!);
      } catch {
        return false;
      }
    });
    if (!owns) continue;
    try {
      dirs.add(readlinkSync(join(procRoot, pid, "cwd")));
    } catch {
      // no access to cwd
    }
  }
  return [...dirs];
}
