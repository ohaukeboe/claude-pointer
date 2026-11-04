---

description: "Task list for Delivery Without Channels (Claude Pointer)"
---

# Tasks: Delivery Without Channels

**Input**: Design documents from `/specs/002-no-channel-delivery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED. Constitution Principle II (Test-First, NON-NEGOTIABLE): write each test task
first, run it, and confirm it fails before the matching implementation task. Timers use an
injected clock (`now()` and a fake `setTimeout`); no test waits for real time.

**Organization**: Tasks are grouped by user story (US1–US4 from spec.md). Paths follow plan.md.
Feature 001 code is the base: read the file named in a task before changing it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story from spec.md (US1–US4)

---

## Phase 1: Setup (Spikes on the work account)

**Purpose**: Check the two Claude Code facts the design depends on (research R12, R14).
These are manual; the user runs them on the work account. Record results before Phase 4/5.

- [X] T001 Run spike S1 from `specs/002-no-channel-delivery/quickstart.md` on the work account and append "S1 result" under R12 in `specs/002-no-channel-delivery/research.md`: Claude Code version, whether a finished `run_in_background` command wakes the idle session without input, seconds until the turn starts, and whether the Bash sandbox can list `$XDG_RUNTIME_DIR/claude-pointer`. If the session is not woken, mark Phase 4 (US2) blocked in this file and continue with the other stories
- [X] T002 [P] Run spike S2 from `specs/002-no-channel-delivery/quickstart.md` on the work account (use a hand-written settings file with one `UserPromptSubmit` hook that echoes a fixed line) and append "S2 result" under R14 in `specs/002-no-channel-delivery/research.md`: whether `claude --settings <file>` applies the hook and `permissions.allow` entries, and whether managed settings block them. If blocked, mark Phase 5 (US3) blocked

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, validators and a listener that can answer new request types.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Extend `shared/types.ts` per data-model.md and contracts/: `Session` gains `mode: "channel" | "no-channel"` and `watch: "off" | "waiting" | "busy" | "gap"`; `DeliveredResponse` gains `status: "pushed" | "waiting"`; add `ErrorCode` `"inbox-full"`; add socket requests `StatusRequest {v:1, type:"status", batchIds: string[]}`, `PeekRequest {v:1, type:"peek"}`, `WaitRequest {v:1, type:"wait"}` and responses `StatusResponse {v:1, ok:true, statuses: {batchId, state: "waiting" | "picked-up" | "unknown", at: string | null}[]}`, `PeekResponse {v:1, ok:true, waiting: number, pages: string[]}`, `WaitResponse {v:1, ok:true, outcome: "comments" | "timeout" | "expired" | "stopped" | "replaced", waiting: number}`; add native request `BatchStatusRequest {v:1, type:"batch-status", sessionId, batchIds}` (response = `StatusResponse`); add them to the `SocketRequest`/`SocketResponse`/`NativeRequest`/`NativeResponse` unions
- [X] T004 Write failing tests in `shared/validate.test.ts`: `status` and `batch-status` accept "1–20 ids" and reject 0 or 21 ids and non-string ids; `batch-status` requires a valid session id; `peek` and `wait` accept only `{v:1, type}`; unknown `type` still → `invalid-request`
- [X] T005 Implement the new request parsers in `shared/validate.ts` (`parseSocketRequest`, `parseNativeRequest`) to make T004 pass
- [X] T006 Write failing tests in `helper/tests/unit/registry/listener.test.ts`, then change `helper/src/registry/listener.ts`: replace the static `session` option with `session(): Session` (mode and watch change at run time); replace `onDeliver` with a handler object `{ deliver(batch), status(ids), peek(), wait(signal) }` where every handler is optional and a missing one answers `invalid-request`; pass an `AbortSignal` to `wait` that aborts when the client socket closes before the answer; keep the one-request-per-connection rule and the existing `deliver` session-id check
- [X] T007 Update callers of the listener to the new option shape with no behaviour change: `helper/src/channel/index.ts` and `helper/tests/support/fake-session.ts`; extend the fake session with `mode` and `watch` options (defaults `"channel"`, `"off"`) and a recorder for `status`/`peek`/`wait` calls. Run `npm test -w helper` and confirm feature 001 tests still pass

**Checkpoint**: Types, validators and listener ready; feature 001 behaviour unchanged.

---

## Phase 3: User Story 1 - Pick up comments on request (Priority: P1) 🎯 MVP

**Goal**: In a session started with `--no-channel`, sent comments wait in the inbox, and
`/mcp__claude-pointer__comments` hands them to Claude exactly once. The popup shows waiting,
picked up, or not picked up, and can resend.

**Independent Test**: quickstart.md V1 and V5; e2e `extension/tests/e2e/us5-no-channel.test.ts`.

### Tests for User Story 1 ⚠️

- [X] T008 [P] [US1] Write failing unit tests in `helper/tests/unit/channel/inbox.test.ts` for `createInbox({ now })` per data-model.md InboxEntry: `add(batch, {pushed})` → `state: "waiting"`; "Waiting and not pushed: max 50. A 51st `deliver` fails with `inbox-full`"; "A known `batch.id` on `deliver` returns the first answer; nothing is added"; `take(maxBytes, render)` returns waiting entries oldest first, always at least one, stops before the rendered total exceeds `maxBytes`, marks taken entries `picked-up` with `pickedUpAt` synchronously, and returns the count left; "Picked up: only `{batchId, pickedUpAt}` kept, last 200"; `status(ids)` answers `waiting` / `picked-up` / `unknown`; two `take` calls in the same tick never return the same batch (FR-008)
- [X] T009 [P] [US1] Write failing unit tests in `helper/tests/unit/channel/tools.test.ts` using the SDK `InMemoryTransport` and an MCP `Client`: `tools/list` includes `pick_up_comments` with input `{}`; with an empty inbox it returns exactly `No Claude Pointer comments are waiting.`; with two batches it returns both `renderPrompt(batch)` texts oldest first, byte-identical to `helper/src/channel/render.ts` output (SC-005); when the batches exceed 64 KB the last line is `N more batches waiting; call pick_up_comments again.`; a second call returns only the rest; `prompts/list` includes `comments` with no arguments and `prompts/get comments` returns a user message asking Claude to call `pick_up_comments` and act on the result; server `instructions` still start with feature 001's `INSTRUCTIONS` text unchanged
- [X] T010 [P] [US1] Extend `helper/tests/contract/session-socket.test.ts` (failing first) against a real `claude-pointer channel --no-push` process: `info` returns `mode: "no-channel"`, `watch: "off"`; `deliver` answers `status: "waiting"` and emits no `notifications/claude/channel` on stdout; `status` answers per contracts/session-socket.md; the 51st waiting batch → `inbox-full`
- [X] T011 [P] [US1] Extend `helper/tests/contract/native-messaging.test.ts` (failing first): `list-sessions` passes `mode` and `watch` through; `send-batch` passes `status` through; `batch-status` returns the socket's `status` answer unchanged; `batch-status` for a missing session → `session-gone`
- [X] T012 [P] [US1] Write failing tests in `helper/tests/unit/install/install.test.ts`: `install` also writes `~/.config/claude-pointer/mcp-no-channel.json` with args `[cli, "channel", "--no-push"]` and `~/.config/claude-pointer/settings.json` whose `permissions.allow` contains `mcp__claude-pointer__pick_up_comments`; `claudeArgs` default is `--mcp-config mcp.json --settings settings.json --dangerously-load-development-channels server:claude-pointer ...extra`; with first argument `--no-channel` it is `--mcp-config mcp-no-channel.json --settings settings.json ...extra` and `--no-channel` is not passed on; `--no-channel` in a later position is passed on unchanged
- [X] T013 [P] [US1] Write failing tests in `extension/tests/unit/background/history.test.ts` and `extension/tests/unit/background/send.test.ts` per data-model.md HistoryEntry: send with answer `status: "waiting"` stores state `waiting` with `pageKey` and `comments`; `status: "pushed"` stores `delivered` with `comments: null`; `applyStatuses(sessionId, statuses)` turns `picked-up` entries into `picked-up` and sets `comments` to `null`; a `session-gone` answer turns every `waiting` entry of that session into `not-picked-up` and keeps `comments`; `resend(origin, batchId)` appends the comments to `pageKey` with state `pending` and removes the entry; error `inbox-full` shows "Claude has 50 unread batches; ask it to pick them up" and keeps the comments; history still keeps the last 20
- [X] T014 [P] [US1] Write failing e2e test `extension/tests/e2e/us5-no-channel.test.ts` using `extension/tests/e2e/harness.ts` and a fake session in `no-channel` mode: send a comment → popup shows **Waiting**; the test marks the batch picked up in the fake session → popup shows **Picked up** within 2 s while open; second case: stop the fake session → popup shows **Not picked up** and **Resend**; Resend → a pending marker is back on the page

### Implementation for User Story 1

- [X] T015 [US1] Implement `helper/src/channel/inbox.ts` to make T008 pass (memory only, no I/O)
- [X] T016 [US1] Add `renderPickUp(entries)` to `helper/src/channel/render.ts`: joins `renderPrompt(batch)` texts with a blank line; leave `renderPrompt` and `buildNotification` unchanged
- [X] T017 [US1] Implement `helper/src/channel/tools.ts`: `registerTools(server, { inbox })` adding `tools` and `prompts` capabilities, tool `pick_up_comments` (uses `inbox.take(LIMITS.promptBytes, …)`), prompt `comments`, per contracts/mcp-server.md; make T009 pass
- [X] T018 [US1] Change `helper/src/channel/index.ts`: add option `push: boolean`; declare `experimental["claude/channel"]` and send the notification only when `push`; every `deliver` goes through the inbox (`add` with `pushed: push`) and answers `status: push ? "pushed" : "waiting"`; drop the 10-minute idempotency map in favour of the inbox; serve `status` from the inbox; `session()` returns `mode` from `push` and `watch: "off"`; register tools
- [X] T019 [US1] Parse `--no-push` in `helper/src/channel/main.ts` and `helper/src/cli.ts` (`channel [--no-push]`); update help text; extend `helper/tests/unit/channel/main.test.ts`
- [X] T020 [US1] Implement the install and launcher changes in `helper/src/install.ts` to make T012 pass; `claude-pointer install` prints the two new paths in `helper/src/cli.ts`
- [X] T021 [US1] Add `batch-status` to `helper/src/native-host/index.ts` (socket `status` with the 1500 ms timeout; missing or refused socket → `session-gone`) and pass `mode`, `watch` and `status` through; make T010 and T011 pass
- [X] T022 [P] [US1] Show mode and watch in `helper/src/debug.ts` `debug-list` output (`<id>  <projectName>  <projectDir>  <mode>  <watch>`); update `helper/tests/unit/debug/debug.test.ts`
- [X] T023 [US1] Implement history and send changes in `extension/src/background/history.ts` and `extension/src/background/send.ts` to make T013 pass; add message `inbox-full` to `messageFor`
- [X] T024 [US1] Add background calls `batch-status {sessionId, batchIds}` and `resend {origin, batchId}` to `extension/src/lib/messages.ts` and handle them in `extension/src/background/router.ts`
- [X] T025 [US1] Change `extension/src/popup/index.ts` and `extension/src/popup/popup.css`: history rows show **Waiting**, **Picked up**, **Not picked up** (with a **Resend** button) besides the existing states; while the popup is open, send one `batch-status` per session per second for `waiting` entries only, and stop when none are left or the popup closes; layout stays fluid at 320 px (Constitution III)
- [X] T026 [US1] Change the comment-box confirmation in `extension/src/content/controller.ts` (the `box.setStatus("ok", \`Delivered to ${session.projectName}\`)` call; test in `extension/tests/unit/content/controller.test.ts`, failing first): "Waiting for Claude in <projectName>" when the send answer is `waiting`; keep "Delivered to <projectName>" when `delivered`. Pass `status` through the `send` result in `extension/src/background/send.ts` and `extension/src/background/router.ts`
- [X] T027 [US1] Make T014 pass; run `npm test` and `npm run test:e2e`

