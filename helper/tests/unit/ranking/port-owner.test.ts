import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLoopback, listeningInodes, portOwnerDirs } from "../../../src/ranking/port-owner";
import { tempDir } from "../../support/tmp";

const HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";
const row = (local: string, st: string, inode: number) =>
  `   0: ${local} 00000000:0000 ${st} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0\n`;

function fakeProc(): string {
  const proc = tempDir("proc-");
  mkdirSync(join(proc, "net"));
  // 127.0.0.1:5173 LISTEN inode 111; 0.0.0.0:5173 ESTABLISHED inode 222; 127.0.0.1:8080 LISTEN 333
  writeFileSync(
    join(proc, "net/tcp"),
    HEADER +
      row("0100007F:1435", "0A", 111) +
      row("00000000:1435", "01", 222) +
      row("0100007F:1F90", "0A", 333),
  );
  // [::]:5174 LISTEN inode 444
  writeFileSync(
    join(proc, "net/tcp6"),
    HEADER + row("00000000000000000000000000000000:1436", "0A", 444),
  );
  const addProc = (pid: number, cwd: string, inodes: number[]) => {
    mkdirSync(join(proc, String(pid), "fd"), { recursive: true });
    symlinkSync(cwd, join(proc, String(pid), "cwd"));
    inodes.forEach((ino, i) =>
      symlinkSync(`socket:[${ino}]`, join(proc, String(pid), "fd", String(i + 3))),
    );
    symlinkSync("/dev/null", join(proc, String(pid), "fd", "0"));
  };
  addProc(10, "/home/u/projects/shelf/web", [111]);
  addProc(11, "/home/u/projects/other", [333]);
  addProc(12, "/home/u/projects/v6", [444]);
  mkdirSync(join(proc, "13")); // process without readable fd dir
  writeFileSync(join(proc, "self"), ""); // non-numeric entry
  return proc;
}

describe("isLoopback", () => {
  it.each(["localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1", "app.localhost"])(
    "%s is loopback",
    (h) => expect(isLoopback(h)).toBe(true),
  );
  it.each(["example.com", "10.0.0.1", "localhost.example.com"])("%s is not", (h) =>
    expect(isLoopback(h)).toBe(false),
  );
});

describe("listeningInodes", () => {
  it("returns LISTEN sockets for the port from tcp and tcp6", () => {
    const proc = fakeProc();
    expect(listeningInodes(5173, proc)).toEqual(new Set(["111"]));
    expect(listeningInodes(5174, proc)).toEqual(new Set(["444"]));
    expect(listeningInodes(9999, proc)).toEqual(new Set());
  });
  it("tolerates a missing /proc/net", () => {
    expect(listeningInodes(1, tempDir())).toEqual(new Set());
  });
});

describe("portOwnerDirs", () => {
  it("maps the port to the listening process working directory", () => {
    const proc = fakeProc();
    expect(portOwnerDirs(5173, proc)).toEqual(["/home/u/projects/shelf/web"]);
    expect(portOwnerDirs(8080, proc)).toEqual(["/home/u/projects/other"]);
    expect(portOwnerDirs(5174, proc)).toEqual(["/home/u/projects/v6"]);
    expect(portOwnerDirs(9999, proc)).toEqual([]);
  });
});
