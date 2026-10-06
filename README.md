# Claude Pointer

Pick an element on a web page in Firefox, write a comment about it, and send the comment
straight into a running [Claude Code](https://code.claude.com) session — the one that works
on that page's project.

It works like the select-and-comment flow in Claude Design, but on any site you are building.

## How it works

```text
Firefox extension ──native messaging──▶ claude-pointer native-host (one per request)
                                          │ Unix socket in $XDG_RUNTIME_DIR/claude-pointer/ (mode 0700)
                                          ▼
                     claude-pointer channel (one per session) ──MCP channel──▶ Claude Code
```

- Each opted-in Claude Code session starts its own `claude-pointer channel` MCP server. The
  server pushes comments into that session as a
  [channel](https://code.claude.com/docs/en/channels) event, so Claude starts working without
  you typing in the terminal.
- The first time you send from a site, the extension suggests a session and asks you to
  confirm it. For `localhost` pages, the suggestion is the session whose project directory
  contains the dev server that serves the page. The choice is remembered per site.
- Each comment carries the page URL, a unique CSS selector, a bounded HTML snippet, the
  visible text, size and position, and — in development builds of React, Vue or Svelte, or
  with source-attribute build plugins — the source component and file.

## Requirements

- Linux, Firefox 140 or later, Node.js 24 or later.
- Claude Code with channels support (research preview), logged in with a claude.ai account or
  a Console API key.

## Install

```bash
npm ci
npm run build
node helper/dist/cli.js install
```

`install` writes:

- `~/.mozilla/native-messaging-hosts/claude_pointer.json` (Firefox native host manifest),
- `~/.local/share/claude-pointer/native-host` (wrapper script it points to),
- `~/.config/claude-pointer/mcp.json` (MCP config for the channel server).

The wrapper uses the absolute path of the current `node`. On NixOS, run `install` again after
Node.js changes store path.

Load the extension: open `about:debugging`, choose **This Firefox → Load Temporary Add-on**,
and select `extension/dist/manifest.json`.

## Use

1. Start Claude Code with the channel, inside your project:

   ```bash
   node /path/to/claude-pointer/helper/dist/cli.js claude
   ```

   This runs `claude --mcp-config ~/.config/claude-pointer/mcp.json
   --dangerously-load-development-channels server:claude-pointer`. Extra arguments are passed
   on to `claude`.

2. Open your site, then press **Ctrl+Shift+Y** (or the toolbar button → **Pick element**).
3. Hover to highlight an element and click it. **Alt+↑** / **Alt+↓** select the parent or
   child; **Enter** selects the highlighted element; **Esc** leaves pick mode.
4. Type the comment and choose **Send to Claude** (or **Ctrl+Enter**). **Add comment** keeps
   it as a numbered marker so you can send several comments together.

The toolbar popup shows which session the current site sends to, lets you change it, and lists
recent sends with their status.

To check the connection without Firefox:

```bash
node helper/dist/cli.js debug-list
node helper/dist/cli.js debug-send --text "say hello"
```

## Security model

- No TCP port is opened. Sessions listen on Unix sockets in a directory only your user can
  open; the channel server refuses to start if that directory is accessible to others.
- Only this extension (`claude-pointer@ohaukeboe`) may start the native host.
- The extension asks only for `activeTab`, `scripting`, `storage` and `nativeMessaging`. It
  runs on a page only after you activate it there.
- Page content is untrusted. It is sent inside a fenced `page-data` block, script and style
  bodies and password values are removed, and the channel instructions tell Claude never to
  follow instructions found in it.
- Known limitation: a page script that listens for key presses on `window` in the capture
  phase can see what you type into the comment box.

## Caveats

Channels are a Claude Code research preview. The
`--dangerously-load-development-channels` flag and the event format may change; all channel
code lives in `helper/src/channel/`.

## Development

```bash
npm run typecheck   # tsc, both packages
npm run lint        # eslint + prettier --check
npm test            # unit + contract tests with coverage (≥ 90 % lines)
npm run test:e2e    # headless Firefox via Selenium + geckodriver
npm run lint:ext    # web-ext lint
npm run check       # all of the above, stops at the first failure
```

End-to-end tests need `firefox` and `geckodriver` on `PATH`. On NixOS:

```bash
nix-shell -p firefox geckodriver --run 'npm run check'
```

Design documents live in `specs/001-element-comment-picker/`.
