// Pending comments per page (US3, data-model "pending:<origin><pathname>").

import type { Comment } from "../../../shared/types";
import { ext } from "../lib/browser";

export function pendingKey(pageUrl: string): string {
  const u = new URL(pageUrl);
  return `pending:${u.origin}${u.pathname}`;
}

export class PendingStore {
  private readonly key: string;

  constructor(pageUrl: string) {
    this.key = pendingKey(pageUrl);
  }

  async list(): Promise<Comment[]> {
    return (await ext.storageGet<Comment[]>(this.key)) ?? [];
  }

  private async save(list: Comment[]): Promise<void> {
    if (list.length === 0) await ext.storageRemove(this.key);
    else await ext.storageSet({ [this.key]: list });
  }

  async add(comment: Comment): Promise<void> {
    const list = (await this.list()).filter((c) => c.id !== comment.id);
    await this.save([...list, { ...comment, state: "pending", error: null }]);
  }

  async update(id: string, text: string): Promise<void> {
    await this.save((await this.list()).map((c) => (c.id === id ? { ...c, text } : c)));
  }

  async remove(id: string): Promise<void> {
    await this.save((await this.list()).filter((c) => c.id !== id));
  }

  /** Keep failed comments (and any new ones) so nothing is lost (FR-016, SC-006). */
  async markFailed(comments: Comment[] | string[], error: string): Promise<void> {
    const list = await this.list();
    const incoming = comments.filter((c): c is Comment => typeof c !== "string");
    const ids = new Set(comments.map((c) => (typeof c === "string" ? c : c.id)));
    const merged = [...list, ...incoming.filter((c) => !list.some((x) => x.id === c.id))];
    await this.save(merged.map((c) => (ids.has(c.id) ? { ...c, state: "failed", error } : c)));
  }

  async clear(): Promise<void> {
    await this.save([]);
  }
}
