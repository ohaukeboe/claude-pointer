// Orders sessions for a page (research R3): dev-server port owner, then name match, then recency.

import type { Session, SessionSuggestion } from "../../../shared/types";
import { isLoopback, portOwnerDirs } from "./port-owner";

export interface RankOptions {
  pageUrl: string;
  pageTitle: string;
  portOwners?: (port: number) => string[];
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function defaultPort(u: URL): number {
  if (u.port) return Number(u.port);
  return u.protocol === "https:" ? 443 : 80;
}

export function rankSessions(sessions: Session[], opts: RankOptions): SessionSuggestion[] {
  const url = parseUrl(opts.pageUrl);
  const owners =
    url && isLoopback(url.hostname)
      ? (opts.portOwners ?? ((p) => portOwnerDirs(p)))(defaultPort(url))
      : [];

  const portMatches = sessions
    .filter((s) => owners.some((dir) => within(dir, s.projectDir) || within(s.projectDir, dir)))
    .sort((a, b) => b.projectDir.length - a.projectDir.length);

  const haystack = `${url?.hostname ?? ""} ${opts.pageTitle}`.toLowerCase();
  const nameMatches = sessions.filter(
    (s) =>
      !portMatches.includes(s) &&
      s.projectName.length >= 2 &&
      haystack.includes(s.projectName.toLowerCase()),
  );

  const rest = sessions
    .filter((s) => !portMatches.includes(s) && !nameMatches.includes(s))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return [
    ...portMatches.map((session, i) => ({
      session,
      reason: "port-owner" as const,
      score: i === 0 ? 100 : 90,
    })),
    ...nameMatches.map((session) => ({ session, reason: "name-match" as const, score: 50 })),
    ...rest.map((session, i) => ({
      session,
      reason: "recent" as const,
      score: Math.max(1, 49 - i),
    })),
  ];
}
