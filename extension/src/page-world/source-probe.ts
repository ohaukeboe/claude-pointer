// Runs in the page's main world (scripting world "MAIN"). No extension APIs. Read-only:
// answers probe requests with a JSON string describing the element's source (research R7).

(() => {
  const w = window as unknown as { __claudePointerProbe?: boolean };
  if (w.__claudePointerProbe) return;
  w.__claudePointerProbe = true;
  document.addEventListener(
    "claude-pointer:probe",
    (e) => {
      const el = e.target;
      let hint: unknown = null;
      try {
        hint = el instanceof Element ? findSource(el) : null;
      } catch {
        hint = null;
      }
      document.dispatchEvent(
        new CustomEvent("claude-pointer:probe-result", { detail: JSON.stringify(hint) }),
      );
    },
    true,
  );
})();

interface Hint {
  component: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
  via: "attribute" | "svelte" | "vue" | "react";
}

function parseLoc(value: string): { file: string; line: number | null; column: number | null } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(value);
  if (!m) return { file: value, line: null, column: null };
  return { file: m[1]!, line: Number(m[2]), column: m[3] ? Number(m[3]) : null };
}

export function findSource(start: Element): Hint | null {
  for (let el: Element | null = start; el; el = el.parentElement) {
    const hint = fromAttributes(el) ?? fromSvelte(el) ?? fromVue(el) ?? fromReact(el);
    if (hint) return hint;
  }
  return null;
}

function fromAttributes(el: Element): Hint | null {
  const value =
    el.getAttribute("data-insp-path") ??
    el.getAttribute("data-source") ??
    el.getAttribute("data-locatorjs-id");
  if (!value) return null;
  const loc = parseLoc(value);
  return { component: el.getAttribute("data-component") ?? null, ...loc, via: "attribute" };
}

function fromSvelte(el: Element): Hint | null {
  const meta = (
    el as unknown as { __svelte_meta?: { loc?: { file?: string; line?: number; column?: number } } }
  ).__svelte_meta;
  if (!meta?.loc?.file) return null;
  const name =
    meta.loc.file
      .split("/")
      .pop()
      ?.replace(/\.svelte$/, "") ?? null;
  return {
    component: name,
    file: meta.loc.file,
    line: meta.loc.line ?? null,
    column: meta.loc.column ?? null,
    via: "svelte",
  };
}

function fromVue(el: Element): Hint | null {
  const inst = (
    el as unknown as {
      __vueParentComponent?: { type?: { __file?: string; __name?: string; name?: string } };
    }
  ).__vueParentComponent;
  const type = inst?.type;
  if (!type) return null;
  const file = type.__file ?? null;
  const component =
    type.__name ??
    type.name ??
    file
      ?.split("/")
      .pop()
      ?.replace(/\.vue$/, "") ??
    null;
  if (!component && !file) return null;
  return { component, file, line: null, column: null, via: "vue" };
}

interface Fiber {
  type?: unknown;
  return?: Fiber | null;
  _debugOwner?: Fiber | null;
  _debugStack?: { stack?: string } | null;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
}

function fiberName(f: Fiber): string | null {
  const t = f.type as { displayName?: string; name?: string } | string | null | undefined;
  if (!t || typeof t === "string") return null;
  return t.displayName ?? t.name ?? null;
}

function stackLocation(
  stack: string | undefined,
): { file: string; line: number | null; column: number | null } | null {
  if (!stack) return null;
  for (const line of stack.split("\n")) {
    const m = /(?:\(|@|at )((?:https?|file):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (!m) continue;
    const url = m[1]!;
    if (/node_modules|react-dom|react\.development|chunk-/.test(url)) continue;
    let file = url;
    try {
      file = new URL(url).pathname.replace(/^\/@fs/, "");
    } catch {
      // keep URL
    }
    return { file: file.split("?")[0]!, line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

function fromReact(el: Element): Hint | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = (el as unknown as Record<string, Fiber>)[key] ?? null;
  // Walk up to the nearest component (function/class) fiber.
  while (fiber && !fiberName(fiber)) fiber = fiber._debugOwner ?? fiber.return ?? null;
  if (!fiber) return null;
  const component = fiberName(fiber);
  const src = fiber._debugSource;
  if (src?.fileName) {
    return {
      component,
      file: src.fileName,
      line: src.lineNumber ?? null,
      column: src.columnNumber ?? null,
      via: "react",
    };
  }
  const loc = stackLocation(fiber._debugStack?.stack);
  return {
    component,
    file: loc?.file ?? null,
    line: loc?.line ?? null,
    column: loc?.column ?? null,
    via: "react",
  };
}
