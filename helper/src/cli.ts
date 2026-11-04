// claude-pointer: helper CLI (plan.md "helper/").

import { fileURLToPath } from "node:url";
import { runChannel } from "./channel/main";
import { debugList, debugSend } from "./debug";
import { install, runClaude } from "./install";
import { runNativeHost } from "./native-host/index";
import { runNotice } from "./notice";
import { runWait } from "./wait";

const HELP = `Usage: claude-pointer <command>

Commands:
  install                 Register the Firefox native host and write the MCP config
  claude [--no-channel] [args...]
                          Start Claude Code with claude-pointer; --no-channel for accounts
                          without channels (comments wait for /mcp__claude-pointer__comments)
  channel [--no-push]     (internal) MCP server, started by Claude Code
  native-host             (internal) Firefox native messaging host
  wait --session <id>     (internal) Wait for a comment; Claude runs it in the background
  notice                  (internal) UserPromptSubmit hook: mention waiting comments
  debug-list              List running claude-pointer sessions
  debug-send --text <t> [--session <id>]
                          Send a test comment to a session
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "channel":
      await runChannel(rest);
      return -1; // keep running
    case "wait":
      return runWait(rest);
    case "notice": {
      const code = await runNotice();
      process.stdin.destroy(); // a stdin Claude never closes must not keep the hook alive
      return code;
    }
    case "native-host":
      await runNativeHost();
      return 0;
    case "install": {
      const r = install({
        home: process.env.HOME ?? "",
        configHome: process.env.XDG_CONFIG_HOME,
        dataHome: process.env.XDG_DATA_HOME,
        execPath: process.execPath,
        cliPath: fileURLToPath(import.meta.url),
      });
      console.log(`Native host manifest: ${r.manifestPath}`);
      console.log(`Native host wrapper:  ${r.wrapperPath}`);
      console.log(`MCP config:           ${r.mcpConfigPath}`);
      console.log(`MCP config (no chan.): ${r.noChannelConfigPath}`);
      console.log(`Claude settings:      ${r.settingsPath}`);
      console.log("Start a session with: claude-pointer claude [--no-channel]");
      return 0;
    }
    case "claude":
      return runClaude(rest);
    case "debug-list":
      return debugList();
    case "debug-send": {
      const text = flag(rest, "--text");
      if (!text) {
        process.stderr.write("debug-send: --text is required\n");
        return 2;
      }
      return debugSend(text, flag(rest, "--session"));
    }
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(HELP);
      return cmd === undefined ? 2 : 0;
    default:
      process.stderr.write(`claude-pointer: unknown command ${cmd}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`claude-pointer: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
