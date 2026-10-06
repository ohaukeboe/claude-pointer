# claude-pointer Constitution

## Core Principles

### I. Small, Focused Extension

claude-pointer is a small Firefox extension and MUST stay small.

- Every feature MUST serve the extension's single core purpose; unrelated features are rejected.
- Code MUST use the standard WebExtensions APIs (`browser.*` namespace) supported by current
  Firefox release and Firefox ESR.
- Runtime dependencies MUST be justified in the plan; prefer platform APIs over libraries.
- YAGNI: no speculative abstractions, configuration, or extension points.

Rationale: a small codebase is easier to test fully, review quickly, and keep fast.

### II. Test-First, Well-Tested (NON-NEGOTIABLE)

- Tests MUST be written before the implementation, and MUST fail before the code is written
  (red → green → refactor).
- All logic (background scripts, content scripts, utilities) MUST have unit tests that run
  without a browser, with WebExtensions APIs mocked at a single seam.
- Every user-facing flow MUST have at least one automated end-to-end test that loads the
  built extension in a real Firefox instance (headless in CI).
- Every fixed bug MUST get a regression test that fails without the fix.
- Tests MUST be deterministic: no reliance on network, wall-clock timing, or test order.
- Line coverage for non-UI logic MUST stay at or above 90%; a drop below blocks the merge.

Rationale: browser extensions break silently across Firefox updates and site changes;
automated tests are the only reliable signal.

### III. Responsive Layout

- Every UI surface (popup, options page, sidebar, injected page elements) MUST be usable
  and free of horizontal scrolling at widths from 320px up to full desktop width.
- Layouts MUST use fluid units (flexbox/grid, `rem`, `%`) and MUST NOT depend on fixed
  pixel widths for containers.
- UI MUST remain usable at 200% browser zoom and MUST respect `prefers-color-scheme` and
  `prefers-reduced-motion`.
- Injected UI MUST NOT break or shift the host page layout outside its own elements.
- Responsive behaviour MUST be covered by automated tests at minimum 320px, 768px and
  1280px viewport widths.

Rationale: the extension runs on arbitrary pages, window sizes, and devices; it MUST look
and work correctly in all of them.

### IV. Responsive Performance

- User interactions MUST give visible feedback within 100ms.
- Content scripts MUST NOT run synchronous tasks longer than 50ms on the page main thread;
  heavier work MUST be chunked, deferred, or moved to the background script.
- Content scripts MUST load only on pages where needed and MUST NOT measurably slow page
  load.
- Event listeners and observers MUST be removed when no longer needed; no leaks across
  navigations.

Rationale: an extension that makes browsing feel slow gets uninstalled.

### V. Least Privilege & Privacy

- The manifest MUST request only permissions a shipped feature uses; each permission MUST
  be justified in the plan. Prefer optional and `activeTab` permissions over broad host
  permissions.
- The extension MUST NOT load or execute remote code and MUST NOT use `eval` or equivalents.
- No user data leaves the browser unless a feature explicitly requires it and the user is
  told. No telemetry.
- Content from web pages MUST be treated as untrusted; DOM insertion MUST NOT use
  `innerHTML` with page-derived data.

Rationale: these rules are required by addons.mozilla.org review and protect users.

## Technical Constraints

- Target: current Firefox release and Firefox ESR. The supported Manifest version is fixed
  in the plan of the first feature and changed only by amendment of the plan.
- `web-ext lint` MUST pass with zero errors and zero warnings.
- The build MUST be reproducible from a clean checkout with one documented command.
- Source code MUST be readable as shipped or built by a documented, reproducible step, so
  addons.mozilla.org source review is possible.

## Development Workflow & Quality Gates

A change merges only when all gates pass:

1. Unit tests pass and coverage meets Principle II.
2. End-to-end tests pass in headless Firefox, including responsive viewport tests
   (Principle III).
3. `web-ext lint` passes (Technical Constraints).
4. Linter and formatter pass with no errors.
5. Manual smoke test: load the built extension through `about:debugging` and run the
   changed flow once.

Each feature plan MUST include a "Constitution Check" that maps the feature to each
principle, and MUST justify any deviation in its Complexity Tracking section.

## Governance

- This constitution supersedes other project practices. Where `CLAUDE.md` or `AGENTS.md`
  conflict with it, this file wins for product and engineering rules.
- Amendments are made through `/speckit-constitution`, with a Sync Impact Report and a
  version bump:
  - MAJOR: a principle removed or redefined incompatibly.
  - MINOR: a principle or section added, or guidance materially expanded.
  - PATCH: wording or clarification only.
- Every spec, plan, and review MUST verify compliance with these principles. Unjustified
  deviations block the merge.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
