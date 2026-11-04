// specs/002-no-channel-delivery/contracts/mcp-server.md
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INBOX_INSTRUCTIONS,
  INSTRUCTIONS,
  startChannel,
  type Channel,
} from "../../../src/channel/index";
import { renderPrompt } from "../../../src/channel/render";
import { request } from "../../../src/registry/socket-client";
import { makeBatch, makeComment } from "../../../../shared/fixtures";
import type { Batch, Session } from "../../../../shared/types";
import { tempDir } from "../../support/tmp";

const session: Session = {
  id: "100-200",
  projectDir: "/home/u/projects/shelf",
  projectName: "shelf",
  startedAt: "2026-10-06T17:00:00.000Z",
};

let open: { channel: Channel; client: Client }[] = [];

afterEach(async () => {
  for (const { channel, client } of open) {
    await client.close();
    await channel.close();
  }
  open = [];
});

async function setup(push: boolean) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const notes: unknown[] = [];
  const client = new Client({ name: "test-claude", version: "0" });
  client.fallbackNotificationHandler = async (n) => {
    notes.push(n);
  };
  const channel = await startChannel({
    transport: serverT,
    dir: join(tempDir(), "cp"),
    session,
    push,
    execPath: "/nix/store/x/bin/node",
    cliPath: "/opt/it's/cli.js",
  });
  await client.connect(clientT);
  open.push({ channel, client });
  const deliver = (batch: Batch) => request(channel.socketPath, { v: 1, type: "deliver", batch });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    return content[0]!.text;
  };
  const pickUp = () => call("pick_up_comments");
  const info = () => request(channel.socketPath, { v: 1, type: "info" });
  return { client, channel, notes, deliver, pickUp, call, info };
}

/** A batch of three 10 000-character comments: about 30 KB rendered. */
function bigBatch(id: string): Batch {
  return makeBatch({
    id,
    comments: ["1", "2", "3"].map((n) => makeComment({ id: `${id}-${n}`, text: n.repeat(10_000) })),
  });
}

describe("pick_up_comments", () => {
  it("is listed with an empty input schema", async () => {
    const { client } = await setup(false);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "pick_up_comments");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema).toMatchObject({ type: "object" });
    expect(Object.keys(tool!.inputSchema.properties ?? {})).toEqual([]);
  });

  it("says so when nothing waits", async () => {
    const { pickUp } = await setup(false);
    expect(await pickUp()).toBe("No Claude Pointer comments are waiting.");
  });

  it("returns waiting batches oldest first, exactly as the channel renders them", async () => {
    const { deliver, pickUp } = await setup(false);
    const a = makeBatch({ id: "a" });
    const b = makeBatch({ id: "b", pageUrl: "http://localhost:5173/other" });
    await deliver(a);
    await deliver(b);
    expect(await pickUp()).toBe(`${renderPrompt(a)}\n\n${renderPrompt(b)}`);
    expect(await pickUp()).toBe("No Claude Pointer comments are waiting.");
  });

  it("splits at 64 KB and asks to call again", async () => {
    const { deliver, pickUp } = await setup(false);
    for (const id of ["a", "b", "c"]) await deliver(bigBatch(id));
    const first = await pickUp();
    expect(first).toContain(renderPrompt(bigBatch("a")));
    expect(first).toContain(renderPrompt(bigBatch("b")));
    expect(first).not.toContain("c-1");
    expect(first.endsWith("\n\n1 more batches waiting; call pick_up_comments again.")).toBe(true);
    expect(await pickUp()).toBe(renderPrompt(bigBatch("c")));
  });

  it("answers deliver with status waiting and pushes nothing in no-channel mode", async () => {
    const { deliver, notes } = await setup(false);
    const res = await deliver(makeBatch({ id: "a" }));
    expect(res).toMatchObject({ ok: true, batchId: "a", status: "waiting" });
    await new Promise((r) => setTimeout(r, 20));
    expect(notes).toEqual([]);
  });

  it("reports picked-up batches through status", async () => {
    const { channel, deliver, pickUp } = await setup(false);
    await deliver(makeBatch({ id: "a" }));
    expect(
      await request(channel.socketPath, { v: 1, type: "status", batchIds: ["a"] }),
    ).toMatchObject({ statuses: [{ batchId: "a", state: "waiting" }] });
    await pickUp();
    expect(
      await request(channel.socketPath, { v: 1, type: "status", batchIds: ["a"] }),
    ).toMatchObject({ statuses: [{ batchId: "a", state: "picked-up" }] });
  });

  it("refuses the 51st unread batch with inbox-full", async () => {
    const { deliver } = await setup(false);
    for (let i = 0; i < 50; i++) await deliver(makeBatch({ id: `b${i}` }));
    expect(await deliver(makeBatch({ id: "over" }))).toMatchObject({
      ok: false,
      error: { code: "inbox-full" },
    });
  });

  it("reports mode no-channel in info", async () => {
    const { channel } = await setup(false);
    expect(await request(channel.socketPath, { v: 1, type: "info" })).toMatchObject({
      session: { mode: "no-channel", watch: "off" },
    });
  });
});

describe("prompts and instructions", () => {
  it("offers a comments prompt with no arguments that asks for pick_up_comments", async () => {
    const { client } = await setup(false);
    const { prompts } = await client.listPrompts();
    const p = prompts.find((x) => x.name === "comments");
    expect(p).toBeDefined();
    expect(p!.arguments ?? []).toEqual([]);
    const got = await client.getPrompt({ name: "comments" });
    expect(got.messages).toHaveLength(1);
    expect(got.messages[0]!.role).toBe("user");
    expect((got.messages[0]!.content as { text: string }).text).toContain("pick_up_comments");
  });

  it("keeps feature 001's instructions first", async () => {
    const { client } = await setup(false);
    expect(client.getInstructions()!.startsWith(INSTRUCTIONS)).toBe(true);
  });

  it("declares the channel capability only in push mode", async () => {
    const off = await setup(false);
    expect(off.client.getServerCapabilities()?.experimental).toBeUndefined();
    const on = await setup(true);
    expect(on.client.getServerCapabilities()?.experimental).toEqual({ "claude/channel": {} });
    expect(on.client.getServerCapabilities()?.tools).toBeDefined();
  });
});