**Checkpoint**: MVP. On an account without channels, `claude-pointer claude --no-channel` plus one slash command delivers comments.

---

## Phase 4: User Story 2 - Watch for comments (Priority: P2)

**Goal**: After `/mcp__claude-pointer__watch`, an idle Claude is woken by a new comment, acts,
and resumes watching; it restarts quietly on timeout and stops after 8 idle hours.

**Independent Test**: quickstart.md V2. Depends on T001 (S1) succeeding.

### Tests for User Story 2 ⚠️

- [X] T028 [P] [US2] Write failing unit tests in `helper/tests/unit/channel/watch.test.ts` for `createWatch({ now, setTimer })` covering every transition in data-model.md "Watch": `off ──watch start──▶ gap`; `gap ──wait opens──▶ waiting`; waiting comments present when `wait` opens → answer `comments` at once and state `busy`; comment arrives while `waiting` → `comments`, `busy`; "45 min" → `timeout`, `gap`; "gap ──120 s without wait──▶ off"; "8 h since idleSince" → open wait answers `expired`, `off`, and `idleSince` resets on each comment arrival; `stop` → open wait answers `stopped`; second `wait` while one is open → the old one answers `replaced`; `wait` while `off` → `stopped` immediately; client abort while `waiting` → `gap`
- [X] T029 [P] [US2] Extend `helper/tests/unit/channel/tools.test.ts` (failing first): `watch_comments {action:"start"}` in no-channel mode returns text containing the exact command `'<node>' '<cli>' wait --session <id>` (shell-quoted) and "run_in_background"; calling `start` twice returns the same text and keeps one watch; `start` in channel mode returns `Comments are pushed to this session; no watch needed.`; `stop` returns `Stopped watching.`; invalid `action` → MCP error; prompt `watch` exists with no arguments; `instructions` contain the added watch paragraph from contracts/mcp-server.md after feature 001's text
- [X] T030 [P] [US2] Write failing tests in `helper/tests/contract/cli-wait.test.ts` with the built CLI and a fake session: `wait --session <id>` prints `claude-pointer: comments (2 waiting)` and exits 0 when the session answers `comments` with 2; one line each for `timeout`, `expired`, `stopped`, `replaced`; missing socket → `claude-pointer: session-gone`, exit 1; invalid id → exit 2; stdout never contains comment text
- [X] T031 [P] [US2] Extend `helper/tests/unit/install/install.test.ts` (failing first): `settings.json` `permissions.allow` also contains `Bash('<node>' '<cli>' wait --session *)` and `mcp__claude-pointer__watch_comments`

