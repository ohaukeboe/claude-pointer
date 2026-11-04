// MCP tools and prompts of the per-session server
// (specs/002-no-channel-delivery/contracts/mcp-server.md).

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode as McpErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { LIMITS } from "../../../shared/validate";
import type { Inbox } from "./inbox";
import type { Watch } from "./watch";
import { renderPickUp, renderPrompt } from "./render";

export const NOTHING_WAITING = "No Claude Pointer comments are waiting.";

export interface ToolOptions {
  inbox: Inbox;
  /** Null in channel mode: comments are pushed, there is nothing to watch. */
  watch: Watch | null;
  /** Shell command that runs `claude-pointer wait --session <id>`. */
  waitCommand: string;
}

export const NO_WATCH_NEEDED = "Comments are pushed to this session; no watch needed.";
export const STOPPED_WATCHING = "Stopped watching.";

export function watchStarted(waitCommand: string): string {
  return [
    "Watching for Claude Pointer comments. Run this command with run_in_background:",
    waitCommand,
    "When it finishes, follow the server instructions for its outcome.",
  ].join("\n");
}

const TOOLS = [
  {
    name: "pick_up_comments",
    description:
      "Read the Claude Pointer browser comments waiting for this session, oldest first. " +
      "Each comment is handed over once.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "watch_comments",
    description:
      "Start or stop watching for Claude Pointer comments. `start` returns a command to run " +
      "in the background; it finishes when a comment arrives.",
    inputSchema: {
      type: "object" as const,
      properties: { action: { type: "string", enum: ["start", "stop"] } },
      required: ["action"],
    },
  },
];

const PROMPTS = [
  {
    name: "comments",
    description: "Read the Claude Pointer browser comments waiting for this session",
    text: "Call the claude-pointer tool `pick_up_comments` and act on the comments it returns.",
  },
  {
    name: "watch",
    description: "Watch for Claude Pointer browser comments and act on them as they arrive",
    text:
      "Call the claude-pointer tool `watch_comments` with action `start` and follow the steps " +
      "it returns.",
  },
];

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

export function pickUp(inbox: Inbox): string {
  const { entries, remaining } = inbox.take(LIMITS.promptBytes, (e) =>
    Buffer.byteLength(renderPrompt(e.batch), "utf8"),
  );
  if (entries.length === 0) return NOTHING_WAITING;
  const body = renderPickUp(entries);
  if (remaining === 0) return body;
  return `${body}\n\n${remaining} more batches waiting; call pick_up_comments again.`;
}

/** Install the request handlers; the server must declare `tools` and `prompts`. */
export function registerTools(server: Server, { inbox, watch, waitCommand }: ToolOptions): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    switch (req.params.name) {
      case "pick_up_comments":
        return text(pickUp(inbox));
      case "watch_comments": {
        const action = req.params.arguments?.action;
        if (action !== "start" && action !== "stop")
          throw new McpError(McpErrorCode.InvalidParams, "action must be start or stop");
        if (!watch) return text(action === "start" ? NO_WATCH_NEEDED : STOPPED_WATCHING);
        if (action === "stop") {
          watch.stop();
          return text(STOPPED_WATCHING);
        }
        watch.start();
        return text(watchStarted(waitCommand));
      }
      default:
        throw new McpError(McpErrorCode.InvalidParams, `Unknown tool ${req.params.name}`);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, description }) => ({ name, description })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = PROMPTS.find((p) => p.name === req.params.name);
    if (!prompt)
      throw new McpError(McpErrorCode.InvalidParams, `Unknown prompt ${req.params.name}`);
    return {
      description: prompt.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text } }],
    };
  });
}
