// `claude-pointer channel`: started by Claude Code as a stdio MCP server.

import { basename } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Session } from "../../../shared/types";
import { sessionIdFor, socketDir } from "../registry/index";
import { startChannel } from "./index";

export function currentSession(procRoot = "/proc"): Session {
  // The channel server is a direct child of the `claude` process (verified by the T012 spike).
  const projectDir = process.cwd();
  return {
    id: sessionIdFor(process.ppid, procRoot),
    projectDir,
    projectName: basename(projectDir),
    startedAt: new Date().toISOString(),
  };
}

export async function runChannel(): Promise<void> {
  // Install shutdown handlers before the socket exists; a signal during start-up waits for
  // start-up to finish and then removes the socket.
  const starting = startChannel({
    transport: new StdioServerTransport(),
    dir: socketDir(),
    session: currentSession(),
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await (await starting).close();
    } finally {
      process.exit(0);
    }
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  await starting;
}