### Implementation for User Story 2

- [X] T032 [US2] Implement `helper/src/channel/watch.ts` to make T028 pass (state, `since`, `idleSince`, `openWait`; constants `WAIT_TIMEOUT_MS = 45 * 60_000`, `GAP_MS = 120_000`, `IDLE_MS = 8 * 3_600_000`)
- [X] T033 [US2] Wire the watch in `helper/src/channel/index.ts`: listener `wait(signal)` handler delegates to the watch; inbox arrivals of unpushed batches notify the watch; `session()` reports the live `watch` state; clear all watch timers on `close()`
- [X] T034 [US2] Add tool `watch_comments` and prompt `watch` to `helper/src/channel/tools.ts`, and append the watch paragraph to the server instructions in `helper/src/channel/index.ts`, per contracts/mcp-server.md; the command uses `process.execPath` and the CLI path, shell-quoted like `helper/src/install.ts`; make T029 pass
- [X] T035 [US2] Implement `helper/src/wait.ts` and the `wait --session <id>` subcommand in `helper/src/cli.ts` per contracts/cli.md (no client-side timeout; reuse `socketPathFor` validation); make T030 pass
- [X] T036 [US2] Add the `wait` and `watch_comments` permissions to `settings.json` in `helper/src/install.ts`; make T031 pass
- [X] T037 [US2] Show watch state in `extension/src/popup/index.ts` next to the target session: "Watching", "Watching (busy)", or "Not watching — type /mcp__claude-pointer__comments" for `off` in no-channel mode (`gap` shows as "Watching"); refresh it with the status poll from T025
- [ ] T038 [US2] Run quickstart.md V2 by hand on the work account (needs T001 success) and record the observed wake time in `specs/002-no-channel-delivery/research.md` under R12 (SC-002 target: ≤ 5 s)

