import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { request } from "../../../src/registry/socket-client";
import { tempDir } from "../../support/tmp";

function serve(path: string, handler: (line: string, reply: (s: string) => void) => void) {
  const server = createServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i >= 0) handler(buf.slice(0, i), (s) => sock.end(s));
    });
  });
  return new Promise<typeof server>((r) => server.listen(path, () => r(server)));
}

describe("socket request", () => {
  it("sends one NDJSON line and parses one response", async () => {
    const path = join(tempDir(), "s.sock");
    const server = await serve(path, (line, reply) => {
      expect(JSON.parse(line)).toEqual({ v: 1, type: "info" });
      reply(JSON.stringify({ v: 1, ok: true, echo: 1 }) + "\n");
    });
    await expect(request(path, { v: 1, type: "info" })).resolves.toEqual({
      v: 1,
      ok: true,
      echo: 1,
    });
    server.close();
  });
  it("maps missing socket to session-gone", async () => {
    const res = await request(join(tempDir(), "none.sock"), { v: 1, type: "info" });
    expect(res).toMatchObject({ ok: false, error: { code: "session-gone" } });
  });
  it("times out after the given ms", async () => {
    const path = join(tempDir(), "slow.sock");
    const server = await serve(path, () => {});
    const res = await request(path, { v: 1, type: "info" }, 100);
    expect(res).toMatchObject({ ok: false, error: { code: "timeout" } });
    server.close();
  });
  it("maps garbage response to internal", async () => {
    const path = join(tempDir(), "bad.sock");
    const server = await serve(path, (_l, reply) => reply("not json\n"));
    const res = await request(path, { v: 1, type: "info" });
    expect(res).toMatchObject({ ok: false, error: { code: "internal" } });
    server.close();
  });
  it("maps closed-without-reply to internal", async () => {
    const path = join(tempDir(), "close.sock");
    const server = await serve(path, (_l, reply) => reply(""));
    const res = await request(path, { v: 1, type: "info" });
    expect(res).toMatchObject({ ok: false, error: { code: "internal" } });
    server.close();
  });
});
