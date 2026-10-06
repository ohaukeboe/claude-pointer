// Site bindings: origin -> confirmed target session (FR-010, data-model "SiteBinding").

import type { Session, SiteBinding } from "../../../shared/types";
import { ext } from "../lib/browser";

const key = (origin: string) => `binding:${origin}`;

export function originOf(pageUrl: string): string {
  return new URL(pageUrl).origin;
}

export function getBinding(origin: string): Promise<SiteBinding | undefined> {
  return ext.storageGet<SiteBinding>(key(origin));
}

export async function setBinding(
  origin: string,
  session: Session,
  now = new Date(),
): Promise<SiteBinding> {
  const binding: SiteBinding = {
    origin,
    sessionId: session.id,
    projectDir: session.projectDir,
    confirmedAt: now.toISOString(),
  };
  await ext.storageSet({ [key(origin)]: binding });
  return binding;
}

export function clearBinding(origin: string): Promise<void> {
  return ext.storageRemove(key(origin));
}
