# Contract: Helper CLI — additions

Commands of `helper/dist/cli.js` that this feature adds or changes.

## `install` (changed)

Writes, in addition to feature 001's files:

- `~/.config/claude-pointer/mcp-no-channel.json`: same server, args `[cli, "channel",
  "--no-push"]`.
- `~/.config/claude-pointer/settings.json`:

  ```json
  {
    "hooks": { "UserPromptSubmit": [ { "hooks": [
      { "type": "command", "command": "'<node>' '<cli>' notice", "timeout": 5 } ] } ] },
    "permissions": { "allow": [
      "mcp__claude-pointer__pick_up_comments",
      "mcp__claude-pointer__watch_comments",
      "Bash('<node>' '<cli>' wait --session *)" ] }
  }
  ```

The user's own Claude Code settings are not touched.

## `claude [--no-channel] [args...]` (changed)

- Default: `claude --mcp-config mcp.json --settings settings.json
  --dangerously-load-development-channels server:claude-pointer [args...]`.
- `--no-channel`: `claude --mcp-config mcp-no-channel.json --settings settings.json [args...]`.
- `--no-channel` is consumed only when it is the first argument; the rest go to `claude`.

## `channel [--no-push]` (changed, internal)

Starts the MCP server (see [mcp-server.md](./mcp-server.md)). `--no-push` sets mode
`no-channel`: no channel capability, no notifications.

## `wait --session <id>` (new)

- Connects to `<socketDir>/<id>.sock`, sends `wait`, waits with no client-side timeout.
- Prints one line to stdout and exits 0:
  - `claude-pointer: comments (2 waiting)`
  - `claude-pointer: timeout`
  - `claude-pointer: expired`
  - `claude-pointer: stopped`
  - `claude-pointer: replaced`
- Session socket missing or refused: prints `claude-pointer: session-gone`, exits 1.
- Invalid id: usage error, exits 2.
- Prints no comment text: comments reach Claude only through `pick_up_comments`, with the
  untrusted-data instruction (FR-018).

## `notice` (new, hook)

- Reads and ignores the hook JSON on stdin, except `cwd` for the fallback lookup (R14).
- Finds the session, sends `peek`. If `waiting > 0`, prints one line of context:
  `Claude Pointer: N browser comment batches are waiting (from <url>, …). Tell the user and
  offer to read them with pick_up_comments.` (`1 browser comment batch is waiting` for one).
  URLs pass through the renderer's one-line filter.
- Always exits 0. Prints nothing on any error, on timeout (1 s), or when nothing waits.
