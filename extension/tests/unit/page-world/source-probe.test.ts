import { describe, expect, it } from "vitest";
import { findSource } from "../../../src/page-world/source-probe";
import { parseHint, probeSource } from "../../../src/content/probe";

function el(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.body.firstElementChild as HTMLElement;
}

describe("findSource (page world)", () => {
  it("reads build-plugin attributes", () => {
    expect(findSource(el(`<div data-insp-path="src/App.tsx:12:4"></div>`))).toEqual({
      component: null,
      file: "src/App.tsx",
      line: 12,
      column: 4,
      via: "attribute",
    });
    expect(
      findSource(el(`<div data-source="src/A.vue:3" data-component="A"></div>`)),
    ).toMatchObject({
      component: "A",
      file: "src/A.vue",
      line: 3,
      column: null,
    });
    expect(findSource(el(`<div data-locatorjs-id="weird"></div>`))).toMatchObject({
      file: "weird",
      line: null,
    });
  });

  it("walks up to an ancestor with a hint", () => {
    const root = el(`<section data-source="src/S.tsx:1:1"><p><b>x</b></p></section>`);
    expect(findSource(root.querySelector("b")!)).toMatchObject({ file: "src/S.tsx" });
  });

  it("reads Svelte __svelte_meta", () => {
    const e = el(`<p></p>`) as HTMLElement & { __svelte_meta?: unknown };
    e.__svelte_meta = { loc: { file: "src/lib/Card.svelte", line: 7, column: 2 } };
    expect(findSource(e)).toEqual({
      component: "Card",
      file: "src/lib/Card.svelte",
      line: 7,
      column: 2,
      via: "svelte",
    });
  });

  it("reads Vue 3 __vueParentComponent", () => {
    const e = el(`<p></p>`) as HTMLElement & { __vueParentComponent?: unknown };
    e.__vueParentComponent = { type: { __file: "/src/components/Queue.vue", __name: "Queue" } };
    expect(findSource(e)).toEqual({
      component: "Queue",
      file: "/src/components/Queue.vue",
      line: null,
      column: null,
      via: "vue",
    });
    e.__vueParentComponent = { type: { __file: "/src/X.vue" } };
    expect(findSource(e)).toMatchObject({ component: "X" });
    e.__vueParentComponent = { type: {} };
    expect(findSource(e)).toBeNull();
  });

  it("reads React fibers with _debugSource (React ≤18)", () => {
    const e = el(`<p></p>`) as unknown as Record<string, unknown>;
    function ReviewQueue() {}
    e["__reactFiber$abc"] = {
      type: "p",
      return: {
        type: ReviewQueue,
        _debugSource: { fileName: "src/Q.tsx", lineNumber: 9, columnNumber: 3 },
      },
    };
    expect(findSource(e as unknown as Element)).toEqual({
      component: "ReviewQueue",
      file: "src/Q.tsx",
      line: 9,
      column: 3,
      via: "react",
    });
  });

  it("reads React 19 _debugStack, skipping node_modules frames", () => {
    const e = el(`<p></p>`) as unknown as Record<string, unknown>;
    const Queue = { displayName: "Queue" };
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)",
      "    at Queue (http://localhost:5173/src/components/Queue.tsx?t=1:42:7)",
    ].join("\n");
    e["__reactFiber$x"] = { type: "div", _debugOwner: { type: Queue, _debugStack: { stack } } };
    expect(findSource(e as unknown as Element)).toEqual({
      component: "Queue",
      file: "/src/components/Queue.tsx",
      line: 42,
      column: 7,
      via: "react",
    });
    e["__reactFiber$x"] = {
      type: "div",
      return: { type: Queue, _debugStack: { stack: "no frames" } },
    };
    expect(findSource(e as unknown as Element)).toMatchObject({ component: "Queue", file: null });
  });

  it("returns null for plain elements and fibers without components", () => {
    expect(findSource(el(`<p></p>`))).toBeNull();
    const e = el(`<p></p>`) as unknown as Record<string, unknown>;
    e["__reactFiber$q"] = { type: "p", return: null };
    expect(findSource(e as unknown as Element)).toBeNull();
  });
});

describe("probe round trip (content <-> page world)", () => {
  it("answers through DOM events with a validated hint", () => {
    const e = el(`<div data-source="src/A.tsx:4:2"></div>`);
    expect(probeSource(e)).toEqual({
      component: null,
      file: "src/A.tsx",
      line: 4,
      column: 2,
      via: "attribute",
    });
  });

  it("returns null when nothing answers or the element has no hint", () => {
    expect(probeSource(el(`<p></p>`))).toBeNull();
  });
});

describe("parseHint (untrusted page answer)", () => {
  it("rejects non-strings, bad JSON, bad via and empty hints", () => {
    expect(parseHint(42)).toBeNull();
    expect(parseHint("{")).toBeNull();
    expect(parseHint("null")).toBeNull();
    expect(parseHint(JSON.stringify({ via: "evil", file: "x" }))).toBeNull();
    expect(parseHint(JSON.stringify({ via: "react" }))).toBeNull();
  });

  it("bounds string sizes and coerces numbers", () => {
    const h = parseHint(
      JSON.stringify({
        via: "react",
        component: "C".repeat(500),
        file: "f".repeat(1000),
        line: 3.7,
        column: "x",
      }),
    );
    expect(h!.component).toHaveLength(120);
    expect(h!.file).toHaveLength(300);
    expect(h!.line).toBe(3);
    expect(h!.column).toBeNull();
  });
});