describe("watch_comments", () => {
  const COMMAND = `'/nix/store/x/bin/node' '/opt/it'\\''s/cli.js' wait --session 100-200`;

  it("start returns the exact wait command and turns the watch on", async () => {
    const { call, info } = await setup(false);
    const text = await call("watch_comments", { action: "start" });
    expect(text).toContain(COMMAND);
    expect(text).toContain("run_in_background");
    expect(await info()).toMatchObject({ session: { watch: "gap" } });
  });

  it("start twice returns the same text and keeps one watch", async () => {
    const { call, info } = await setup(false);
    const a = await call("watch_comments", { action: "start" });
    const b = await call("watch_comments", { action: "start" });
    expect(b).toBe(a);
    expect(await info()).toMatchObject({ session: { watch: "gap" } });
  });

  it("start in channel mode says no watch is needed", async () => {
    const { call, info } = await setup(true);
    expect(await call("watch_comments", { action: "start" })).toBe(
      "Comments are pushed to this session; no watch needed.",
    );
    expect(await info()).toMatchObject({ session: { watch: "off" } });
  });

  it("stop turns the watch off and answers an open wait with stopped", async () => {
    const { call, info, channel } = await setup(false);
    await call("watch_comments", { action: "start" });
    const waiting = request(channel.socketPath, { v: 1, type: "wait" }, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(await info()).toMatchObject({ session: { watch: "waiting" } });
    expect(await call("watch_comments", { action: "stop" })).toBe("Stopped watching.");
    expect(await waiting).toMatchObject({ outcome: "stopped" });
    expect(await info()).toMatchObject({ session: { watch: "off" } });
  });

  it("wakes an open wait when a comment is delivered", async () => {
    const { call, channel, deliver } = await setup(false);
    await call("watch_comments", { action: "start" });
    const waiting = request(channel.socketPath, { v: 1, type: "wait" }, null);
    await new Promise((r) => setTimeout(r, 20));
    await deliver(makeBatch({ id: "a" }));
    expect(await waiting).toEqual({ v: 1, ok: true, outcome: "comments", waiting: 1 });
  });

  it("rejects an invalid action", async () => {
    const { client } = await setup(false);
    const res = await client
      .callTool({ name: "watch_comments", arguments: { action: "nap" } })
      .catch((e: Error) => ({ isError: true, message: e.message }));
    expect(res).toMatchObject({ isError: true });
  });

  it("offers a watch prompt with no arguments", async () => {
    const { client } = await setup(false);
    const { prompts } = await client.listPrompts();
    const p = prompts.find((x) => x.name === "watch");
    expect(p).toBeDefined();
    expect(p!.arguments ?? []).toEqual([]);
    const got = await client.getPrompt({ name: "watch" });
    expect((got.messages[0]!.content as { text: string }).text).toContain("watch_comments");
  });

  it("appends the inbox instructions after feature 001's text", async () => {
    const { client } = await setup(false);
    expect(client.getInstructions()).toBe(`${INSTRUCTIONS}\n\n${INBOX_INSTRUCTIONS}`);
    expect(INBOX_INSTRUCTIONS).toContain("on `timeout`, run it again without writing anything");
  });
});

describe("pick-up in channel mode", () => {
  it("returns pushed batches marked as already delivered", async () => {
    const { deliver, pickUp, notes } = await setup(true);
    const a = makeBatch({ id: "a" });
    await deliver(a);
    await new Promise((r) => setTimeout(r, 20));
    expect(notes).toHaveLength(1);
    expect(await pickUp()).toBe(
      `(Already delivered by the channel; skip if you have handled it.)\n${renderPrompt(a)}`,
    );
  });

  it("does not mark batches that were not pushed", async () => {
    const { deliver, pickUp } = await setup(false);
    await deliver(makeBatch({ id: "a" }));
    expect(await pickUp()).not.toContain("Already delivered");
  });
});

describe("pick-up edge cases (spec.md)", () => {
  it("hands a batch delivered during a pick-up over in that result or the next", async () => {
    const { deliver, pickUp } = await setup(false);
    await deliver(makeBatch({ id: "a" }));
    const [first] = await Promise.all([
      pickUp(),
      deliver(makeBatch({ id: "b", pageUrl: "http://b/" })),
    ]);
    const second = await pickUp();
    const all = first + "\n" + second;
    expect(all.match(/Browser comments from http:\/\/b\//g)).toHaveLength(1);
    expect(all.match(/Browser comments from http:\/\/localhost/g)).toHaveLength(1);
  });

  it("delivers a 30-batch inbox over several calls without loss or repeat", async () => {
    const { deliver, pickUp } = await setup(false);
    const ids = Array.from({ length: 30 }, (_, i) => `b${i}`);
    for (const id of ids) await deliver(bigBatch(id));
    const seen: string[] = [];
    for (let call = 0; call < 30; call++) {
      const text = await pickUp();
      if (text === "No Claude Pointer comments are waiting.") break;
      seen.push(...[...text.matchAll(/Comment: (\d)\1+/g)].map((m) => m[0]));
    }
    // Each big batch has three comments "1…", "2…", "3…".
    expect(seen).toHaveLength(90);
  });
});
