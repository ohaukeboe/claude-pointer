#!/usr/bin/env node
// T012 spike: minimal stdio MCP channel server, no SDK. Verifies that a
// notifications/claude/channel event starts a turn in an idle session.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const log = (m) => {
  process.stderr.write(`[spike] ${m}\n`);
  if (process.env.SPIKE_LOG) appendFileSync(process.env.SPIKE_LOG, `${m}\n`);
};
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

log(`cwd=${process.cwd()} ppid=${process.ppid} pid=${process.pid}`);
log(
  `env CLAUDE*=${Object.keys(process.env)
    .filter((k) => k.startsWith("CLAUDE"))
    .join(",")}`,
);

createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  log(`recv ${msg.method ?? "response"}`);
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { experimental: { "claude/channel": {} } },
        serverInfo: { name: "claude-pointer", version: "0.0.0-spike" },
        instructions: "Spike channel: messages are test prompts from the user.",
      },
    });
    setTimeout(
      () => {
        log("sending channel notification");
        send({
          jsonrpc: "2.0",
          method: "notifications/claude/channel",
          params: {
            content: "say hello (reply with exactly: SPIKE-OK)",
            meta: { batch_id: "spike" },
          },
        });
      },
      Number(process.env.SPIKE_DELAY_MS ?? 8000),
    );
  } else if (msg.id !== undefined && msg.method) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
process.stdin.on("end", () => {
  log("stdin closed");
  process.exit(0);
});
