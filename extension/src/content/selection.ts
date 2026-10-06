// Builds a Selection for a picked element (FR-009, research R9).

import type { Selection, SourceHint } from "../../../shared/types";
import { boundSelection, collapseWhitespace, LIMITS, truncate } from "../../../shared/validate";

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/^-?\d|[^\w-]/g, (ch) => `\\${ch.codePointAt(0)!.toString(16)} `);
}

function isUnique(doc: Document, selector: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function step(el: Element): string {
  const tag = el.localName;
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.localName === tag);
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag;
}

/** Shortest `a > b > c` path (from the element upward) that matches exactly this element. */
export function selectorPath(el: Element): string {
  const doc = el.ownerDocument;
  if (el === doc.documentElement) return "html";
  if (el === doc.body) return "body";
  if (el.id && isUnique(doc, `#${cssEscape(el.id)}`, el)) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.documentElement) {
    if (node !== el && node.id && isUnique(doc, `#${cssEscape(node.id)}`, node)) {
      parts.unshift(`#${cssEscape(node.id)}`);
    } else {
      parts.unshift(node === doc.body ? "body" : step(node));
    }
    const candidate = parts.join(" > ");
    if (isUnique(doc, candidate, el)) return candidate;
    node = node.parentElement;
  }
  return ["html", ...parts].join(" > ");
}

/** outerHTML of a copy with script/style bodies and password values removed. */
export function sanitisedHtml(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  const nodes = [copy, ...Array.from(copy.querySelectorAll("*"))];
  for (const n of nodes) {
    const tag = n.localName;
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") {
      n.textContent = "";
    } else if (tag === "input" && (n.getAttribute("type") ?? "").toLowerCase() === "password") {
      n.removeAttribute("value");
    }
  }
  // Truncate before the shared limit so huge elements do not keep big strings around.
  return truncate(copy.outerHTML, LIMITS.html);
}

export function buildSelection(el: Element, source: SourceHint | null): Selection {
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;
  const r = el.getBoundingClientRect();
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return boundSelection({
    url: location.href,
    title: document.title,
    selector: selectorPath(el),
    tag: el.localName,
    id: el.id || null,
    classes: Array.from(el.classList),
    text: collapseWhitespace(text),
    html: sanitisedHtml(el),
    rect: {
      x: Math.round(r.left + win.scrollX),
      y: Math.round(r.top + win.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    source,
    frame: doc !== document ? doc.URL : null,
  });
}
