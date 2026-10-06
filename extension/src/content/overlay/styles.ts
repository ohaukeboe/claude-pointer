// Styles for all injected UI. Lives inside the shadow root; `!important` on :host wins over
// page !important rules because the shadow context has priority for important declarations.

export const OVERLAY_CSS = `
:host {
  all: initial !important;
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  overflow: visible !important;
  pointer-events: none !important;
  z-index: 2147483647 !important;
  display: block !important;
  color-scheme: light dark;
}
:host(:not(:popover-open)) { display: block !important; }

.layer {
  --cp-bg: #ffffff;
  --cp-fg: #1f1e1d;
  --cp-muted: #6b6a68;
  --cp-border: #d6d3cd;
  --cp-field: #faf9f7;
  --cp-accent: #c15f3c;
  --cp-accent-fg: #ffffff;
  --cp-outline: #2f6fed;
  --cp-outline-fill: rgba(47, 111, 237, 0.08);
  --cp-ok: #2e7d4f;
  --cp-error: #b3261e;
  --cp-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  position: fixed;
  inset: 0;
  pointer-events: none;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--cp-fg);
}
@media (prefers-color-scheme: dark) {
  .layer {
    --cp-bg: #262624;
    --cp-fg: #f0eee9;
    --cp-muted: #a8a59f;
    --cp-border: #45433f;
    --cp-field: #1f1e1d;
    --cp-accent: #d97757;
    --cp-outline: #6b9bff;
    --cp-outline-fill: rgba(107, 155, 255, 0.1);
    --cp-ok: #7fcf9b;
    --cp-error: #ff8a80;
    --cp-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  }
}

.outline {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid var(--cp-outline);
  background: var(--cp-outline-fill);
  border-radius: 3px;
  pointer-events: none;
  transition: all 60ms ease-out;
}
.outline[hidden] { display: none; }
.outline-label {
  position: absolute;
  left: -2px;
  bottom: 100%;
  margin-bottom: 4px;
  max-width: min(24rem, calc(100vw - 1rem));
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--cp-outline);
  color: #fff;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.outline-label.below { bottom: auto; top: 100%; margin: 4px 0 0; }

.panel {
  position: fixed;
  box-sizing: border-box;
  width: min(28rem, calc(100vw - 1rem));
  max-height: calc(100vh - 1rem);
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--cp-border);
  border-radius: 10px;
  background: var(--cp-bg);
  color: var(--cp-fg);
  box-shadow: var(--cp-shadow);
  pointer-events: auto;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.panel-title { font-weight: 600; flex: 0 0 auto; }
.panel-label {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--cp-muted);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 5.5rem;
  max-height: 40vh;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--cp-border);
  border-radius: 8px;
  background: var(--cp-field);
  color: var(--cp-fg);
  font: inherit;
}
textarea:focus-visible, button:focus-visible, input:focus-visible {
  outline: 2px solid var(--cp-outline);
  outline-offset: 1px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
button {
  box-sizing: border-box;
  min-height: 2rem;
  padding: 4px 12px;
  border: 1px solid var(--cp-border);
  border-radius: 8px;
  background: transparent;
  color: var(--cp-fg);
  font: inherit;
  cursor: pointer;
}
button.primary {
  border-color: var(--cp-accent);
  background: var(--cp-accent);
  color: var(--cp-accent-fg);
}
button:disabled { opacity: 0.5; cursor: default; }
button[hidden] { display: none; }
button.icon {
  margin-left: auto;
  min-height: 0;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  font-size: 18px;
  line-height: 1;
}
.status { min-height: 1.2em; margin-top: 8px; font-size: 13px; color: var(--cp-muted); overflow-wrap: anywhere; }
.status[data-kind="ok"] { color: var(--cp-ok); }
.status[data-kind="error"] { color: var(--cp-error); }
.status:empty { display: none; }

.sessions { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.sessions label {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  padding: 8px;
  border: 1px solid var(--cp-border);
  border-radius: 8px;
  cursor: pointer;
}
.sessions input { grid-row: span 2; margin: 2px 0 0; }
.session-name { font-weight: 600; overflow-wrap: anywhere; }
.session-dir {
  color: var(--cp-muted);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
.session-reason {
  font-size: 12px;
  color: var(--cp-accent);
  font-weight: 500;
}
.hint { margin: 0 0 8px; color: var(--cp-muted); font-size: 13px; }

.marker {
  position: fixed;
  box-sizing: border-box;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 6px;
  border: 2px solid var(--cp-bg);
  border-radius: 999px;
  background: var(--cp-accent);
  color: var(--cp-accent-fg);
  font: 600 12px/1.25rem system-ui, sans-serif;
  text-align: center;
  pointer-events: auto;
  cursor: pointer;
  box-shadow: var(--cp-shadow);
}
.marker[data-state="failed"] { background: var(--cp-error); }

@media (prefers-reduced-motion: reduce) {
  .outline { transition: none; }
}
`;
