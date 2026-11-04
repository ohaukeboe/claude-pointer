# Feature Specification: Delivery Without Channels

**Feature Branch**: `002-no-channel-delivery`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Channels is not enabled in my work claude account. I therefore need
a way to be able to use this plugin without channels. I am thinking it would work to make it an
mcp service and to have a skill to have claude check the comments. Or is there a better way?"

## Context

Claude Pointer (feature 001) delivers each comment by pushing it into the target Claude Code
session as a channel event, so Claude starts working without the user typing anything. Channels
are a research preview and can be turned off for an account or organization. On such an account
Claude Pointer cannot deliver anything today.

This feature adds a second delivery mode that needs only capabilities every Claude Code account
has: a session-local tool server, slash commands or skills, and background commands. In this
mode a comment sent from the browser waits at the target session until Claude picks it up.
Claude picks comments up in one of three ways:

- **On request**: the user tells Claude to read the comments (one short command).
- **Watching**: Claude was asked to watch for comments; it is woken when one arrives and acts
  on it without the user typing anything, as close to channel behaviour as possible.
- **Notice on next turn**: when the user next talks to Claude, Claude is told that comments are
  waiting.

Session selection, picking, commenting, batching and the security model from feature 001 stay
the same.

## Clarifications

### Session 2026-11-04

- Q: Should Claude start watching at session start, or only when asked? → A: Only when asked;
  watching is off at start and the user starts it once per session.
- Q: What does Claude get when comments wait and the user types any prompt? → A: A short
  notice with the count and page addresses only; no comment text.
- Q: Which delivery mode does the launch command use when no mode is given? → A: Channel
  mode; an option switches the session to no-channel mode.
- Q: If the wait ends without a comment (e.g. a runtime limit), does Claude restart watching?
  → A: Yes, on its own and quietly, but watching stops after 8 hours with no comment.
- Q: What happens to comments sent to a channel-mode session on an account without channels?
  → A: Channel sessions also keep each comment in the inbox, so pick-up works there too.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send a comment and have Claude read it on request (Priority: P1)

A developer uses a work account where channels are disabled. They start Claude Code in their
project with Claude Pointer enabled. In Firefox they pick an element, write "make this button
primary", and choose **Send to Claude**. The extension confirms the comment is waiting at that
session. In the terminal they type one short command (for example a Claude Pointer slash
command). Claude receives the comment with the same element context a channel delivery would
carry, and starts working on it.

**Why this priority**: This is the minimum that makes Claude Pointer usable at all without
channels. Everything else improves on it.

**Independent Test**: Start one session in this mode, send a comment from a test page, run the
pick-up command, and verify Claude receives the comment text and element context exactly once.

**Acceptance Scenarios**:

1. **Given** a session runs in no-channel mode, **When** the user sends a comment, **Then** the
   extension shows within 2 seconds that the comment is waiting at that session (not that Claude
   has read it).
2. **Given** one or more comments are waiting, **When** the user runs the pick-up command,
   **Then** Claude receives all waiting comments in the order they were sent, each with its
   element context, and acts on them.
3. **Given** comments were picked up, **When** the user runs the pick-up command again,
   **Then** Claude is told there are no new comments; the same comment is never handed over
   twice.
4. **Given** no comments are waiting, **When** the user runs the pick-up command, **Then**
   Claude says there are no comments and does nothing else.
5. **Given** a comment was picked up, **When** the user opens the extension, **Then** its
   status shows that Claude has picked it up.

---

### User Story 2 - Claude watches for comments and acts without typing (Priority: P2)

The developer wants the channel-like experience: send from the browser, see Claude start
working, without going to the terminal. They tell Claude once to watch for Claude Pointer
comments. From then on, while Claude is idle, a new comment wakes Claude and it acts on the
comment. After finishing, Claude goes back to watching.

**Why this priority**: This restores the main benefit of channels. It is P2 because P1 already
gives a working product and this mode depends on Claude following a standing instruction.

**Independent Test**: Start a session, start watching, leave Claude idle, send a comment from
the browser, and verify Claude starts working on it without terminal input and resumes watching
after it finishes.

**Acceptance Scenarios**:

1. **Given** Claude is watching and idle, **When** a comment arrives, **Then** Claude starts
   working on it within 5 seconds, without any terminal input.
