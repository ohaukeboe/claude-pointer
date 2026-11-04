// `claude-pointer wait --session <id>`: parks on the session socket until the watch answers
// (specs/002-no-channel-delivery/contracts/cli.md, research R12). Prints no comment text:
// comments reach Claude only through `pick_up_comments`.

import type { WaitResponse } from "../../shared/types";
import { isSessionId, socketDir, socketPathFor } from "./registry/index";
import { request } from "./registry/socket-client";

export async function runWait(
  args: string[],
  out: (line: string) => void = (l) => process.stdout.write(l + "\n"),
  dir: string = socketDir(),
): Promise<number> {
  const id = args[0] === "--session" && args.length === 2 ? args[1]! : null;
  if (!id || !isSessionId(id)) {
    process.stderr.write("Usage: claude-pointer wait --session <pid>-<ticks>\n");
    return 2;
  }
  const res = (await request(socketPathFor(dir, id), { v: 1, type: "wait" }, null)) as
    WaitResponse | { ok: false; error: { code: string } };
  if (!res.ok) {
    out(`claude-pointer: ${res.error.code}`);
    return 1;
  }
  out(
    res.outcome === "comments"
      ? `claude-pointer: comments (${res.waiting} waiting)`
      : `claude-pointer: ${res.outcome}`,
  );
  return 0;
}
