import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureSocketDir,
  listSockets,
  readStartTicks,
  removeStale,
  sessionIdFor,
  socketDir,
  socketPathFor,
} from "../../../src/registry/index";
import { tempDir } from "../../support/tmp";

describe("socketDir", () => {
  it("uses $XDG_RUNTIME_DIR/claude-pointer", () => {
    expect(socketDir({ XDG_RUNTIME_DIR: "/run/user/5" }, 5)).toBe("/run/user/5/claude-pointer");
  });
  it("falls back to /tmp/claude-pointer-<uid>", () => {
    expect(socketDir({}, 42)).toBe("/tmp/claude-pointer-42");
  });
});

describe("ensureSocketDir", () => {
  it("creates the dir with mode 0700", () => {
    const dir = join(tempDir(), "claude-pointer");
    ensureSocketDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
  it("accepts an existing 0700 dir", () => {
    const dir = join(tempDir(), "ok");
    mkdirSync(dir, { mode: 0o700 });
    expect(() => ensureSocketDir(dir)).not.toThrow();
  });
  it("refuses a dir with group or world bits", () => {
    const dir = join(tempDir(), "open");
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    expect(() => ensureSocketDir(dir)).toThrow(/group\/world/);
  });
  it("refuses a dir owned by another user", () => {
    const dir = join(tempDir(), "other");
    mkdirSync(dir, { mode: 0o700 });
    expect(() => ensureSocketDir(dir, 999_999)).toThrow(/owned/);
  });
});

describe("session id", () => {
  it("reads start ticks (field 22) from /proc/<pid>/stat, even with spaces and ) in comm", () => {
    const proc = tempDir();
    mkdirSync(join(proc, "123"));
    // fields: pid (comm) state ppid ... field 22 = starttime
    const after = ["S", ...Array.from({ length: 18 }, (_, i) => String(i + 4)), "987654", "x", "y"];
    writeFileSync(join(proc, "123", "stat"), `123 (my) weird cmd) ${after.join(" ")}\n`);
    expect(readStartTicks(123, proc)).toBe("987654");
    expect(sessionIdFor(123, proc)).toBe("123-987654");
  });
  it("throws for a missing pid", () => {
    expect(() => sessionIdFor(1, tempDir())).toThrow();
  });
});

describe("sockets", () => {
  it("lists only *.sock files, sorted", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "b.sock"), "");
    writeFileSync(join(dir, "a.sock"), "");
    writeFileSync(join(dir, "note.txt"), "");
    expect(listSockets(dir)).toEqual([join(dir, "a.sock"), join(dir, "b.sock")]);
  });
  it("returns [] for a missing dir", () => {
    expect(listSockets(join(tempDir(), "missing"))).toEqual([]);
  });
  it("socketPathFor joins id", () => {
    expect(socketPathFor("/d", "1-2")).toBe("/d/1-2.sock");
  });
  it("rejects ids that could escape the dir", () => {
    expect(() => socketPathFor("/d", "../x")).toThrow();
  });
  it("removeStale ignores missing files", () => {
    const dir = tempDir();
    const p = join(dir, "x.sock");
    writeFileSync(p, "");
    removeStale(p);
    expect(listSockets(dir)).toEqual([]);
    expect(() => removeStale(p)).not.toThrow();
  });
});
