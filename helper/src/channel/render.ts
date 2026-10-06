// Renders a Batch into the channel prompt (contracts/channel-prompt.md).

import type { Batch, Comment, Selection } from "../../../shared/types";
import { LIMITS } from "../../../shared/validate";

const FENCE = "```";
const ZWSP = "\u200b";

const LABEL_MAX = 100;
// Any line a Markdown parser could read as a fence: up to 3 spaces, then ``` or ~~~.
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;

/** Page-controlled text shown outside the fence: one line, no control characters. */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");
}

export function elementLabel(sel: Selection): string {
  const id = sel.id ? `#${sel.id}` : "";
  const classes = sel.classes
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  const label = oneLine(`${sel.tag}${id}${classes}`);
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

function sourceLine(sel: Selection): string {
  const s = sel.source;
  if (!s) return "source: -";
  const where = s.file ? `${s.file}${s.line !== null ? `:${s.line}` : ""}` : null;
  const name = s.component ?? "-";
  return `source: ${name}${where ? ` (${where})` : ""}  via ${s.via}`;
}

/** A page must not be able to close the page-data fence. */
function escapeFence(text: string): string {
  return text
    .split("\n")
    .map((line) => (FENCE_LINE.test(line) ? ZWSP + line : line))
    .join("\n");
}

function renderComment(c: Comment, index: number): string {
  const s = c.selection;
  const pageData = [
    `selector: ${s.selector}`,
    `tag: ${s.tag}  id: ${s.id ?? "-"}  classes: ${s.classes.join(" ") || "-"}`,
    sourceLine(s),
    `size: ${s.rect.width}×${s.rect.height} at (${s.rect.x}, ${s.rect.y})  viewport: ${s.viewport.width}×${s.viewport.height}`,
    ...(s.frame ? [`frame: ${s.frame}`] : []),
    `text: ${s.text}`,
    "html:",
    s.html,
  ].join("\n");
  return [
    `## ${index + 1}. ${elementLabel(s)}`,
    `Comment: ${c.text.trim()}`,
    "",
    `${FENCE}page-data`,
    escapeFence(pageData),
    FENCE,
  ].join("\n");
}

export function renderPrompt(batch: Batch): string {
  const header = `Browser comments from ${batch.pageUrl} (${batch.comments.length})`;
  return [header, ...batch.comments.map(renderComment)].join("\n\n");
}

export interface ChannelNotification {
  method: "notifications/claude/channel";
  params: { content: string; meta: { batch_id: string; url: string; count: string } };
}

export type RenderResult = { ok: true; notification: ChannelNotification } | { ok: false };

export function buildNotification(batch: Batch): RenderResult {
  const content = renderPrompt(batch);
  if (Buffer.byteLength(content, "utf8") > LIMITS.promptBytes) return { ok: false };
  return {
    ok: true,
    notification: {
      method: "notifications/claude/channel",
      params: {
        content,
        meta: { batch_id: batch.id, url: batch.pageUrl, count: String(batch.comments.length) },
      },
    },
  };
}
