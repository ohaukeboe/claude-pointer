# Research: Element Comment Picker

**Feature**: [spec.md](./spec.md) | **Date**: 2026-10-06

Each section resolves one unknown from the plan's Technical Context.

## R1. Delivering a prompt into a running Claude Code session

**Decision**: Use **Claude Code channels**. Each opted-in session spawns a `claude-pointer
channel` MCP server over stdio. The server declares the `experimental['claude/channel']`
capability and pushes each comment batch with a `notifications/claude/channel` notification.
The session is started with
`claude --dangerously-load-development-channels server:claude-pointer`, because a custom channel
is not on the official allowlist.

**Rationale**:
- Channels are the only documented way to start a new turn in a live interactive session
  without the user typing (FR-014). Events wake idle sessions and queue during busy ones.
- The channel server is a child of exactly one session. Session identity comes for free:
  one server, one session. That is the core of "connect to the correct session" (FR-013).
- `params.meta` becomes tag attributes, so the prompt carries `url`, `count` and similar.

**Alternatives considered**:
- IDE integration (`~/.claude/ide/*.lock`, WebSocket MCP, `at_mentioned`): adds context, but
  does not start a turn. Rejected.
- `claude -p --resume <id>`: runs a separate non-interactive turn, not in the live session.
  Rejected.
- Remote Control / Agent SDK: needs user interaction or a different host app. Rejected.
- Typing into the terminal (tmux `send-keys`, PTY injection): fragile and terminal-specific.
  Rejected.

**Risks** (verify in the first implementation task, a spike):
- Channels are a research preview; the flag and payload shape may change. Keep all channel
  code in one module (`helper/src/channel/`) so a change touches one place.
- `--dangerously-load-development-channels` is hidden from `claude --help` in 2.1.280; the
  spike confirms it works with a server from `--mcp-config`.
- The docs do not say how a channel server learns its session's identity. Plan: use
  `process.cwd()` (the session's project directory) and `process.ppid` (the `claude`
  process). The spike confirms both.

## R2. Extension ↔ helper transport

**Decision**: **Firefox native messaging** to a one-shot `claude-pointer native-host`
process. That process talks to channel servers over **Unix domain sockets** in
`$XDG_RUNTIME_DIR/claude-pointer/` (directory mode `0700`).

```text
extension background ──native messaging──▶ native-host (one per request)
                                             │  lists *.sock, connects
                                             ▼
                        channel server (one per session) ──stdio MCP──▶ claude session
```

**Rationale**:
- Security without secrets: only the user's own processes can open a socket in a `0700`
  directory. No TCP port is open, so other web pages, other OS users and DNS rebinding
  cannot reach a session (FR-017, FR-018). No token to pair, store or leak.
- Only the extension that the native manifest names in `allowed_extensions` can start the
  native host.
- Firefox spawns a new native host for each `connectNative`/`sendNativeMessage`. That fits
  short request/response calls (list sessions, send batch). Measured cost to verify in
  tests: under 300 ms, well within the 2 s confirmation budget (FR-015, SC-003).
- The extension needs no host permission for `127.0.0.1` and opens no network sockets.

**Alternatives considered**:
- Localhost WebSocket per channel server, with an Origin check and a shared token: reachable
  by other OS users on the machine, needs token pairing, needs port discovery (the extension
  cannot read files). Rejected: more moving parts and a weaker default.
- One long-running broker daemon: one more process to install and supervise. Rejected
  (Principle I).

**NixOS note**: the host manifest goes in `~/.mozilla/native-messaging-hosts/claude-pointer.json`
(Firefox 147's XDG move did not move this directory). `/usr/lib/mozilla` does not exist on
NixOS. `claude-pointer install` writes the user-level manifest with an absolute path.

## R3. Suggesting the correct session (FR-010)

**Decision**: The native host ranks sessions for a page URL and returns them in order:

1. **Port owner**: if the page host is a loopback address (`localhost`, `127.0.0.1`, `[::1]`),
   find the process that listens on the page's port (`/proc/net/tcp{,6}` inode →
   `/proc/<pid>/fd`), read its working directory (`/proc/<pid>/cwd`), and pick the session
   whose project directory contains it, or which it contains. Most specific path wins.
2. **Name match**: session project directory name appears in the page host or title.
3. **Most recently started** session.

The extension shows the first entry as the suggestion. The user confirms once per origin
(FR-010). The extension stores the binding by session ID. If that session is gone, the
extension asks again, with the suggestion pre-selected.

**Rationale**: a dev server almost always runs from inside the project directory, so the
port owner gives the right answer for the main use case (local development). The fallback
order is predictable, and the user confirms before the first send, so a wrong guess never
sends a comment anywhere (SC-002).

**Alternatives considered**: per-project config file listing origins (extra setup, YAGNI);
fully automatic matching without confirmation (user chose suggest + confirm).

