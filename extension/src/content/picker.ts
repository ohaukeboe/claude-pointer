// Pick mode: hover highlight, click capture and keyboard navigation (FR-001..FR-005).
// Pure input logic; drawing is done by the overlay through the callbacks.

export interface PickerOptions {
  win: Window;
  /** True for nodes that belong to our own UI (events from it are never blocked). */
  isOwnUi(node: EventTarget | null): boolean;
  /** Element at a point of `doc`'s viewport (events from iframes carry iframe coordinates). */
  hitTest(x: number, y: number, doc: Document): Element | null;
  raf(cb: FrameRequestCallback): number;
  onHover(el: Element | null): void;
  onSelect(el: Element): void;
  onEscape(): void;
}

const BLOCKED = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
];

export function labelFor(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const classes = Array.from(el.classList)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  return `${el.localName}${id}${classes}`;
}

/** Element under a point, descending into same-origin iframes. Skips nothing else. */
export function defaultHitTest(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint(x, y);
  let ox = x;
  let oy = y;
  while (el && el.localName === "iframe") {
    let inner: Document | null = null;
    try {
      inner = (el as HTMLIFrameElement).contentDocument;
    } catch {
      inner = null;
    }
    if (!inner) break;
    const r = el.getBoundingClientRect();
    ox -= r.left;
    oy -= r.top;
    const next = inner.elementFromPoint(ox, oy);
    if (!next) break;
    el = next;
  }
  return el;
}

/** The window plus every same-origin iframe window below it. */
export function sameOriginWindows(win: Window): Window[] {
  const out: Window[] = [win];
  for (const frame of Array.from(win.document.querySelectorAll("iframe, frame"))) {
    try {
      const child = (frame as HTMLIFrameElement).contentWindow;
      if (child && child.document) out.push(...sameOriginWindows(child));
    } catch {
      // cross-origin frame: not pickable
    }
  }
  return out;
}

export class Picker {
  hovered: Element | null = null;
  private active = false;
  private paused = false;
  private frame = 0;
  private lastX = 0;
  private lastY = 0;
  private lastDoc: Document | null = null;
  private windows: Window[] = [];
  private readonly listeners: [string, EventListener][];

  constructor(private readonly opts: PickerOptions) {
    this.listeners = [
      ["mousemove", this.onMove as EventListener],
      ["keydown", this.onKey as EventListener],
      ...BLOCKED.map((t): [string, EventListener] => [t, this.onPointer as EventListener]),
    ];
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.paused = false;
    this.windows = sameOriginWindows(this.opts.win);
    for (const w of this.windows)
      for (const [type, fn] of this.listeners) w.addEventListener(type, fn, true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.hovered = null;
    for (const w of this.windows)
      for (const [type, fn] of this.listeners) w.removeEventListener(type, fn, true);
    this.windows = [];
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setHovered(el: Element | null): void {
    this.hovered = el;
    this.opts.onHover(el);
  }

  private readonly onMove = (e: MouseEvent): void => {
    if (this.paused) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Duck-typed: nodes from iframes belong to another realm, so `instanceof` fails.
    const t = e.target as Partial<Node> | null;
    this.lastDoc = t?.nodeType === 9 ? (t as Document) : (t?.ownerDocument ?? null);
    if (this.frame) return;
    this.frame = this.opts.raf(() => {
      this.frame = 0;
      if (!this.active || this.paused) return;
      const doc = this.lastDoc && this.lastDoc.defaultView ? this.lastDoc : this.opts.win.document;
      const el = this.opts.hitTest(this.lastX, this.lastY, doc);
      if (el && this.opts.isOwnUi(el)) return;
      if (el !== this.hovered) this.setHovered(el);
    });
  };

  private readonly onPointer = (e: MouseEvent): void => {
    if (this.opts.isOwnUi(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "click" || this.paused) return;
    const target = e.target as Partial<Element> | null;
    const el = this.hovered ?? (target?.nodeType === 1 ? (target as Element) : null);
    if (el) this.opts.onSelect(el);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.opts.isOwnUi(e.target)) return;
    const swallow = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === "Escape") {
      swallow();
      this.opts.onEscape();
      return;
    }
    if (this.paused || !this.hovered) return;
    const el = this.hovered;
    const body = el.ownerDocument.body;
    if (e.altKey && e.key === "ArrowUp") {
      swallow();
      if (el !== body && el.parentElement) this.setHovered(el.parentElement);
    } else if (e.altKey && e.key === "ArrowDown") {
      swallow();
      if (el.firstElementChild) this.setHovered(el.firstElementChild);
    } else if (e.key === "Enter") {
      swallow();
      this.opts.onSelect(el);
    }
  };
}
