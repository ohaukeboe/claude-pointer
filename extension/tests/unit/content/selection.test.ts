import { describe, expect, it } from "vitest";
import { buildSelection, sanitisedHtml, selectorPath } from "../../../src/content/selection";

function html(markup: string): void {
  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  document.body.replaceChildren(
    ...Array.from(doc.body.childNodes).map((n) => document.importNode(n, true)),
  );
}

const $ = (s: string) => document.querySelector(s) as HTMLElement;

describe("selectorPath", () => {
  it("uses a unique id", () => {
    html(`<div><p id="intro">a</p></div>`);
    expect(selectorPath($("#intro"))).toBe("#intro");
  });

  it("escapes ids with special characters", () => {
    html(`<p id="a:b.c">x</p>`);
    const sel = selectorPath($("p"));
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe($("p"));
  });

  it("ignores duplicated ids", () => {
    html(`<p id="d">1</p><p id="d">2</p>`);
    const second = document.querySelectorAll("p")[1] as HTMLElement;
    const sel = selectorPath(second);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(second);
  });

  it("is unique for id-less repeated siblings in nested structures", () => {
    html(`
      <main><section><ul><li>a</li><li>b</li><li><span>c</span><span>d</span></li></ul></section>
      <section><ul><li>a</li><li><span>x</span></li></ul></section></main>`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
      const sel = selectorPath(el);
      expect(document.querySelectorAll(sel), sel).toHaveLength(1);
      expect(document.querySelector(sel), sel).toBe(el);
    }
  });

  it("uses a short suffix when it is already unique", () => {
    html(`<main><table class="queue"><tr><td>x</td></tr></table></main>`);
    expect(selectorPath($("table"))).toBe("table");
  });

  it("returns body and html for the root elements", () => {
    expect(selectorPath(document.body)).toBe("body");
    expect(selectorPath(document.documentElement)).toBe("html");
  });
});

describe("sanitisedHtml", () => {
  it("drops script and style contents", () => {
    html(`<div><script>steal()</script><style>p{}</style><p>ok</p></div>`);
    const out = sanitisedHtml($("div"));
    expect(out).not.toContain("steal");
    expect(out).not.toContain("p{}");
    expect(out).toContain("<p>ok</p>");
  });

  it("removes password values", () => {
    html(`<form><input type="password" value="hunter2"><input type="text" value="name"></form>`);
    const out = sanitisedHtml($("form"));
    expect(out).not.toContain("hunter2");
    expect(out).toContain("name");
  });

  it("does not modify the live element", () => {
    html(`<div><input type="password" value="hunter2"></div>`);
    sanitisedHtml($("div"));
    expect(($("input") as HTMLInputElement).getAttribute("value")).toBe("hunter2");
  });
});

describe("buildSelection", () => {
  it("collects element context with limits applied", () => {
    document.title = "T".repeat(300);
    html(`<table id="q" class="${Array.from({ length: 25 }, (_, i) => `c${i}`).join(" ")}"><tr><td>  Review
      queue  </td></tr></table>`);
    const el = $("#q");
    el.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      width: 300.4,
      height: 99.6,
      right: 0,
      bottom: 0,
      toJSON() {},
    });
    const sel = buildSelection(el, null);
    expect(sel.url).toBe(location.href);
    expect(sel.title).toHaveLength(200);
    expect(sel.selector).toBe("#q");
    expect(sel.tag).toBe("table");
    expect(sel.id).toBe("q");
    expect(sel.classes).toHaveLength(20);
    expect(sel.text).toBe("Review queue");
    expect(sel.html.startsWith("<table")).toBe(true);
    expect(sel.rect).toEqual({ x: 10 + scrollX, y: 20 + scrollY, width: 300, height: 100 });
    expect(sel.viewport).toEqual({ width: innerWidth, height: innerHeight });
    expect(sel.source).toBeNull();
    expect(sel.frame).toBeNull();
  });

  it("truncates long text to 500 chars and html to 4096 chars", () => {
    html(`<p>${"word ".repeat(2000)}</p>`);
    const sel = buildSelection($("p"), null);
    expect(sel.text).toHaveLength(500);
    expect(sel.text.endsWith("…")).toBe(true);
    expect(sel.html).toHaveLength(4096);
  });

  it("passes through a source hint", () => {
    html(`<p>x</p>`);
    const hint = { component: "P", file: null, line: null, column: null, via: "react" as const };
    expect(buildSelection($("p"), hint).source).toEqual(hint);
  });

  it("sets frame for elements in another document", () => {
    const doc = document.implementation.createHTMLDocument("inner");
    const p = doc.createElement("p");
    doc.body.append(p);
    const sel = buildSelection(p, null);
    expect(sel.frame).toBe(doc.URL);
  });
});
