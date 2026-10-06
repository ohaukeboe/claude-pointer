// Content-script side of the page-world source probe (research R7).
// The page-world script answers synchronously through DOM events; the answer is untrusted.

import type { SourceHint } from "../../../shared/types";

export const PROBE_REQUEST = "claude-pointer:probe";
export const PROBE_RESULT = "claude-pointer:probe-result";

const VIA = new Set(["attribute", "svelte", "vue", "react"]);
const str = (v: unknown, max = 300) => (typeof v === "string" && v ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

export function parseHint(raw: unknown): SourceHint | null {
  if (typeof raw !== "string") return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || !VIA.has(v.via as string)) return null;
  const hint: SourceHint = {
    component: str(v.component, 120),
    file: str(v.file),
    line: num(v.line),
    column: num(v.column),
    via: v.via as SourceHint["via"],
  };
  return hint.component || hint.file ? hint : null;
}

export function probeSource(el: Element): SourceHint | null {
  const doc = el.ownerDocument;
  let answer: unknown = null;
  const onResult = (e: Event) => {
    answer = (e as CustomEvent).detail;
  };
  doc.addEventListener(PROBE_RESULT, onResult, { once: true });
  el.dispatchEvent(new CustomEvent(PROBE_REQUEST, { bubbles: true, composed: true }));
  doc.removeEventListener(PROBE_RESULT, onResult);
  return parseHint(answer);
}