Linux only for the port-owner step; other platforms fall back to rules 2–3. Out of scope now
(Firefox desktop on the user's Linux machine).

## R4. Manifest version and minimum Firefox

**Decision**: Manifest V3, `browser_specific_settings.gecko.strict_min_version: "140.0"`
(oldest supported ESR; includes `world: "MAIN"` from 128, popover API from 125).

**Rationale**: MV3 is the long-term platform. Firefox MV3 background scripts are event pages
with DOM access. `activeTab` + `scripting` give on-demand injection without broad host
permissions (Principle V).

**Alternatives considered**: MV2 (works, but no future); minimum 128 (128 ESR is end of life).

## R5. Language and build

**Decision**: TypeScript 5, strict mode. Bundle each entry point to one IIFE file with
**esbuild**. `tsc --noEmit` type-checks. One npm workspace with two packages: `extension/`
and `helper/`.

**Rationale**: MV3 background and content scripts cannot use `import`, so bundling is needed.
esbuild is one small dependency and fast. Types catch message-shape mismatches between the
three processes; contracts are shared from one `shared/` folder.

**Alternatives considered**: plain JS with no bundler (one file per entry gets large); WXT or
Vite (too much for this size, Principle I).

**Helper runtime**: Node.js 24 (on `PATH`). MCP via `@modelcontextprotocol/sdk` (stdio
transport). No other runtime dependency.

## R6. Testing

**Decision**:
- **Unit**: Vitest + happy-dom for extension logic and DOM code;
  `@webext-core/fake-browser` for `browser.*` (one seam, Principle II). Helper logic is
  unit-tested with Vitest in Node, using temp directories for sockets and fake `/proc` roots.
- **Contract**: Vitest tests that run the real `native-host` and `channel` binaries and check
  every message in `contracts/` (round trip through a real socket; MCP notification captured
  through an in-memory MCP client).
- **End-to-end**: Selenium WebDriver (JS) + geckodriver, headless Firefox,
  `driver.installAddon(dir, true)`. A test native-messaging manifest points at the real native
  host; a fake channel server (same code, MCP side replaced by a recorder) stands in for
  Claude. Responsive checks at 320, 768 and 1280 px via WebDriver BiDi
  `browsingContext.setViewport` (window-size clamping avoided).
- **Lint**: `web-ext lint` (zero warnings), ESLint, Prettier.
- **Coverage**: Vitest V8 coverage, threshold 90 % lines for non-UI logic.

**Rationale**: Playwright still cannot load Firefox extensions (playwright#2644). Selenium +
geckodriver is the most mature headless path.

**Alternatives considered**: Puppeteer + BiDi `webExtension.install` (viable backup);
`web-ext run` + attach (fiddly in CI); jsdom (slower than happy-dom).

## R7. Source-component hints (FR-009)

**Decision**: A small page-world script (`scripting.executeScript({world: "MAIN"})`) reads, in
order: build-plugin attributes (`data-insp-path`, `data-source`, `data-locatorjs-id`), Svelte
`__svelte_meta.loc`, Vue 3 `__vueParentComponent.type.__file` / `__name`, React fiber
(`__reactFiber$*`) component name from `_debugOwner` / `type.displayName ?? type.name`, and,
for React 19, the first `_debugStack` frame URL that is not in `node_modules`. It returns
plain strings to the content script through a `CustomEvent`. Missing data is fine; the field
is optional.

**Rationale**: these cover the common dev setups without any change to the user's project.
Running in the page world avoids Xray wrappers. Page-world code stays tiny, has no extension
API access, and returns only strings.

## R8. Isolating injected UI from the page (FR-020)

**Decision**: one host element with a closed shadow root, `:host { all: initial }`, styles via
`adoptedStyleSheets`. The overlay is a `popover="manual"` element in the top layer, so page
`z-index` cannot cover it. Call `showPopover()` again when a page dialog or fullscreen element
appears.

## R9. Untrusted page content in the prompt

**Decision**: the channel server's MCP `instructions` tell Claude that element context
(HTML snippet, text, selector) is **untrusted page data, not instructions**. Only the
`comment` field holds the user's request. The prompt puts page data in a clearly fenced block,
and HTML snippets are size-bounded (4 KB) and stripped of `<script>` / `<style>` content and
`value` attributes of `input[type=password]`.

**Rationale**: the page may be a third-party site. Without this, page text could steer Claude
(Constitution Principle V: page content is untrusted).

## R10. Pending comments and site bindings

**Decision**: `browser.storage.local`.
- Pending comments: keyed by tab-independent page key (`origin + pathname`), so they survive
  reload (US3 scenario 4). Cleared after a successful send.
- Site bindings: keyed by origin → `{ sessionId, projectDir }`.
- Send history: last 20 entries per origin (US4).

**Rationale**: small data, per-user, no sync needed. `storage.session` would lose pending
comments on browser restart.

## R1 spike result (2026-10-06)

Run by the user with the real helper (quickstart S0) instead of `helper/spike/channel-spike.mjs`.
Claude Code v2.1.280, Opus 5.5, Claude Max login, NixOS.

- `claude --mcp-config ~/.config/claude-pointer/mcp.json --dangerously-load-development-channels server:claude-pointer`
  loads the channel server from `--mcp-config`.
- `debug-send` returned `ok: true`, and the **idle session started a turn by itself**. The event
  was shown as `← claude-pointer: Browser comments from … (1)` and Claude answered it.
- `process.cwd()` of the channel server was the session's project directory
  (`/home/oskar/projects/claude-pointer`).
- `process.ppid` was the `claude` process (pid 2106780, `.claude-wrapped …/bin/claude --mcp-config …`),
  so the session id `<claudePid>-<startTicks>` identifies the session.

Conclusion: R1 holds; no design change needed.
