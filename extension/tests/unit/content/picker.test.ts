import { afterEach, describe, expect, it, vi } from "vitest";
import { Picker, labelFor } from "../../../src/content/picker";

const pickers: Picker[] = [];
afterEach(() => pickers.splice(0).forEach((p) => p.stop()));

function setup(
  markup = `<main><section><button id="b" class="x y z">go</button></section></main>`,
) {
  document.body.innerHTML = markup; // test fixture only
  const host = document.createElement("div");
  document.body.append(host);
  const frames: FrameRequestCallback[] = [];
  const onHover = vi.fn();
  const onSelect = vi.fn();
  const onEscape = vi.fn();
  let hit: Element | null = null;
  const picker = new Picker({
    win: window,
    isOwnUi: (n) => n === host || host.contains(n as Node),
    hitTest: () => hit,
    raf: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    onHover,
    onSelect,
    onEscape,
  });
  pickers.push(picker);
  const flush = () => frames.splice(0).forEach((f) => f(0));
  return {
    picker,
    host,
    onHover,
    onSelect,
    onEscape,
    flush,
    setHit: (el: Element | null) => (hit = el),
  };
}

const $ = (s: string) => document.querySelector(s) as HTMLElement;

describe("labelFor", () => {
  it("is tag#id.classes with at most two classes", () => {
    document.body.innerHTML = `<button id="b" class="x y z"></button><p></p>`;
    expect(labelFor($("button"))).toBe("button#b.x.y");
    expect(labelFor($("p"))).toBe("p");
  });
});

