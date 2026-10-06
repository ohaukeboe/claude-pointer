# Feature Specification: Element Comment Picker

**Feature Branch**: `001-element-comment-picker`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "~/Nextcloud/org_notes/roam/20261006185906-claude_code_web_picker.org"
— Claude Pointer: a Firefox extension that lets the user select a component on a website they are
working on, write a comment about it, and send that comment directly to the correct running Claude
Code session (modelled on the select-and-comment flow in Claude Design).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select an element and send a comment to Claude (Priority: P1)

A developer has their website open in Firefox and a Claude Code session running for that
project. They turn on pick mode, hover over the page (the element under the pointer is
highlighted), and click the component they want changed. A comment box opens next to the
selected element. They type "make this table denser and truncate long titles" and choose
**Send to Claude**. The comment, together with enough information about the selected element
for Claude to find it in the source code, arrives as a new prompt in the correct Claude Code
session.

**Why this priority**: This is the whole point of the product. Without it, nothing else has value.

**Independent Test**: Start one Claude Code session and open a test page. Select an element,
send a comment, and verify that the session receives a prompt containing the comment text and
the element context.

**Acceptance Scenarios**:

1. **Given** pick mode is active, **When** the user moves the pointer over the page, **Then**
   the element under the pointer is visibly outlined and the page does not react to the hover
   as it normally would (no navigation, no click handlers fire).
2. **Given** pick mode is active, **When** the user clicks an element, **Then** that element
   stays outlined, a comment box opens anchored to it, and the text field has focus.
3. **Given** a comment is typed, **When** the user chooses **Send to Claude**, **Then** the
   target session receives one prompt that contains the comment text, the page URL, and a
   description of the selected element. The user sees a confirmation that delivery succeeded.
4. **Given** the comment box is open, **When** the user presses Escape or the close control,
   **Then** the comment box closes, nothing is sent, and the page is back to normal.
5. **Given** pick mode is active, **When** the user presses Escape with no element selected,
   **Then** pick mode ends and the page behaves normally again.

---

### User Story 2 - Connect to the correct session (Priority: P1)

The developer often has several Claude Code sessions running at the same time, for different
projects. A comment made on a page MUST reach the session that works on that page's project,
never a different one.

**Why this priority**: The user stated this as an explicit requirement. A comment sent to the
wrong session causes changes in the wrong project.

**Independent Test**: Start two sessions for two different projects. Comment on a page that
belongs to project A, and verify only session A receives the prompt.

**Acceptance Scenarios**:

1. **Given** two or more sessions are running, **When** the user sends a comment from a page,
   **Then** the comment is delivered to exactly one session, chosen as described in FR-010.
2. **Given** the user has a target session for a page, **When** they look at the extension,
   **Then** they can see which session (project name and working directory) comments will go
   to before they send.
3. **Given** no session is running or reachable, **When** the user tries to send, **Then** the
   comment is not lost, and the user sees a clear message saying no session is available.
4. **Given** the target session has ended since it was chosen, **When** the user sends,
   **Then** delivery fails with a clear message and the user can choose another session; the
   comment text is kept.

---

### User Story 3 - Collect several comments and send them together (Priority: P2)

While reviewing a page, the developer notices several issues. For each one they select the
element, write a comment, and choose **Add comment**. Each added comment shows a numbered
marker on its element. When finished, they send all collected comments to Claude as one
prompt.

**Why this priority**: Matches the **Add comment** / **Send to Claude** pair shown in the
reference screenshot. It is useful but not needed for a first working version.

**Independent Test**: Add three comments on three elements, send them, and verify the session
receives one prompt containing all three comments with their element context, in order.

**Acceptance Scenarios**:

1. **Given** a comment is typed, **When** the user chooses **Add comment**, **Then** the
   comment is stored as pending, a marker appears on the element, and pick mode continues.
2. **Given** pending comments exist, **When** the user clicks a marker, **Then** they can edit
   or delete that comment.
3. **Given** pending comments exist, **When** the user sends, **Then** all pending comments are
   delivered in one prompt and the markers are cleared after successful delivery.
4. **Given** pending comments exist, **When** the page reloads or the user navigates within
   the same tab, **Then** pending comments for that page are not silently lost.

---

### User Story 4 - See what happened to a comment (Priority: P3)

After sending, the developer wants to know that Claude received the comment and is working on
it, without switching to the terminal.

**Why this priority**: Nice feedback, but the user can always look at the terminal.

**Independent Test**: Send a comment and verify the extension shows its delivery status.

**Acceptance Scenarios**:

1. **Given** a comment was sent, **When** the user opens the extension, **Then** they see a
   short history of recent sends for this page with status (delivered / failed).
2. **Given** a comment was sent, **When** Claude works on it, **Then** the browser shows only
   the delivery status; Claude's reply and progress stay in the Claude Code session.

---

### Edge Cases

- The selected element is inside an iframe, a shadow DOM, or is very small or very large
  (e.g. the whole page body).
- The user wants the parent of the hovered element; there MUST be a way to widen or narrow the
  selection (e.g. keyboard keys to move to parent / child).
- The page changes (re-renders, scrolls, resizes) while the comment box is open; the outline
  and box MUST follow the element or close cleanly if it disappears.
- The page has its own keyboard shortcuts or high `z-index` overlays that conflict with the
  picker UI.