**Checkpoint**: Channel-like hands-free flow without channels.

---

## Phase 5: User Story 3 - Notice on next turn (Priority: P3)

**Goal**: When comments wait and the user types any prompt, Claude is told the count and pages,
never the comment text.

**Independent Test**: quickstart.md V3. Depends on T002 (S2) succeeding.

### Tests for User Story 3 ⚠️

- [X] T039 [P] [US3] Extend `helper/tests/contract/session-socket.test.ts` (failing first): `peek` answers `{waiting, pages}` counting only waiting batches that were not pushed, `pages` distinct `pageUrl` values "max 5", and changes no state (a following `status` still says `waiting`)
- [X] T040 [P] [US3] Write failing tests in `helper/tests/unit/notice.test.ts` for `runNotice({ stdin, procRoot, dir, out })`: finds the session by walking parent PIDs "max 8 levels" through a fake `/proc` and matching `<pid>-<startTicks>` sockets; falls back to the single session whose `projectDir` equals stdin `cwd`; prints nothing when zero or several match; prints exactly one line `Claude Pointer: N browser comment batch(es) are waiting (from <url>, …). Tell the user and offer to read them with pick_up_comments.` when `waiting > 0`; prints nothing when `waiting` is 0; URLs with control characters are made one-line; never prints comment text; exits 0 on invalid stdin, socket errors and after the "1 s" timeout
- [X] T041 [P] [US3] Extend `helper/tests/unit/install/install.test.ts` (failing first): `settings.json` contains `hooks.UserPromptSubmit[0].hooks[0]` `{type: "command", command: "'<node>' '<cli>' notice", timeout: 5}`

