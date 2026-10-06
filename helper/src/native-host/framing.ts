// Firefox native messaging framing: 4-byte native-endian length + UTF-8 JSON.

import { endianness } from "node:os";
import type { Readable } from "node:stream";

export const MAX_FRAME_BYTES = 1024 * 1024;
const LE = endianness() === "LE";

export class FrameTooLargeError extends Error {
  constructor(size: number) {
    super(`frame of ${size} bytes exceeds ${MAX_FRAME_BYTES}`);
  }
}

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const head = Buffer.alloc(4);
  if (LE) head.writeUInt32LE(body.length);
  else head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

/** Read exactly one frame from the stream. */
export function readFrame(stream: Readable): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let need: number | null = null;
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("input ended before a full frame was read"));
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (need === null && buf.length >= 4) {
        need = LE ? buf.readUInt32LE(0) : buf.readUInt32BE(0);
        if (need > MAX_FRAME_BYTES) {
          cleanup();
          reject(new FrameTooLargeError(need));
          return;
        }
      }
      if (need !== null && buf.length >= 4 + need) {
        cleanup();
        try {
          resolve(JSON.parse(buf.subarray(4, 4 + need).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      }
    };
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
