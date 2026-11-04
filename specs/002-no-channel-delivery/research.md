# Research: Delivery Without Channels

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Numbering continues from feature 001 (R1–R10), so R11 onwards.

## R11. How Claude reads waiting comments

- **Decision**: The existing per-session MCP server (`claude-pointer channel`) gains an
  **inbox** and two MCP tools, `pick_up_comments` and `watch_comments`, plus two MCP prompts,
  `comments` and `watch`. Claude Code shows MCP prompts as slash commands:
  `/mcp__claude-pointer__comments` and `/mcp__claude-pointer__watch`. Each prompt only tells
  Claude to call the matching tool, so one code path renders and marks comments.
- **Rationale**: The MCP server already runs once per session and already owns the session
  socket, so it is the natural holder of the inbox (FR-005: memory only, same process).
  A tool lets Claude pick up on its own (FR-009); a prompt gives the user one short command
  (FR-006). MCP tools and prompts are core MCP, not a research preview, so an account without
  channels still has them. Prompts ship with the server: no second install step.
- **Alternatives considered**:
  - A skill in `~/.claude/skills/` (the user's first idea): works, but is a second artifact to
    install and keep in sync with the server, and the tool is still needed for the data.
  - A prompt that embeds the comments directly: saves one tool call, but splits rendering and
    the at-most-once marking across two paths.
  - Reading a file the browser writes: needs shared storage, which FR-005 forbids.

## R12. How a watching Claude is woken

- **Decision**: `watch_comments {action:"start"}` returns an exact shell command:
  `<node> <cli.js> wait --session <sessionId>`. Claude runs it as a **background** Bash
  command. `wait` opens the session socket, sends `wait`, and blocks until the server answers.
  When the command exits, Claude Code re-invokes the idle session with the command's output.
  Claude then calls `pick_up_comments`, acts, and runs `wait` again.
- **Rationale**: Claude Code re-invokes a session when a background command it started
  finishes. That is the only documented way, apart from channels, for something outside the
  terminal to start a turn in an idle session. It needs only the Bash tool.
- **Why the session id is passed in**: inside Claude Code's Bash sandbox the command runs in
  its own PID namespace (`/proc` shows ~9 processes, PID 1 is `bwrap`), so it cannot walk up
  to the `claude` process to find its session. Probe on 2026-11-04: from inside the sandbox,
  `$XDG_RUNTIME_DIR/claude-pointer/` is visible and `connect()` to a session socket with an
  `info` request succeeds. The MCP server is not sandboxed and knows its own id.
- **Wait timeout**: the server answers `timeout` after **45 minutes**. That stays under the
  1-hour foreground and 4-hour background runtime caps on the user's machine, and costs about
  ten short wake-ups over the 8-hour idle limit.
- **To verify first (spike S1)**: on the work account and its Claude Code version, (a) a
  background command exiting wakes an idle session with no user input; (b) the wake reaches
  Claude within 5 s (SC-002); (c) the Bash sandbox there can reach the socket directory.
- **S1 result (2026-11-04)**: the user confirmed (a) and (c) work on the work account. The
  Claude Code version and the wake time were not recorded; T038 measures the wake time (b).
- **Alternatives considered**:
  - A blocking MCP tool call that returns when a comment arrives: the turn never ends, so the
    session is not idle and the user cannot work with Claude meanwhile.
  - The `Monitor` tool (streams a background command's output): newer and its wake semantics
    are less documented; evaluate in S1 as a possible replacement, not a baseline.
  - `/loop` with a fixed interval: wakes Claude every interval even when nothing is waiting,
    and misses the 5 s target.
  - Typing into the terminal (`tmux send-keys`, `xdotool`): rejected in the spec.

## R13. Watch life cycle and "watching" state

- **Decision**: The server keeps one watch per session with these states:
  `off`, `waiting` (a `wait` connection is open), `busy` (last `wait` returned `comments`;
  Claude is working), `gap` (last `wait` returned `timeout`; restart expected).
  - `gap` for more than 120 s with no new `wait` → `off` (Claude did not restart).
  - 8 hours since watch start or since the last comment arrived → the open `wait` returns
    `expired` and the state becomes `off` (FR-013).
  - `watch_comments {action:"stop"}` → open `wait` returns `stopped`, state `off`.
  - A second `wait` while one is open: the older one returns `replaced` (only one watch,
    spec edge case).
  - `busy` has no timeout: the server cannot tell long work from a lost watch. Shown as
    "watching (busy)".
- **Rationale**: Only the server sees `wait` connections, so it is the one place that can
  report watching accurately (FR-004, FR-013). States are derived from connection events, not
  from what Claude says.

## R14. Next-turn notice

- **Decision**: A `UserPromptSubmit` hook runs `claude-pointer notice`. It finds its session,
  asks the socket for `peek`, and prints one line of additional context:
  `Claude Pointer: 2 browser comments are waiting (from http://localhost:5173/admin). Tell the
  user and offer to read them with pick_up_comments.` Nothing is printed when the count is 0.
  The hook always exits 0, also on errors, so it can never block a prompt.
- **Session lookup**: hooks are run by Claude Code itself, outside the Bash sandbox, so the
  hook walks its parent PIDs (max 8 levels) and picks the first `<pid>-<startTicks>` that has a
  socket. Fallback when none matches: the single session whose `projectDir` equals the hook
  input's `cwd`; if zero or several match, print nothing.
- **Installation**: `claude-pointer install` writes `~/.config/claude-pointer/settings.json`
  with the hook and with `permissions.allow` entries for the two tools and the `wait` command.
  The launcher passes it with `claude --settings <file>`. Nothing is written to the user's own
  Claude Code settings.
- **To verify (spike S2)**: `--settings` hooks and permissions apply on the work account, and
  are not blocked by managed settings there.
- **S2 result (2026-11-04)**: the user confirmed that `--settings` hooks and permissions apply
  on the work account.
- **Alternatives considered**: putting the hook in `~/.claude/settings.json` (touches the
  user's global config for all sessions); a `Stop` hook that blocks stopping while comments
  wait (acts on comments without being asked, which the spec rejects for the notice).

## R15. Delivery mode selection

- **Decision**: `install` writes two MCP configs that start the same server:
  `mcp.json` (`channel`, push on) and `mcp-no-channel.json` (`channel --no-push`).
  `claude-pointer claude` uses `mcp.json` and the development-channels flag (default, as
  clarified). `claude-pointer claude --no-channel` uses `mcp-no-channel.json` without the flag.
  The server reports its mode in `info`.
- **Rationale**: The server cannot tell whether the client accepted the channel capability, so
  the mode must be explicit. Two config files keep the server name `claude-pointer` the same in
  both modes, so tool and prompt names do not change.
- **Alternatives considered**: an environment variable in the launcher (relies on Claude Code
  passing its environment to stdio servers); auto-detecting channels (rejected in the spec).

## R16. Inbox in both modes and at-most-once

- **Decision**: Every `deliver` puts the batch in the inbox. In push mode it is also pushed
  and marked `pushed`. `pick_up_comments` takes waiting batches oldest first, renders each with
  the existing `renderPrompt` (so the context is byte-identical to a channel push, SC-005),
  marks them `picked-up` before returning, and labels pushed ones "already delivered by the
  channel; skip if already handled".
- **At most once**: Node runs the server on one thread, and the take-and-mark step has no
  `await` in it, so two concurrent pick-ups cannot get the same batch (FR-008).
- **Size**: one pick-up returns at most 64 KB of rendered text (the existing per-batch limit,
  about 16 k tokens, under Claude Code's default MCP output limit of 25 k tokens). It always
  returns at least one batch. The rest stay waiting and the result ends with
  `N more batches waiting; call pick_up_comments again.`
- **Limits**: at most 50 batches waiting and not pushed; one more → `inbox-full` error to the
  extension (comment kept, FR-016). Pushed batches that were never picked up: at most 50, the
  oldest is dropped (clarification Q5 gap). Picked-up records keep only id and time, last 200,
  for status queries.
- **Idempotency**: a `deliver` with a known batch id returns the original answer and does not
  add the batch again; this replaces feature 001's 10-minute map.

## R17. Status in the extension

- **Decision**: New native request `batch-status {sessionId, batchIds}` and socket request
  `status {batchIds}`. The popup polls once per second while open, only for history entries in
  state `waiting`. A `session-gone` answer turns all `waiting` entries of that session into
  `not-picked-up`. History entries keep their `comments` until they are picked up, so a
  `not-picked-up` entry can be resent (FR-016): **Resend** puts the comments back into the
  page's pending list.
- **Rationale**: Native messaging is one request per host start (feature 001), so polling is
  the simplest fit; it runs only while the popup is open and only for waiting entries.
- **Alternatives considered**: `connectNative` with a long-lived host that streams status: a
  second host mode and a lifetime to manage, for a popup that is rarely open.
