// Ties picker, overlay, pending comments and background messages together for one page.

import type { Comment, Session, SessionSuggestion, SourceHint } from "../../../shared/types";
import type { BackgroundCall } from "../lib/messages";
import type { SendResult, TargetResult } from "../background/send";
import { Picker, defaultHitTest, labelFor } from "./picker";
import { buildSelection } from "./selection";
import { PendingStore } from "./pending";
import { createCommentBox, type Box, type CommentBox } from "./overlay/comment-box";
import { createMarkers, type Markers, type PlacedComment } from "./overlay/markers";
import { createOutline, type Outline } from "./overlay/outline";
import { createOverlay, type Overlay } from "./overlay/root";
import { createChooser, type Chooser } from "./overlay/session-chooser";

export type { BackgroundCall };

export interface ControllerDeps {
  doc: Document;
  win: Window;
  send(msg: BackgroundCall): Promise<unknown>;
  raf?(cb: FrameRequestCallback): number;
  probe?(el: Element): SourceHint | null;
  shadowMode?: ShadowRootMode;
}

const CLOSE_AFTER_DELIVERY_MS = 1500;
const CHOOSER_REFRESH_MS = 2000;
export const STALE_BINDING_MESSAGE =
  "The session you chose for this site has ended. Choose another one:";
export const NO_SESSION_MESSAGE =
  "No Claude Code session is running with claude-pointer. Start one with `npx claude-pointer claude`.";

/** Element rect in top-level viewport coordinates (adds same-origin iframe offsets). */
export function viewportRect(el: Element): Box {
  const r = el.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  let frame = el.ownerDocument.defaultView?.frameElement ?? null;
  while (frame) {
    const fr = frame.getBoundingClientRect();
    left += fr.left;
    top += fr.top;
    frame = frame.ownerDocument.defaultView?.frameElement ?? null;
  }
  return { left, top, width: r.width, height: r.height };
}

