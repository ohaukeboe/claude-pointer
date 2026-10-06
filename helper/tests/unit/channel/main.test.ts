import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentSession } from "../../../src/channel/main";
import { tempDir } from "../../support/tmp";

describe("currentSession", () => {
  it("uses the parent pid and the working directory", () => {
    const proc = tempDir();
    mkdirSync(join(proc, String(process.ppid)));
    const fields = ["S", ...Array.from({ length: 18 }, () => "0"), "555"];
    writeFileSync(
      join(proc, String(process.ppid), "stat"),
      `${process.ppid} (claude) ${fields.join(" ")}`,
    );
    const s = currentSession(proc);
    expect(s.id).toBe(`${process.ppid}-555`);
    expect(s.projectDir).toBe(process.cwd());
    expect(s.projectName).toBe(basename(process.cwd()));
  });
});
