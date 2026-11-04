# Quickstart: Delivery Without Channels

Validation guide for [spec.md](./spec.md). Contracts: [contracts/](./contracts/).

## Prerequisites

- Feature 001 set up: `npm ci && npm run build`, extension loaded in Firefox.
- Run `node helper/dist/cli.js install` again: it now also writes `mcp-no-channel.json` and
  `settings.json` in `~/.config/claude-pointer/`.

## S1. Spike: background wake (run before implementing User Story 2)

On the work account, in a scratch directory:

1. Start `claude`. Ask it: "Run `sleep 20; echo done` with run_in_background, then stop."
2. Wait without typing. Expected: within 25 s Claude starts a new turn and mentions `done`.
3. Ask it to run `ls $XDG_RUNTIME_DIR/claude-pointer` in the Bash tool. Expected: the
   directory is listed (no sandbox error).

If step 2 fails, User Story 2 is blocked: record the Claude Code version and stop.

## S2. Spike: settings file

1. `claude --settings ~/.config/claude-pointer/settings.json` on the work account.
2. Run `/hooks`. Expected: the `UserPromptSubmit` hook from the file is listed.

## V1. Pick up on request (User Story 1)

1. `node helper/dist/cli.js claude --no-channel` in a test project.
2. Send a comment from a page. Expected: the popup shows the entry as **Waiting**.
3. `node helper/dist/cli.js debug-list`. Expected: the session shows `no-channel`, `off`.
4. In Claude, type `/mcp__claude-pointer__comments`. Expected: Claude gets the comment with
   its `page-data` block and starts working. Within 2 s the popup shows **Picked up**.
5. Run the command again. Expected: "No Claude Pointer comments are waiting."

## V2. Watch (User Story 2)

1. In the V1 session, type `/mcp__claude-pointer__watch`. Expected: Claude starts the
   `wait` command in the background; `debug-list` shows `waiting`.
2. Send a comment and do not touch the terminal. Expected: Claude starts within 5 s, works on
   it, then starts `wait` again.
3. Ask Claude "stop watching". Expected: `debug-list` shows `off`.

Timeouts are checked by unit tests with a fake clock, not by hand.

## V3. Notice (User Story 3)

1. Send a comment to a no-channel session without watching.
2. Type "what time is it?". Expected: Claude mentions one waiting comment batch and its page,
   without quoting the comment.

## V4. Mixed modes and fallback (User Story 4)

1. Start one session with `claude-pointer claude` and one with `--no-channel`.
2. The popup's session chooser shows each session's mode.
3. On an account without channels, start a default (channel) session, send a comment, then
   type `/mcp__claude-pointer__comments`. Expected: the comment arrives, marked as already
   delivered by the channel.

## V5. Session ends before pick-up

1. Send a comment to a no-channel session, then quit Claude.
2. Open the popup. Expected: entry shows **Not picked up** with a **Resend** button; Resend
   puts the comment back as a pending marker on its page.

## Automated

```bash
npm run check
```

Covers contracts (socket, native messaging, MCP tools via in-memory transport, CLI `wait` and
`notice`) and the e2e flow V1 + V5 with a fake no-channel session.