function resolveSelector(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

export class Controller {
  active = false;
  picker: Picker | null = null;
  private overlay: Overlay | null = null;
  private outline: Outline | null = null;
  private markers: Markers | null = null;
  private box: CommentBox | null = null;
  private chooser: Chooser | null = null;
  private chooserRefresh: ReturnType<typeof setInterval> | null = null;
  private store: PendingStore | null = null;
  private pending: PlacedComment[] = [];
  private selected: Element | null = null;
  /** Comment being written (new) or edited (pending). */
  private draft: Comment | null = null;
  private editingId: string | null = null;
  private batchId: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private frame = 0;

  constructor(private readonly deps: ControllerDeps) {}

  get overlayRoot(): ShadowRoot | null {
    return this.overlay?.root ?? null;
  }

  toggle(): void {
    if (this.active) this.stop();
    else void this.start();
  }

  async start(): Promise<void> {
    if (this.active) return;
    const { doc, win } = this.deps;
    this.active = true;
    this.overlay = createOverlay(doc, this.deps.shadowMode);
    this.outline = createOutline(this.overlay.layer, doc);
    this.markers = createMarkers(this.overlay.layer, (id) => this.editPending(id), doc);
    const overlay = this.overlay;
    this.picker = new Picker({
      win,
      isOwnUi: (n) => overlay.contains(n),
      hitTest: (x, y, from) => defaultHitTest(from, x, y),
      raf: this.raf,
      onHover: (el) => this.showOutline(el),
      onSelect: (el) => this.select(el),
      onEscape: () => this.stop(),
    });
    this.picker.start();
    win.addEventListener("scroll", this.onViewportChange, true);
    win.addEventListener("resize", this.onViewportChange);
    this.store = new PendingStore(location.href);
    await this.loadPending();
  }

  stop(): void {
    if (!this.active) return;
    const { win } = this.deps;
    this.active = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.stopChooserRefresh();
    win.removeEventListener("scroll", this.onViewportChange, true);
    win.removeEventListener("resize", this.onViewportChange);
    this.picker?.stop();
    this.overlay?.destroy();
    this.picker = null;
    this.overlay = null;
    this.outline = null;
    this.markers = null;
    this.box = null;
    this.chooser = null;
    this.store = null;
    this.pending = [];
    this.selected = null;
    this.draft = null;
    this.editingId = null;
    this.batchId = null;
  }

  private get raf(): (cb: FrameRequestCallback) => number {
    return this.deps.raf ?? ((cb) => this.deps.win.requestAnimationFrame(cb));
  }

  private label(el: Element): string {
    const component = this.probe(el)?.component;
    return component ? `${component} · ${labelFor(el)}` : labelFor(el);
  }

  private probe(el: Element): SourceHint | null {
    try {
      return this.deps.probe?.(el) ?? null;
    } catch {
      return null;
    }
  }

  private showOutline(el: Element | null): void {
    if (!el) {
      this.outline?.hide();
      return;
    }
    this.outline?.show(viewportRect(el), this.label(el));
  }

  private renderMarkers(): void {
    this.markers?.render(this.pending, viewportRect);
  }

  private async loadPending(): Promise<void> {
    const list = (await this.store?.list()) ?? [];
    if (!this.active) return;
    this.pending = list.map((comment) => ({
      comment,
      el: resolveSelector(this.deps.doc, comment.selection.selector),
    }));
    this.renderMarkers();
  }

  private readonly onViewportChange = (): void => {
    if (this.frame) return;
    this.frame = this.raf(() => {
      this.frame = 0;
      this.renderMarkers();
      const el = this.selected ?? this.picker?.hovered ?? null;
      if (!el) return;
      if (!el.isConnected) {
        this.closeBox(); // element disappeared: close cleanly
        return;
      }
      const rect = viewportRect(el);
      this.outline?.show(rect, this.label(el));
      this.box?.reposition(rect);
    });
  };

  private openBox(el: Element, opts: { initialText?: string; editing?: Comment }): void {
    if (!this.overlay) return;
    this.picker?.pause();
    this.selected = el;
    this.batchId = null;
    this.editingId = opts.editing?.id ?? null;
    this.draft = opts.editing ?? null;
    const rect = viewportRect(el);
    this.showOutline(el);
    this.box?.destroy();
    this.box = createCommentBox(
      {
        anchor: rect,
        label: this.label(el),
        allowAdd: true,
        addLabel: opts.editing ? "Save" : "Add comment",
        initialText: opts.initialText,
        onDelete: opts.editing ? () => void this.deletePending(opts.editing!.id) : undefined,
        onSend: (text) => void this.submit(text),
        onAdd: (text) =>
          void (opts.editing ? this.savePending(opts.editing.id, text) : this.addPending(text)),
        onClose: () => this.stop(),
      },
      this.deps.doc,
    );
    this.overlay.layer.append(this.box.el);
    this.box.reposition(rect);
    this.box.focus();
  }

  /** Back to picking after Add / Save / Delete (US3: pick mode continues). */
  private closeBox(): void {
    this.closeChooser();
    this.box?.destroy();
    this.box = null;
    this.selected = null;
    this.draft = null;
    this.editingId = null;
    this.batchId = null;
    this.outline?.hide();
    this.picker?.resume();
  }

  private select(el: Element): void {
    this.openBox(el, {});
  }

  private editPending(id: string): void {
    const placed = this.pending.find((p) => p.comment.id === id);
    if (!placed?.el) return;
    this.openBox(placed.el, { initialText: placed.comment.text, editing: placed.comment });
  }

  private buildDraft(text: string): Comment {
    const el = this.selected!;
    this.draft ??= {
      id: crypto.randomUUID(),
      text,
      selection: buildSelection(el, this.probe(el)),
      createdAt: new Date().toISOString(),
      state: "draft",
      error: null,
    };
    this.draft = { ...this.draft, text };
    return this.draft;
  }

  private async addPending(text: string): Promise<void> {
    const comment = this.buildDraft(text);
    await this.store?.add(comment);
    this.closeBox();
    await this.loadPending();
  }

  private async savePending(id: string, text: string): Promise<void> {
    await this.store?.update(id, text);
    this.closeBox();
    await this.loadPending();
  }

  private async deletePending(id: string): Promise<void> {
    await this.store?.remove(id);
    this.closeBox();
    await this.loadPending();
  }

  /** All pending comments (in order) plus the current draft, without duplicates. */
  private batchComments(draft: Comment): Comment[] {
    const others = this.pending.map((p) => p.comment).filter((c) => c.id !== draft.id);
    return [...others, draft];
  }

  private async submit(text: string): Promise<void> {
    const box = this.box;
    if (!box || !this.selected) return;
    const comments = this.batchComments(this.buildDraft(text));
    this.batchId ??= crypto.randomUUID();
    box.setBusy(true);
    box.setStatus("info", "Sending…");
    const target = (await this.deps.send({
      type: "resolve-target",
      pageUrl: location.href,
      pageTitle: document.title,
    })) as TargetResult;
    if (!this.active) return;
    switch (target.kind) {
      case "ready":
        await this.deliver(target.session, comments);
        return;
      case "choose":
        this.choose(
          target.suggestions,
          target.preselect,
          comments,
          target.stale ? STALE_BINDING_MESSAGE : undefined,
        );
        return;
      case "none":
        this.fail(NO_SESSION_MESSAGE);
        return;
      case "no-host":
      case "error":
        this.fail(target.message);
        return;
    }
  }

  private fail(message: string): void {
    this.box?.setBusy(false);
    this.box?.setStatus("error", message);
  }

  private choose(
    suggestions: SessionSuggestion[],
    preselect: string | null,
    comments: Comment[],
    message?: string,
  ): void {
    if (!this.overlay || !this.box) return;
    this.box.setStatus("info", "");
    this.box.el.hidden = true;
    this.chooser?.destroy();
    const chooser = createChooser(
      {
        suggestions,
        preselect,
        message,
        onConfirm: async (session) => {
          this.closeChooser();
          await this.deps.send({ type: "confirm-target", pageUrl: location.href, session });
          await this.deliver(session, comments);
        },
        onCancel: () => {
          this.closeChooser();
          this.box?.setBusy(false);
          this.box?.focus();
        },
      },
      this.deps.doc,
    );
    this.chooser = chooser;
    this.stopChooserRefresh();
    this.chooserRefresh = setInterval(() => void this.refreshChooser(), CHOOSER_REFRESH_MS);
    chooser.el.style.left = this.box.el.style.left;
    chooser.el.style.top = this.box.el.style.top;
    this.overlay.layer.append(chooser.el);
    (chooser.el.querySelector("input:checked") as HTMLElement | null)?.focus();
  }

  private stopChooserRefresh(): void {
    if (this.chooserRefresh !== null) clearInterval(this.chooserRefresh);
    this.chooserRefresh = null;
  }

  private async refreshChooser(): Promise<void> {
    const res = (await this.deps.send({
      type: "list-sessions",
      pageUrl: location.href,
      pageTitle: document.title,
    })) as { ok?: boolean; sessions?: SessionSuggestion[] };
    if (this.chooser && res?.ok && res.sessions) this.chooser.update(res.sessions);
  }

  private closeChooser(): void {
    this.stopChooserRefresh();
    this.chooser?.destroy();
    this.chooser = null;
    if (this.box) this.box.el.hidden = false;
  }

  private async deliver(session: Session, comments: Comment[]): Promise<void> {
    const box = this.box;
    if (!box) return;
    box.setBusy(true);
    box.setStatus("info", `Sending to ${session.projectName}…`);
    const res = (await this.deps.send({
      type: "send",
      pageUrl: location.href,
      sessionId: session.id,
      projectName: session.projectName,
      comments,
      batchId: this.batchId!,
    })) as SendResult;
    if (!this.active) return;
    if (res.ok) {
      await this.store?.clear();
      this.pending = [];
      this.renderMarkers();
      box.setStatus("ok", `Delivered to ${session.projectName}`);
      this.timers.push(setTimeout(() => this.stop(), CLOSE_AFTER_DELIVERY_MS));
      return;
    }
    // Keep every comment of the batch, marked failed, so nothing is lost (SC-006).
    await this.store?.markFailed(comments, res.message);
    await this.loadPending();
    this.fail(res.message);
    if (res.code === "session-gone") await this.rechoose(comments);
  }

  /** The chosen session ended: ask again, never guess (FR-010, US2 scenario 4). */
  private async rechoose(comments: Comment[]): Promise<void> {
    const target = (await this.deps.send({
      type: "resolve-target",
      pageUrl: location.href,
      pageTitle: document.title,
    })) as TargetResult;
    if (!this.active) return;
    if (target.kind === "choose") {
      this.choose(
        target.suggestions,
        target.preselect,
        comments,
        "That session has ended. Choose another one:",
      );
    } else if (target.kind === "none") {
      this.fail(`The session has ended. ${NO_SESSION_MESSAGE}`);
    }
  }
}
