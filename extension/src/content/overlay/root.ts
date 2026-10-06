// One host element with a shadow root for all injected UI (FR-020, research R8).

import { OVERLAY_CSS } from "./styles";

declare const __CP_SHADOW_MODE__: ShadowRootMode | undefined;

// End-to-end builds use an open root so WebDriver can reach the UI.
const DEFAULT_MODE: ShadowRootMode =
  typeof __CP_SHADOW_MODE__ !== "undefined" ? __CP_SHADOW_MODE__ : "closed";

export interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  layer: HTMLElement;
  contains(node: unknown): boolean;
  bringToFront(): void;
  destroy(): void;
}

export function createOverlay(
  doc: Document = document,
  mode: ShadowRootMode = DEFAULT_MODE,
): Overlay {
  const host = doc.createElement("claude-pointer-ui");
  host.setAttribute("popover", "manual");
  const root = host.attachShadow({ mode });
  const style = doc.createElement("style");
  style.textContent = OVERLAY_CSS;
  const layer = doc.createElement("div");
  layer.className = "layer";
  root.append(style, layer);
  // Keep typing in our UI away from page shortcut handlers that listen in the bubble phase
  // (the retargeted event would look like a key press on a non-input element).
  for (const type of [
    "keydown",
    "keyup",
    "keypress",
    "input",
    "beforeinput",
    "paste",
    "copy",
    "cut",
  ]) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }
  doc.documentElement.append(host);

  const bringToFront = () => {
    if (typeof host.showPopover !== "function") return;
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {
      // Not connected or popover unsupported: z-index fallback in styles applies.
    }
  };
  bringToFront();

  // A page dialog or fullscreen element opened later sits above us; re-enter the top layer.
  const onTopLayerChange = () => bringToFront();
  doc.addEventListener("fullscreenchange", onTopLayerChange, true);
  const observer =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver((records) => {
          if (
            records.some((r) => r.attributeName === "open" && r.target instanceof HTMLDialogElement)
          ) {
            bringToFront();
          }
        })
      : null;
  observer?.observe(doc.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });

  return {
    host,
    root,
    layer,
    contains: (node) =>
      node === host || (node instanceof Node && (host.contains(node) || root.contains(node))),
    bringToFront,
    destroy: () => {
      observer?.disconnect();
      doc.removeEventListener("fullscreenchange", onTopLayerChange, true);
      host.remove();
    },
  };
}

/** Small DOM builder: no HTML strings anywhere (Principle V). */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children);
  return el;
}