- The comment is empty or only whitespace: sending is disabled.
- The comment is very long (e.g. 10,000 characters).
- The element's HTML is huge; the element description sent to Claude MUST be bounded in size.
- The page is a browser-internal page (e.g. `about:` pages) where extensions cannot run: the
  extension MUST say pick mode is not available there.
- The page shows sensitive data (passwords, tokens) inside the selected element.
- Narrow browser window (320px): comment box MUST still fit and be usable.

## Requirements *(mandatory)*

### Functional Requirements

**Picking**

- **FR-001**: Users MUST be able to turn pick mode on and off from the toolbar button and from a
  keyboard shortcut.
- **FR-002**: In pick mode, the system MUST highlight the element under the pointer and MUST
  prevent the page from receiving the clicks used for picking.
- **FR-003**: Users MUST be able to move the selection to the parent or child element with the
  keyboard before confirming.
- **FR-004**: The system MUST show the selected element's short label (e.g. tag and class or
  component name) while hovering, so the user knows what will be selected.
- **FR-005**: Leaving pick mode MUST restore the page completely: no leftover outlines,
  listeners, or layout changes.

**Commenting**

- **FR-006**: After selection, the system MUST show a comment box anchored to the element, with
  a text field, **Send to Claude**, **Add comment**, and close controls.
- **FR-007**: Sending MUST be disabled while the comment is empty or whitespace-only.
- **FR-008**: Pending comments (from **Add comment**) MUST be shown as markers on their elements
  and MUST be editable and removable before sending.

**Element context**

- **FR-009**: Each sent comment MUST include: the comment text, the page URL and title, a
  unique selector path to the element, the element's tag, id, classes, and visible text
  (truncated), a bounded HTML snippet of the element, its size and position on the page, and
  the viewport size. If the page exposes a source-component name or source-file location for
  the element (as development builds of common UI frameworks do), that MUST be included too.

**Session targeting**

- **FR-010**: The system MUST deliver each comment to exactly one running Claude Code session,
  chosen as follows: the system suggests a session by matching the page to a session's
  project; the first time the user sends from a site (origin), they confirm the suggestion or
  pick another session from the list; the choice is remembered for that site and can be
  changed at any time. If the remembered session is no longer running, the system MUST ask
  again instead of guessing.
- **FR-011**: The system MUST show the current target session (project name and working
  directory) in the extension UI before the user sends.
- **FR-012**: The system MUST list currently running sessions that are able to receive
  comments, and MUST update this list when sessions start or end.
- **FR-013**: The system MUST NOT deliver a comment to any session other than the chosen one,
  and MUST NOT broadcast to several sessions.
- **FR-014**: The delivered comment MUST appear in the target session as a user prompt that
  Claude acts on, without the user typing anything in the terminal.

**Delivery and errors**

- **FR-015**: The system MUST tell the user whether delivery succeeded or failed, within
  2 seconds of sending.
- **FR-016**: On failure, the system MUST keep the comment text and its element context so the
  user can retry or choose another session.
- **FR-017**: Only Claude Code sessions on the user's own machine MUST be able to receive
  comments; no comment or page content may leave the machine through the extension itself.
- **FR-018**: Other web pages and other local programs MUST NOT be able to inject prompts into
  a Claude Code session through this system.

**Presentation**

- **FR-019**: All extension UI (picker overlay, comment box, toolbar popup) MUST be usable at
  browser widths from 320px upward and at 200% zoom, and MUST follow the browser's light/dark
  preference.
- **FR-020**: Picker UI injected into the page MUST NOT change the layout or styles of the page
  itself, and page styles MUST NOT break the picker UI.

### Key Entities

- **Selection**: one picked element on a page. Holds page URL, selector path, element
  description, bounded HTML snippet, geometry, and optional source-component hint.
- **Comment**: text written by the user, linked to one Selection. State: pending, sending,
  delivered, failed.
- **Batch**: one or more Comments sent together as one prompt to one Session.
- **Session**: one running Claude Code session that can receive comments. Identified to the
  user by project name and working directory.
- **Site binding**: the remembered link between a site (origin) and its confirmed target
  Session (FR-010).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From turning on pick mode to the comment arriving in the session takes under
  15 seconds for a one-line comment, for a user who has done it once before.
- **SC-002**: In testing with two or more sessions running, 100% of comments arrive in the
  intended session and 0% arrive in any other session.
- **SC-003**: Delivery confirmation (success or failure) is shown in under 2 seconds in 99% of
  sends.
- **SC-004**: For comments on pages of a project whose source is in the session's working
  directory, Claude locates the right component in source on the first try in at least 80% of
  cases, using only the delivered element context.
- **SC-005**: Highlighting follows the pointer with no visible lag, and turning pick mode on or
  off causes no visible change to the page other than the picker UI.
- **SC-006**: No comment text is ever lost because of a failed delivery or a closed session.

## Assumptions

- Single user on their own computer; the browser and the Claude Code sessions run on the same
  machine. Remote or shared sessions are out of scope.
- Primary target is local development sites (e.g. `localhost`), but picking works on any
  normal web page the user activates it on.
- A small local helper component (outside the browser) is acceptable if needed to connect the
  extension to Claude Code sessions; it must be easy to install and is part of this feature.
- Sessions that should receive comments may need a one-time opt-in or setup step; that is
  acceptable.
- The comment is delivered as text context; a screenshot of the element is not included in
  this version.
- Firefox desktop only. Other browsers and Firefox for Android are out of scope.
- Showing Claude's replies or progress in the browser is out of scope; the browser shows
  delivery status only.
