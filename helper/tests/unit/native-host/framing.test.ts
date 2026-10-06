import { PassThrough } from "node:stream";
import { endianness } from "node:os";
import { describe, expect, it } from "vitest";
import {
  FrameTooLargeError,
  MAX_FRAME_BYTES,
  encodeFrame,
  readFrame,
} from "../../../src/native-host/framing";

function header(n: number): Buffer {
  const b = Buffer.alloc(4);
  if (endianness() === "LE") b.writeUInt32LE(n);
  else b.writeUInt32BE(n);
  return b;
}

describe("encodeFrame", () => {
  it("prefixes UTF-8 JSON with a 4-byte native-endian length", () => {
    const frame = encodeFrame({ a: "ø" });
    const body = Buffer.from(JSON.stringify({ a: "ø" }), "utf8");
    expect(frame.subarray(0, 4)).toEqual(header(body.length));
    expect(frame.subarray(4)).toEqual(body);
  });
});

describe("readFrame", () => {
  it("reads one frame split across chunks", async () => {
    const s = new PassThrough();
    const frame = encodeFrame({ v: 1, type: "list-sessions" });
    const p = readFrame(s);
    s.write(frame.subarray(0, 2));
    s.write(frame.subarray(2, 7));
    s.end(frame.subarray(7));
    await expect(p).resolves.toEqual({ v: 1, type: "list-sessions" });
  });
  it("rejects frames over 1 MB", async () => {
    const s = new PassThrough();
    const p = readFrame(s);
    s.end(header(MAX_FRAME_BYTES + 1));
    await expect(p).rejects.toBeInstanceOf(FrameTooLargeError);
  });
  it("rejects on early end", async () => {
    const s = new PassThrough();
    const p = readFrame(s);
    s.end(header(10));
    await expect(p).rejects.toThrow(/ended/);
  });
  it("rejects invalid JSON", async () => {
    const s = new PassThrough();
    const p = readFrame(s);
    s.end(Buffer.concat([header(3), Buffer.from("{x}")]));
    await expect(p).rejects.toThrow();
  });
});
