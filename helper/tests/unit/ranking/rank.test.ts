import { describe, expect, it } from "vitest";
import { rankSessions } from "../../../src/ranking/index";
import type { Session } from "../../../../shared/types";

const s = (id: string, projectDir: string, startedAt: string): Session => ({
  id,
  projectDir,
  projectName: projectDir.split("/").pop()!,
  startedAt,
});

const shelf = s("1-1", "/home/u/projects/shelf", "2026-10-06T08:00:00Z");
const shelfWeb = s("2-2", "/home/u/projects/shelf/web", "2026-10-06T07:00:00Z");
const other = s("3-3", "/home/u/projects/other", "2026-10-06T10:00:00Z");
const blog = s("4-4", "/home/u/projects/blog", "2026-10-06T09:00:00Z");

describe("rankSessions", () => {
  it("puts the port owner first with score 100, most specific path winning", () => {
    const r = rankSessions([shelf, shelfWeb, other, blog], {
      pageUrl: "http://localhost:5173/admin",
      pageTitle: "Admin",
      portOwners: () => ["/home/u/projects/shelf/web/src"],
    });
    expect(r.map((x) => [x.session.id, x.reason, x.score])).toEqual([
      ["2-2", "port-owner", 100],
      ["1-1", "port-owner", 90],
      ["3-3", "recent", 49],
      ["4-4", "recent", 48],
    ]);
  });

  it("matches when the dev server runs above the project dir", () => {
    const r = rankSessions([shelfWeb, other], {
      pageUrl: "http://127.0.0.1:3000/",
      pageTitle: "",
      portOwners: () => ["/home/u/projects/shelf"],
    });
    expect(r[0]).toMatchObject({ session: { id: "2-2" }, reason: "port-owner" });
  });

  it("does not match sibling directories with a shared prefix", () => {
    const r = rankSessions([shelf], {
      pageUrl: "http://localhost:5173/",
      pageTitle: "",
      portOwners: () => ["/home/u/projects/shelf-old"],
    });
    expect(r[0]!.reason).toBe("recent");
  });

  it("uses the port only for loopback hosts", () => {
    const portOwners = () => ["/home/u/projects/shelf"];
    const r = rankSessions([shelf, other], {
      pageUrl: "https://example.com:5173/",
      pageTitle: "",
      portOwners,
    });
    expect(r.every((x) => x.reason !== "port-owner")).toBe(true);
  });

  it("uses the default port when the URL has none", () => {
    const seen: number[] = [];
    rankSessions([shelf], {
      pageUrl: "http://localhost/",
      pageTitle: "",
      portOwners: (p) => (seen.push(p), []),
    });
    rankSessions([shelf], {
      pageUrl: "https://localhost/",
      pageTitle: "",
      portOwners: (p) => (seen.push(p), []),
    });
    expect(seen).toEqual([80, 443]);
  });

  it("ranks a project name found in the host or title as name-match (50)", () => {
    const r = rankSessions([other, blog], {
      pageUrl: "https://blog.example.com/",
      pageTitle: "",
      portOwners: () => [],
    });
    expect(r.map((x) => [x.session.id, x.reason, x.score])).toEqual([
      ["4-4", "name-match", 50],
      ["3-3", "recent", 49],
    ]);
    const t = rankSessions([other, blog], {
      pageUrl: "https://x.test/",
      pageTitle: "Shelf — Other admin",
      portOwners: () => [],
    });
    expect(t[0]).toMatchObject({ session: { id: "3-3" }, reason: "name-match" });
  });

  it("orders the rest by most recent start", () => {
    const r = rankSessions([shelf, other, blog], {
      pageUrl: "https://x.test/",
      pageTitle: "",
      portOwners: () => [],
    });
    expect(r.map((x) => x.session.id)).toEqual(["3-3", "4-4", "1-1"]);
    expect(r.map((x) => x.score)).toEqual([49, 48, 47]);
  });

  it("survives an invalid page URL", () => {
    expect(
      rankSessions([shelf], { pageUrl: "not a url", pageTitle: "", portOwners: () => [] })[0]!
        .reason,
    ).toBe("recent");
  });
});