2. **Given** Claude is watching and busy with other work, **When** a comment arrives, **Then**
   the comment waits and Claude picks it up when that work ends; the current work is not
   interrupted.
3. **Given** Claude finished a comment, **When** no further comments are waiting, **Then**
   Claude resumes watching on its own.
4. **Given** Claude is watching, **When** the user asks it to stop watching, **Then** watching
   ends and later comments wait for an explicit pick-up.
5. **Given** Claude is watching, **When** the wait ends without a comment (for example a
   runtime limit stops it), **Then** Claude restarts the wait on its own without writing
   anything to the user.
6. **Given** Claude is watching, **When** 8 hours pass with no comment arriving, **Then**
   watching stops, and the extension shows the session as not watching, so the user knows a
   pick-up command is needed.

---

### User Story 3 - Notice of waiting comments on the next turn (Priority: P3)

The developer forgot to pick up comments and types an unrelated request. Claude is told that
Claude Pointer comments are waiting, mentions this to the user, and offers to read them.

**Why this priority**: Prevents comments from being forgotten, but the user can always run the
pick-up command.

**Independent Test**: Send a comment without picking it up, type any prompt, and verify Claude
mentions the waiting comment count.

**Acceptance Scenarios**:

1. **Given** comments are waiting, **When** the user submits any prompt, **Then** Claude is
   told how many comments are waiting and from which pages, but not their full text.
2. **Given** no comments are waiting, **When** the user submits a prompt, **Then** nothing is
   added.

---

### User Story 4 - Same setup for both account types (Priority: P3)

The developer has a personal account with channels and a work account without them. They use
the same install and the same launch command for both and choose the delivery mode per
session.

**Why this priority**: Avoids two separate installs, but each mode is usable alone.

**Independent Test**: Start one session in channel mode and one in no-channel mode; send a
comment to each and verify each is delivered by its own mode.

**Acceptance Scenarios**:

1. **Given** a session started in channel mode, **When** a comment is sent, **Then** it is
   pushed as in feature 001 and also kept in the session's inbox.
2. **Given** a channel-mode session on an account where channels are off, **When** a comment
   is sent and the user runs the pick-up command, **Then** Claude receives the comment, marked
   as already pushed.
3. **Given** a session started in no-channel mode, **When** a comment is sent, **Then** it
   waits for pick-up as in User Story 1.
4. **Given** sessions of both modes are running, **When** the user opens the session chooser,
   **Then** each session shows its delivery mode.

---

### Edge Cases

- The session ends while comments wait: the extension MUST mark them as not picked up and keep
  their text so the user can resend them to another session.
- Many comments wait (for example 30): pick-up MUST deliver them all, in order, or deliver them
  in clearly numbered parts without losing any.
- The user sends a batch (feature 001, User Story 3): the batch MUST be picked up as one unit.
- Claude calls the pick-up command twice at the same time: each comment MUST be handed over
  once.
- The browser sends a comment while a pick-up is in progress: the new comment MUST either be
  in that pick-up or wait for the next one, never lost.
- Watching is started twice in the same session: there MUST be only one active watch.
- A runtime limit on background commands ends a wait: Claude restarts it (FR-013). If Claude
  cannot restart it (for example the session is closing), the session MUST report "not
  watching" rather than appear to watch.
- Waiting comments contain page text with instructions: the untrusted-page-data rules from
  feature 001 apply unchanged.

## Requirements *(mandatory)*

### Functional Requirements

**Delivery mode**

- **FR-001**: The system MUST offer a no-channel delivery mode that works on accounts where
  channels are disabled, using no channel feature.
- **FR-002**: The channel delivery mode from feature 001 MUST keep working unchanged. In
  addition, a channel-mode session MUST keep each pushed comment in its inbox until picked up,
  so the pick-up command (FR-006) also works there. A pick-up in a channel-mode session MUST
  mark each comment as already pushed, so Claude does not act on it twice.
- **FR-003**: The user MUST be able to choose the delivery mode when starting a session, with
  one install shared by both modes. With no mode given, the launch command MUST start the
  session in channel mode; one launch option MUST start it in no-channel mode.
- **FR-004**: The session list in the extension MUST show each session's delivery mode and, in
  no-channel mode, whether it is watching.

**Waiting and pick-up**

