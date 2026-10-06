// Hover/selection outline with a short element label (FR-002, FR-004).

import { h } from "./root";

export interface Outline {
  show(rect: { left: number; top: number; width: number; height: number }, label: string): void;
  hide(): void;
  destroy(): void;
}

export function createOutline(layer: HTMLElement, doc: Document = document): Outline {
  const label = h(doc, "div", { class: "outline-label", "data-role": "outline-label" });
  const box = h(doc, "div", { class: "outline", "data-role": "outline", hidden: true }, label);
  layer.append(box);
  return {
    show(rect, text) {
      box.hidden = false;
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      label.textContent = text;
      label.classList.toggle("below", rect.top < 24);
    },
    hide() {
      box.hidden = true;
    },
    destroy() {
      box.remove();
    },
  };
}
