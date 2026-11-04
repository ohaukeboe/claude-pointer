# Implementation Plan: Delivery Without Channels

**Branch**: `002-no-channel-delivery` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-no-channel-delivery/spec.md`

## Summary

Make Claude Pointer usable on accounts where channels are disabled. The per-session MCP server
from feature 001 gets an **inbox** that holds every delivered batch, in both modes. Claude
reads it through MCP tools: `pick_up_comments` (on request via the slash command
`/mcp__claude-pointer__comments`, or on its own), and `watch_comments`, which hands Claude a
`claude-pointer wait` command to run in the background. When a comment arrives, `wait` exits,
and Claude Code wakes the idle session. A `UserPromptSubmit` hook adds a one-line notice when
comments are waiting. The launcher keeps channel mode as default and adds `--no-channel`. The
extension shows mode, watch state and per-batch status (waiting, picked up, not picked up), and
can resend batches whose session ended.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Firefox ≥ 140, Node.js 24 (unchanged)

**Primary Dependencies**: `@modelcontextprotocol/sdk` (helper, already used; now also its
tools and prompts API). No new dependency.

**Storage**: inbox and watch state in the MCP server's memory; `browser.storage.local`
history entries keep comments until picked up. No new files at run time.

**Testing**: Vitest unit and contract tests (fake clock for watch timers, SDK in-memory
transport for MCP tools, real sockets for `wait`/`notice`); Selenium e2e for V1 and V5;
manual spikes S1/S2 on the work account (quickstart.md).

**Target Platform**: Linux; Claude Code CLI with or without channels. Version on the work
account is recorded in spike S1.

**Project Type**: Browser extension + local CLI helper (npm workspace, unchanged)

**Performance Goals**: watch wake ≤ 5 s after send (SC-002); status update ≤ 2 s while the
popup is open (FR-015); `notice` hook ≤ 1 s, never blocks a prompt.

**Constraints**: no TCP listeners; inbox in memory only; pick-up result ≤ 64 KB; ≤ 50 unread
batches per session; `wait` timeout 45 min under the 1 h / 4 h command caps; no comment text
outside `pick_up_comments` (FR-018).

**Scale/Scope**: 1–10 sessions, ≤ 50 waiting batches per session, ≤ 10 wake-ups per 8 h idle
watch.

All unknowns resolved in [research.md](./research.md) (R11–R17), except two facts about the
work account, which spikes S1 and S2 check before the stories that depend on them.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Small, focused — PASS.** Same purpose, same three processes. New code is two CLI
  subcommands (`wait`, `notice`), inbox and watch modules in the existing server, and popup
  status. No new dependency.
- **II. Test-first — PASS.** Every contract file gets a contract test written first: socket
  `status`/`peek`/`wait`, native `batch-status`, MCP tools and prompts, CLI `wait`/`notice`.
  Watch timers use an injected clock (deterministic). E2e for V1 and V5. Coverage gate 90 %.
- **III. Responsive layout — PASS.** New popup elements (mode and watch badges, status labels,
  Resend button) are covered by the existing 320/768/1280 px popup tests.
- **IV. Responsive performance — PASS.** No content-script change apart from the confirmation
  text. Popup polling runs only while the popup is open and only for waiting entries.
- **V. Least privilege & privacy — PASS.** No new extension permission. Inbox is memory only
  in a same-user process. `wait` and `notice` print no comment text; page data still reaches
  Claude only inside the fenced, marked block. Settings are passed with `--settings`, not
  written into the user's Claude Code config.
- **Technical constraints — PASS.** MV3 and Firefox 140 unchanged; `web-ext lint` and
  `npm run check` unchanged.

**Post-design re-check (after Phase 1)**: PASS. The contracts add one native request, three
socket requests, two tools, two prompts and two subcommands; no permission, port or
dependency.

## Project Structure

### Documentation (this feature)

```text
specs/002-no-channel-delivery/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── session-socket.md    # info/deliver changes; status, peek, wait
│   ├── native-messaging.md  # list-sessions/send-batch changes; batch-status
│   ├── mcp-server.md        # tools, prompts, instructions
│   └── cli.md               # install, claude --no-channel, channel --no-push, wait, notice
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
shared/
├── types.ts                 # Session.mode/watch, status/peek/wait/batch-status messages,
│                            #   inbox-full error
└── validate.ts              # validators for the new messages

helper/src/
├── cli.ts                   # + wait, notice; claude --no-channel; channel --no-push
├── install.ts               # + mcp-no-channel.json, settings.json; launcher args
├── channel/
│   ├── index.ts             # server: push only in channel mode; wires inbox, watch, tools
│   ├── inbox.ts             # new: InboxEntry store, limits, take-and-mark (R16)
│   ├── watch.ts             # new: watch state machine with injected clock (R13)
│   ├── tools.ts             # new: pick_up_comments, watch_comments, prompts (contracts)
│   ├── main.ts              # parse --no-push
│   └── render.ts            # unchanged renderer; + pick-up wrapper and 64 KB split
├── registry/listener.ts     # + status, peek, wait requests (long-held wait connection)
├── native-host/index.ts     # + batch-status; pass status/mode/watch through
├── wait.ts                  # new: `claude-pointer wait`
├── notice.ts                # new: `claude-pointer notice` hook, ancestor/cwd lookup (R14)
└── debug.ts                 # debug-list shows mode and watch

helper/tests/
├── unit/channel/{inbox,watch,tools}.test.ts
├── unit/{wait,notice}.test.ts
└── contract/{session-socket,native-messaging,mcp-server,cli}.test.ts  # extended / new

extension/src/
├── background/send.ts       # store waiting vs delivered; inbox-full message
├── background/history.ts    # new states, pageKey, comments, resend
├── background/router.ts     # + batch-status, resend calls
├── popup/index.ts           # mode/watch badges, status polling, Resend
└── lib/messages.ts          # + batch-status, resend

extension/tests/
├── unit/background/{history,send}.test.ts   # extended
└── e2e/us5-no-channel.test.ts               # new: V1 + V5 against a fake session

README.md                    # "Without channels" section
```

**Structure Decision**: Keep feature 001's layout. The inbox, watch and tools stay in
`helper/src/channel/` because they live in the same per-session server process; `wait` and
`notice` are separate short-lived subcommands like `native-host`.

## Implementation Order

1. Spikes S1 and S2 (quickstart.md). S1 failing blocks only User Story 2.
2. Shared types and validators; socket `status`/`peek`; inbox; `pick_up_comments`; prompts;
   `--no-push`; `--no-channel`; extension waiting/picked-up status (User Story 1, MVP).
3. Watch state machine, socket `wait`, `wait` subcommand, `watch_comments` (User Story 2).
4. `notice` hook and `settings.json` (User Story 3).
5. Inbox in channel mode, mode badges, Resend (User Story 4, FR-016).
6. README section.

## Complexity Tracking

- **Long-held socket connection (`wait`)** beside one-shot requests. Needed: it is what wakes
  Claude (R12). Simpler alternative rejected: polling from Claude wastes turns and misses 5 s.
- **Hook via `--settings`.** Needed for FR-014. Simpler alternative rejected: writing to
  `~/.claude/settings.json` changes every session, not only Claude Pointer ones.
- **Two MCP config files.** Needed: mode must be explicit and the server name must stay the
  same (R15). Alternative rejected: an environment variable depends on how Claude Code passes
  its environment to stdio servers.