### Implementation for User Story 3

- [X] T042 [US3] Add `peek()` to `helper/src/channel/inbox.ts` and serve it from the listener in `helper/src/channel/index.ts`; make T039 pass
- [X] T043 [US3] Implement `helper/src/notice.ts` and the `notice` subcommand in `helper/src/cli.ts` per contracts/cli.md, reusing `oneLine` from `helper/src/channel/render.ts` (export it); make T040 pass
- [X] T044 [US3] Add the hook to `settings.json` in `helper/src/install.ts`; make T041 pass

**Checkpoint**: Forgotten comments are announced on the next prompt.

---

## Phase 6: User Story 4 - Same setup for both account types (Priority: P3)

**Goal**: Channel-mode sessions also keep comments in the inbox so pick-up works there; the
popup shows each session's mode.

**Independent Test**: quickstart.md V4.

### Tests for User Story 4 ⚠️

- [X] T045 [P] [US4] Extend `helper/tests/unit/channel/inbox.test.ts` (failing first): "Waiting and pushed: max 50. The oldest is dropped when a new one arrives" (the dropped id then reports `unknown`); pushed entries never trigger `inbox-full`
- [X] T046 [P] [US4] Extend `helper/tests/unit/channel/tools.test.ts` (failing first): in push mode a delivered batch is pushed and also returned by `pick_up_comments`, preceded by the line `(Already delivered by the channel; skip if you have handled it.)`; unpushed batches have no such line
- [X] T047 [P] [US4] Extend `extension/tests/e2e/us2-sessions.test.ts` (failing first): with one `channel` and one `no-channel` fake session, the session chooser labels each with its mode

