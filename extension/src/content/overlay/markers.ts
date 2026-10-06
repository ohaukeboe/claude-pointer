// Numbered markers for pending comments (US3).

import type { Comment } from "../../../../shared/types";
import { h } from "./root";

export interface PlacedComment {
  comment: Comment;
  el: Element | null;
}

export interface Markers {
  render(
    items: PlacedComment[],
    rectOf: (el: Element) => { left: number; top: number; width: number },
  ): void;
  destroy(): void;
}

export function createMarkers(
  layer: HTMLElement,
  onClick: (id: string) => void,
  doc: Document = document,
): Markers {
  const container = h(doc, "div", { "data-role": "markers" });
  const notice = h(doc, "div", { class: "panel notice", "data-role": "notice", hidden: true });
  notice.style.left = "8px";
  notice.style.bottom = "8px";
  layer.append(container, notice);
  return {
    render(items, rectOf) {
      container.replaceChildren(
        ...items.map(({ comment, el }, i) => {
          const m = h(
            doc,
            "button",
            {
              type: "button",
              class: "marker",
              "data-comment": comment.id,
              "data-state": comment.state,
              title: comment.text,
              "aria-label": `Pending comment ${i + 1}: ${comment.text}`,
              hidden: el === null,
            },
            String(i + 1),
          );
          if (el) {
            const r = rectOf(el);
            m.style.left = `${Math.max(4, r.left + r.width - 12)}px`;
            m.style.top = `${Math.max(4, r.top - 12)}px`;
          }
          m.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick(comment.id);
          });
          return m;
        }),
      );
      const missing = items.filter((x) => x.el === null).length;
      notice.hidden = missing === 0;
      notice.textContent =
        missing === 0
          ? ""
          : `${missing} pending comment${missing === 1 ? "" : "s"} could not be placed on this page; ${missing === 1 ? "it" : "they"} will still be sent.`;
    },
    destroy() {
      container.remove();
      notice.remove();
    },
  };
}