describe("Picker", () => {
  it("outlines the element under the pointer, throttled to one hit test per frame", () => {
    const t = setup();
    const hitTest = vi.fn(() => $("#b"));
    (t.picker as unknown as { opts: { hitTest: unknown } }).opts.hitTest = hitTest;
    t.picker.start();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 6, clientY: 6 }));
    expect(t.onHover).not.toHaveBeenCalled();
    t.flush();
    expect(hitTest).toHaveBeenCalledTimes(1);
    expect(t.onHover).toHaveBeenCalledWith($("#b"));
    expect(t.picker.hovered).toBe($("#b"));
  });

  it("blocks page mouse/pointer events in the capture phase (FR-002)", () => {
    const t = setup();
    const pageHandler = vi.fn();
    $("#b").addEventListener("click", pageHandler);
    $("#b").addEventListener("mousedown", pageHandler);
    $("#b").addEventListener("pointerdown", pageHandler);
    t.picker.start();
    for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick"]) {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
      $("#b").dispatchEvent(ev);
      expect(ev.defaultPrevented, type).toBe(true);
    }
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it("selects the hovered element on click", () => {
    const t = setup();
    t.picker.start();
    t.setHit($("#b"));
    window.dispatchEvent(new MouseEvent("mousemove"));
    t.flush();
    $("main").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(t.onSelect).toHaveBeenCalledWith($("#b"));
  });

  it("falls back to the click target when nothing is hovered", () => {
    const t = setup();
    t.picker.start();
    $("#b").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(t.onSelect).toHaveBeenCalledWith($("#b"));
  });

  it("does not block or select events from its own UI", () => {
    const t = setup();
    t.picker.start();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    t.host.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(t.onSelect).not.toHaveBeenCalled();
  });

  it("moves to parent and child with Alt+ArrowUp / Alt+ArrowDown and selects with Enter (FR-003)", () => {
    const t = setup();
    t.picker.start();
    t.picker.setHovered($("#b"));
    const key = (k: string, alt = true) => {
      const ev = new KeyboardEvent("keydown", {
        key: k,
        altKey: alt,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(ev);
      return ev;
    };
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(t.picker.hovered).toBe($("section"));
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowUp");
    expect(t.picker.hovered).toBe(document.body); // stops at body
    key("ArrowDown");
    expect(t.picker.hovered).toBe($("main"));
    key("Enter", false);
    expect(t.onSelect).toHaveBeenCalledWith($("main"));
  });

  it("hides picker keys from page handlers but lets other keys through", () => {
    const t = setup();
    const page = vi.fn();
    document.body.addEventListener("keydown", page);
    t.picker.start();
    t.picker.setHovered($("#b"));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
    );
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(page).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("reports Escape", () => {
    const t = setup();
    t.picker.start();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(t.onEscape).toHaveBeenCalled();
  });

  it("lets keys from its own UI through untouched (typing in the comment box)", () => {
    const t = setup();
    t.picker.start();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    t.host.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(t.onSelect).not.toHaveBeenCalled();
  });

  it("pauses hovering while paused but keeps blocking page clicks", () => {
    const t = setup();
    t.picker.start();
    t.picker.pause();
    t.setHit($("#b"));
    window.dispatchEvent(new MouseEvent("mousemove"));
    t.flush();
    expect(t.onHover).not.toHaveBeenCalled();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    $("#b").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(t.onSelect).not.toHaveBeenCalled();
    t.picker.resume();
    window.dispatchEvent(new MouseEvent("mousemove"));
    t.flush();
    expect(t.onHover).toHaveBeenCalled();
  });

  it("removes every listener it added on stop (FR-005)", () => {
    const added: unknown[][] = [];
    const removed: unknown[][] = [];
    const add = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((...a: unknown[]) => void added.push(a));
    const rem = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation((...a: unknown[]) => void removed.push(a));
    const t = setup();
    t.picker.start();
    t.picker.stop();
    expect(added.length).toBeGreaterThan(0);
    expect(removed).toEqual(added);
    add.mockRestore();
    rem.mockRestore();
    // after stop, page events are no longer blocked
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    $("#b").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("start and stop are idempotent", () => {
    const t = setup();
    t.picker.start();
    t.picker.start();
    t.picker.stop();
    t.picker.stop();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    $("#b").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("defaultHitTest", () => {
  it("returns the element under the point and descends into same-origin iframes", async () => {
    const { defaultHitTest } = await import("../../../src/content/picker");
    document.body.innerHTML = `<p id="p">x</p>`;
    const p = document.querySelector("#p")!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(p);
    expect(defaultHitTest(document, 1, 1)).toBe(p);

    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument!;
    inner.body.innerHTML = `<b id="b">in</b>`;
    const b = inner.querySelector("#b")!;
    frame.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(frame);
    const innerHit = vi.spyOn(inner, "elementFromPoint").mockReturnValue(b);
    expect(defaultHitTest(document, 15, 25)).toBe(b);
    expect(innerHit).toHaveBeenCalledWith(5, 5);
    innerHit.mockReturnValue(null);
    expect(defaultHitTest(document, 15, 25)).toBe(frame);
  });
});

describe("same-origin iframes", () => {
  it("listens in iframe windows and hit-tests in the event's document", async () => {
    const { Picker: P } = await import("../../../src/content/picker");
    document.body.innerHTML = `<iframe></iframe>`;
    const frame = document.querySelector("iframe")!;
    const inner = frame.contentDocument!;
    inner.body.innerHTML = `<b id="b">x</b>`;
    const b = inner.querySelector("#b")!;
    const hitTest = vi.fn((_x: number, _y: number, d: Document) => (d === inner ? b : null));
    const onSelect = vi.fn();
    const p = new P({
      win: window,
      isOwnUi: () => false,
      hitTest,
      raf: (cb) => (cb(0), 1),
      onHover: vi.fn(),
      onSelect,
      onEscape: vi.fn(),
    });
    pickers.push(p);
    p.start();
    b.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 3, clientY: 4 }));
    expect(hitTest).toHaveBeenCalledWith(3, 4, inner);
    expect(p.hovered).toBe(b);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    b.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(b);
    p.stop();
    const after = new MouseEvent("click", { bubbles: true, cancelable: true });
    b.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