### Implementation for User Story 4

- [X] T048 [US4] Implement pushed-entry eviction in `helper/src/channel/inbox.ts` and the pushed label in `helper/src/channel/render.ts` `renderPickUp`; make T045 and T046 pass
- [X] T049 [US4] Show the mode ("channel" / "no channel") in the session chooser in `extension/src/content/overlay/session-chooser.ts` and the popup target line in `extension/src/popup/index.ts`; make T047 pass

**Checkpoint**: One install, both account types, no lost comments on a mistaken launch.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T050 [P] Add a "Without channels" section to `README.md`: `claude-pointer claude --no-channel`, the two slash commands, asking Claude to stop watching, the notice, the 50-batch limit, and that `install` must be re-run; update the "How it works" diagram and the help text listing in `README.md`
- [X] T051 [P] Add regression tests for the edge cases in spec.md not yet covered, in `helper/tests/unit/channel/tools.test.ts`: a batch delivered during a pick-up is either in that result or in the next one; a 30-batch inbox is fully delivered over several calls with no loss or repeat
- [X] T052 Run `npm run check` (typecheck, lint, unit + contract with ≥ 90 % line coverage, e2e, `web-ext lint`); fix failures
- [ ] T053 Run quickstart.md V1–V5 by hand and record results in `specs/002-no-channel-delivery/checklists/quickstart-run.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Spikes)**: no code dependency; T001 gates Phase 4, T002 gates Phase 5.
- **Phase 2 (Foundational)**: T003 → T004 → T005; T006 → T007. Blocks all stories.
- **US1 (Phase 3)**: after Phase 2. MVP.
- **US2 (Phase 4)**: after US1 (needs inbox T015, tools T017, popup polling T025) and T001.
- **US3 (Phase 5)**: after US1 (needs inbox T015, settings file T020) and T002. Independent
  of US2.
- **US4 (Phase 6)**: after US1. Independent of US2 and US3.
- **Polish**: after the stories that are in scope.

### Within Each Story

Tests first and failing → helper modules → server wiring → CLI/native host → extension → e2e.

### Parallel Opportunities

- T001 and T002 (different people or sessions).
- Phase 3 tests T008–T014 all touch different files.
- T022 runs beside T023–T026.
- After US1: US3 and US4 can proceed in parallel; US2 can too once T001 passes.
- In each later phase, the [P] test tasks run together.

## Parallel Example: User Story 1

```bash
# Write all US1 tests together, confirm each fails:
Task: "T008 inbox unit tests in helper/tests/unit/channel/inbox.test.ts"
Task: "T009 MCP tool tests in helper/tests/unit/channel/tools.test.ts"
Task: "T010 socket contract tests in helper/tests/contract/session-socket.test.ts"
Task: "T011 native messaging contract tests in helper/tests/contract/native-messaging.test.ts"
Task: "T012 install tests in helper/tests/unit/install/install.test.ts"
Task: "T013 history/send tests in extension/tests/unit/background/"
Task: "T014 e2e test in extension/tests/e2e/us5-no-channel.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 2, then Phase 3.
2. Stop and validate with quickstart.md V1 and V5 on the work account.
3. This alone makes the plugin usable without channels.

### Incremental Delivery

1. MVP (US1).
2. US2 if spike S1 passed: hands-free.
3. US3 if spike S2 passed: reminder on the next prompt.
4. US4: safety net for mistaken launches and mode labels.
