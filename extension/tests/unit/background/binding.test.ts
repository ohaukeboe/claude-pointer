import { describe, expect, it, vi } from "vitest";
import { clearBinding, getBinding, originOf, setBinding } from "../../../src/background/binding";
import { resolveTarget } from "../../../src/background/send";
import { handleMessage } from "../../../src/background/router";
import { ext } from "../../../src/lib/browser";
import type { Session, SessionSuggestion } from "../../../../shared/types";

const shelf: Session = {
  id: "1-1",
  projectDir: "/p/shelf",
  projectName: "shelf",
  startedAt: "2026-10-06T10:00:00Z",
};
const shelf2: Session = { ...shelf, id: "5-5", startedAt: "2026-10-06T11:00:00Z" };
const other: Session = {
  id: "2-2",
  projectDir: "/p/other",
  projectName: "other",
  startedAt: "2026-10-06T12:00:00Z",
};
const PAGE = "http://localhost:5173/admin?x=1";

const list = (...sessions: Session[]): SessionSuggestion[] =>
  sessions.map((session, i) => ({ session, reason: "recent", score: 49 - i }));

function hostReturns(sessions: SessionSuggestion[]) {
  vi.spyOn(ext, "sendNative").mockResolvedValue({ v: 1, ok: true, sessions });
}

describe("site bindings (FR-010)", () => {
  it("uses the page origin as key", () => {
    expect(originOf(PAGE)).toBe("http://localhost:5173");
  });

  it("stores a SiteBinding after confirm", async () => {
    await handleMessage({ type: "confirm-target", pageUrl: PAGE, session: shelf });
    expect(await getBinding("http://localhost:5173")).toMatchObject({
      origin: "http://localhost:5173",
      sessionId: "1-1",
      projectDir: "/p/shelf",
    });
    expect(Date.parse((await getBinding("http://localhost:5173"))!.confirmedAt)).not.toBeNaN();
  });

  it("is used without asking while its session is running", async () => {
    await setBinding("http://localhost:5173", shelf);
    hostReturns(list(other, shelf));
    expect(await resolveTarget(PAGE, "")).toMatchObject({ kind: "ready", session: shelf });
  });

  it("asks again when the bound session is gone, preselecting the same project", async () => {
    await setBinding("http://localhost:5173", shelf);
    hostReturns(list(other, shelf2));
    expect(await resolveTarget(PAGE, "")).toMatchObject({
      kind: "choose",
      preselect: "5-5",
      stale: true,
    });
  });

  it("asks again with the top suggestion when no session has the same project", async () => {
    await setBinding("http://localhost:5173", shelf);
    hostReturns(list(other));
    expect(await resolveTarget(PAGE, "")).toMatchObject({ kind: "choose", preselect: "2-2" });
  });

  it("does not leak bindings across origins", async () => {
    await setBinding("http://localhost:5173", shelf);
    hostReturns(list(shelf));
    expect(await resolveTarget("http://localhost:3000/", "")).toMatchObject({ kind: "choose" });
  });

  it("can be changed and cleared from the popup", async () => {
    await handleMessage({ type: "confirm-target", pageUrl: PAGE, session: shelf });
    await handleMessage({ type: "confirm-target", pageUrl: PAGE, session: other });
    expect((await getBinding("http://localhost:5173"))!.sessionId).toBe("2-2");
    await handleMessage({ type: "forget-target", pageUrl: PAGE });
    expect(await getBinding("http://localhost:5173")).toBeUndefined();
    await clearBinding("http://none");
  });
});
