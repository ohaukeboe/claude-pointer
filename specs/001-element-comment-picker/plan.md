# Implementation Plan: Element Comment Picker

**Branch**: `001-element-comment-picker` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-element-comment-picker/spec.md`

## Summary

Claude Pointer lets a developer pick an element on a web page in Firefox, write a comment, and
deliver it as a prompt to one specific running Claude Code session. It has three parts:

1. A **Firefox MV3 extension**: picker overlay, comment box, pending markers, session picker
   and history popup.
2. A **native-messaging host**: lists sessions, ranks them for the page, and forwards a batch to
   the chosen one.
3. A **channel server**: an MCP server that each opted-in Claude Code session spawns. It listens
   on a private Unix socket and pushes batches into its session as `notifications/claude/channel`
   events. That starts a turn without the user typing.

One channel server per session gives an exact session identity. Unix sockets in a `0700`
directory give local-only, same-user-only access with no tokens and no open ports.

## Technical Context

**Language/Version**: TypeScript 5 (strict), compiled for Firefox ≥ 140 and Node.js 24

**Primary Dependencies**: `@modelcontextprotocol/sdk` (helper); esbuild (build). No runtime
dependency in the extension.

**Storage**: `browser.storage.local` (pending comments, site bindings, history); Unix sockets
in `$XDG_RUNTIME_DIR/claude-pointer/` (session registry)

**Testing**: Vitest + happy-dom + `@webext-core/fake-browser` (unit, contract); Selenium
WebDriver + geckodriver, headless Firefox (end-to-end); `web-ext lint`

**Target Platform**: Firefox desktop ≥ 140 on Linux (NixOS); Claude Code CLI with channels
(research preview, verified on 2.1.280)

**Project Type**: Browser extension + local CLI helper (npm workspace)

**Performance Goals**: hover highlight follows the pointer at display frame rate; no content
script task > 50 ms; feedback on click < 100 ms; delivery confirmation < 2 s (p99)

**Constraints**: no TCP listeners; no remote code; page data treated as untrusted; UI usable
from 320 px and at 200 % zoom; prompt content ≤ 64 KB

**Scale/Scope**: one user, 1–10 concurrent sessions, batches of 1–50 comments

All unknowns resolved in [research.md](./research.md) (R1–R10).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Small, focused | PASS (justified) | One purpose. Helper is required: an extension cannot reach a Claude Code session alone. See Complexity Tracking. One runtime dependency (MCP SDK, helper only). |
| II. Test-first | PASS | Unit (Vitest + fake-browser seam), contract tests per file in `contracts/`, Selenium e2e per user story, regression test per bug, 90 % coverage gate. |
| III. Responsive layout | PASS | Fluid shadow-DOM UI, popover top layer, e2e at 320/768/1280 px, 200 % zoom check, `prefers-color-scheme` and `prefers-reduced-motion`. |
| IV. Responsive performance | PASS | Content script injected on demand only (`activeTab` + `scripting`); hover work throttled to `requestAnimationFrame`; all listeners removed on exit (FR-005). |
| V. Least privilege & privacy | PASS | Permissions: `activeTab`, `scripting`, `storage`, `nativeMessaging`. No host permissions. No network. Page data fenced as untrusted (R9). Unix sockets in `0700` dir. |
| Technical constraints | PASS | MV3, `strict_min_version` 140 (fixed here). `web-ext lint` in gates. `npm ci && npm run build` reproduces the build. Bundles are unminified for AMO review. |

**Post-design re-check (after Phase 1)**: PASS. The contracts add no permission, no network
listener and no dependency beyond the above.

## Project Structure

### Documentation (this feature)

```text
specs/001-element-comment-picker/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── native-messaging.md
│   ├── session-socket.md
│   └── channel-prompt.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
package.json                 # npm workspace root: scripts build/test/lint/test:e2e
tsconfig.base.json
shared/
├── types.ts                 # Selection, Comment, Batch, Session, protocol messages
└── validate.ts              # runtime schema checks used by all three processes

extension/
├── manifest.json            # MV3, gecko id claude-pointer@ohaukeboe, min 140
├── build.mjs                # esbuild: one IIFE per entry
├── src/
│   ├── background/          # event page: commands, injection, native-messaging client, storage
│   ├── content/
│   │   ├── picker.ts        # hover/click/keyboard selection (FR-001..005)
│   │   ├── selection.ts     # Selection builder, selector path, sanitising (FR-009, R9)
│   │   ├── overlay/         # shadow-DOM UI: outline, label, comment box, markers
│   │   └── pending.ts       # pending comments per page (US3)
│   ├── page-world/
│   │   └── source-probe.ts  # MAIN-world framework probe (R7)
│   ├── popup/               # session picker, target display, history (FR-011, US4)
│   └── lib/browser.ts       # single seam over browser.* (mocked in unit tests)
└── tests/
    ├── unit/
    └── e2e/                 # selenium + geckodriver, fixtures/ test pages

helper/
├── package.json             # bin: claude-pointer
├── src/
│   ├── cli.ts               # subcommands: channel, native-host, install, claude, debug-*
│   ├── channel/             # MCP server + socket listener + prompt renderer (only module touching channels API)
│   ├── native-host/         # framing, list-sessions, send-batch
│   ├── registry/            # socket dir, session id, stale cleanup
│   └── ranking/             # port owner via /proc, name match, recency (R3)
└── tests/
    ├── unit/
    └── contract/            # real binaries over real sockets
```

**Structure Decision**: npm workspace with `extension/` and `helper/` packages and a `shared/`
folder of types and validators imported by both. This keeps the three processes' message
shapes in one place and lets contract tests import the same validators.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Second package (local helper) beside the extension (Principle I) | Firefox extensions cannot start or talk to Claude Code sessions; a local process is the only bridge. | A localhost WebSocket in the session still needs a helper process, plus tokens and port discovery (research R2). |
| `world: "MAIN"` page script (Principle V) | Framework source hints live in page-world properties invisible to content scripts (R7). | `wrappedJSObject` is Firefox-only and leaks Xray wrappers; build plugins alone miss most projects. Probe is read-only and returns strings. |
| Channels research-preview flag `--dangerously-load-development-channels` | Only documented way to start a turn in a live session (R1). | IDE `at_mentioned` and `-p --resume` do not start a turn in the live session. Mitigated: wrapped in `claude-pointer claude`, isolated in `helper/src/channel/`. |
