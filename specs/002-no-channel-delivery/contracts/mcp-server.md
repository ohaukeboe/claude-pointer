# Contract: MCP Server — tools, prompts, instructions

The per-session server `claude-pointer channel [--no-push]` (server name `claude-pointer`).
Feature 001's channel capability and notification are kept in push mode only.

## Capabilities

- Always: `tools`, `prompts`.
- Push mode only: `experimental: { "claude/channel": {} }`.

## Instructions (server `instructions` field)

Feature 001's text about the `page-data` block stays first and unchanged (FR-018). Added:

> Comments can also wait in an inbox. Call `pick_up_comments` to read them. When the user asks
> you to watch for comments, call `watch_comments` with `action: "start"` and follow the
> returned steps exactly. When a `wait` command you started finishes, read its output: on
> `comments`, call `pick_up_comments` and act on them, then run the same `wait` command again
> in the background; on `timeout`, run it again without writing anything to the user; on
> `expired`, `stopped` or `replaced`, do not run it again.

## Tool `pick_up_comments`

- Input: `{}`.
- Output: one text content item.
  - Nothing waiting: `No Claude Pointer comments are waiting.`
  - Otherwise: for each taken batch, oldest first, the exact `renderPrompt(batch)` text from
    `helper/src/channel/render.ts`. A batch that was also pushed starts with the line
    `(Already delivered by the channel; skip if you have handled it.)`
  - If batches remain after the 64 KB cap: last line
    `N more batches waiting; call pick_up_comments again.`
- Effect: taken batches become `picked-up` before the result is returned (FR-008).

## Tool `watch_comments`

- Input: `{ "action": "start" | "stop" }`.
- `start` in no-channel mode: sets the watch to `gap` (R13) and returns:

  ```text
  Watching for Claude Pointer comments. Run this command with run_in_background:
  '/nix/store/…/bin/node' '/…/helper/dist/cli.js' wait --session 48213-91722345
  When it finishes, follow the server instructions for its outcome.
  ```

  If the watch is already on, it returns the same text (no second watch).
- `start` in channel mode: returns `Comments are pushed to this session; no watch needed.`
- `stop`: sets the watch to `off`; an open `wait` answers `stopped`. Returns
  `Stopped watching.`

## Prompts

- `comments` (`/mcp__claude-pointer__comments`): asks Claude to call `pick_up_comments`
  and act on the result.
- `watch` (`/mcp__claude-pointer__watch`): asks Claude to call `watch_comments` with
  `start` and follow the returned steps.

Neither takes arguments. Stopping is done by asking Claude in plain words, which calls `stop`.