- **FR-005**: In no-channel mode, a comment sent to a session MUST be held by that session
  until Claude picks it up. Comments MUST NOT be written to shared or world-readable storage.
- **FR-006**: The user MUST be able to make Claude pick up waiting comments with one short
  command typed in the session.
- **FR-007**: A pick-up MUST hand Claude every waiting comment, in send order, each with the
  same comment text and element context as a channel delivery (feature 001, FR-009).
- **FR-008**: Each comment MUST be handed to Claude at most once.
- **FR-009**: Claude MUST also be able to pick up comments on its own initiative, without the
  user typing the command (needed by FR-010).

**Watching**

- **FR-010**: Watching MUST be off when a session starts. The user MUST be able to ask Claude
  to watch for comments, once per session. While watching and idle, Claude MUST be woken when a
  comment arrives and act on it without terminal input.
- **FR-011**: A comment arriving while Claude is busy MUST wait and MUST NOT interrupt the
  current work.
- **FR-012**: After acting on picked-up comments, a watching Claude MUST resume watching
  without user input.
- **FR-013**: When a wait ends without a comment, a watching Claude MUST restart it without
  user input and without writing to the user. Watching MUST stop after 8 hours with no
  comment arriving; the 8 hours restart with each comment. The user MUST be able to stop
  watching at any time. The session MUST report accurately whether it is watching.

**Notice**

- **FR-014**: When comments wait and the user submits a prompt, Claude MUST be told the number
  of waiting comments and their page addresses. The notice MUST NOT include comment text or
  element context, and MUST NOT mark any comment as picked up. Comments already pushed by a
  channel MUST NOT count toward the notice.

**Status**

- **FR-015**: The extension MUST show, for each sent comment in no-channel mode, one of:
  waiting, picked up, or not picked up (session ended). The status MUST update within
  2 seconds of the change while the popup is open.
- **FR-016**: Comments that were never picked up because the session ended MUST keep their
  text and element context so the user can resend them.

**Security**

- **FR-017**: The access rules from feature 001 (FR-017, FR-018) MUST apply to no-channel
  mode: only this extension can send comments, only the chosen local session receives them,
  and no other web page or local user can read or inject waiting comments.
- **FR-018**: Picked-up comments MUST carry the same untrusted-page-data marking and
  instruction as channel deliveries.

### Key Entities

- **Delivery mode**: per session, channel or no-channel. Shown in the session list.
- **Inbox**: the comments waiting at one session (either mode), in send order, each marked
  pushed or not pushed. Lives as long as the session.
- **Comment status**: adds waiting, picked up, and not picked up to the states of feature 001.
- **Watch**: whether Claude in a no-channel session is currently waiting to be woken by a new
  comment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On an account with channels disabled, a user can send a comment and have Claude
  act on it, with at most one short typed command, on the first attempt after install.
- **SC-002**: With watching on and Claude idle, Claude starts working on a new comment within
  5 seconds of sending in 95% of trials, with no terminal input.
- **SC-003**: In testing with comments sent during pick-up, during busy work and in parallel,
  100% of comments are handed to Claude exactly once, or are reported as not picked up.
- **SC-004**: With two or more sessions of mixed modes running, 100% of comments reach only
  the chosen session.
- **SC-005**: The element context Claude receives in no-channel mode is identical to the
  channel mode context for the same comment.
- **SC-006**: Switching an existing setup from channel mode to no-channel mode needs no
  reinstall and no change in the browser.

## Assumptions

- The work account allows locally configured tool servers, slash commands or skills, hooks and
  background commands; only channels are disabled. If tool servers are also blocked by
  organization policy, this feature cannot help and that is out of scope.
- Watching relies on Claude Code waking an idle session when a background task it started
  finishes. A runtime limit may stop a single background wait; FR-013 restarts it. Watching
  ends when the session ends or after 8 idle hours, and FR-013 makes that visible.
- Waiting comments live only in memory of the session's own helper process; they are not kept
  across session restarts. Lost comments are recoverable from the extension (FR-016).
- Typing into the terminal on the user's behalf (simulated key presses, terminal multiplexer
  injection) is out of scope: it is fragile and could inject text into the wrong program.
- Showing Claude's replies in the browser stays out of scope, as in feature 001.
- Mode choice is explicit at session start. Automatic detection of whether channels are
  enabled is not required.
