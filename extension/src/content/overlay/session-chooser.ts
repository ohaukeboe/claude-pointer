// Session chooser shown before the first send from a site (FR-010, FR-012).

import type { Session, SessionSuggestion, SuggestionReason } from "../../../../shared/types";
import { h } from "./root";

export const REASON_LABEL: Record<SuggestionReason, string> = {
  "port-owner": "dev server",
  "name-match": "name match",
  recent: "most recent",
};

export interface ChooserOptions {
  suggestions: SessionSuggestion[];
  preselect: string | null;
  message?: string;
  onConfirm(session: Session): void;
  onCancel(): void;
}

export interface Chooser {
  el: HTMLElement;
  update(suggestions: SessionSuggestion[]): void;
  destroy(): void;
}

let seq = 0;

export function createChooser(o: ChooserOptions, doc: Document = document): Chooser {
  const name = `cp-session-${++seq}`;
  const list = h(doc, "ul", {
    class: "sessions",
    role: "radiogroup",
    "aria-label": "Claude Code sessions",
  });
  const confirm = h(
    doc,
    "button",
    { class: "primary", type: "button", "data-action": "confirm" },
    "Use this session",
  );
  const cancel = h(doc, "button", { type: "button", "data-action": "cancel" }, "Cancel");
  const el = h(
    doc,
    "section",
    {
      class: "panel session-chooser",
      role: "dialog",
      "aria-label": "Choose a Claude Code session",
    },
    h(
      doc,
      "div",
      { class: "panel-head" },
      h(doc, "span", { class: "panel-title" }, "Send to which session?"),
    ),
    h(
      doc,
      "p",
      { class: "hint", "data-role": "hint" },
      o.message ?? "Comments from this site will go to the session you choose.",
    ),
    list,
    h(doc, "div", { class: "actions" }, cancel, confirm),
  );

  let current = o.suggestions;
  let selected = o.preselect;
  const render = () => {
    if (!current.some((s) => s.session.id === selected)) selected = current[0]?.session.id ?? null;
    list.replaceChildren(
      ...current.map((s) => {
        const input = h(doc, "input", {
          type: "radio",
          name,
          value: s.session.id,
          checked: s.session.id === selected,
        });
        input.addEventListener("change", () => (selected = s.session.id));
        return h(
          doc,
          "li",
          {},
          h(
            doc,
            "label",
            { "data-session": s.session.id },
            input,
            h(
              doc,
              "span",
              { class: "session-name" },
              s.session.projectName,
              " ",
              h(doc, "span", { class: "session-reason" }, `· ${REASON_LABEL[s.reason]}`),
            ),
            h(doc, "span", { class: "session-dir" }, s.session.projectDir),
          ),
        );
      }),
    );
    confirm.disabled = selected === null;
  };
  render();

  confirm.addEventListener("click", () => {
    const pick = current.find((s) => s.session.id === selected);
    if (pick) o.onConfirm(pick.session);
  });
  cancel.addEventListener("click", () => o.onCancel());
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") o.onCancel();
  });

  return {
    el,
    update(suggestions) {
      current = suggestions;
      render();
    },
    destroy: () => el.remove(),
  };
}
