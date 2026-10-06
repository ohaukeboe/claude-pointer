// claude-pointer: helper CLI (plan.md "helper/").

import { fileURLToPath } from "node:url";
import { runChannel } from "./channel/main";
import { debugList, debugSend } from "./debug";
import { install, runClaude } from "./install";
import { runNativeHost } from "./native-host/index";

const HELP = `Usage: claude-pointer <command>

Commands:
  install                 Register the Firefox native host and write the MCP config
  claude [args...]        Start Claude Code with the claude-pointer channel
  channel                 (internal) MCP channel server, started by Claude Code
  native-host             (internal) Firefox native messaging host
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
      await runChannel();
      return -1; // keep running
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
      console.log("Start a session with: claude-pointer claude");
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
