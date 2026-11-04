// Shared types for the extension, native host and channel server.
// Source of truth: specs/001-element-comment-picker/data-model.md and contracts/.

export const PROTOCOL_VERSION = 1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type SourceVia = "attribute" | "svelte" | "vue" | "react";

export interface SourceHint {
  component: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
  via: SourceVia;
}

export interface Selection {
  url: string;
  title: string;
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  html: string;
  rect: Rect;
  viewport: Viewport;
  source: SourceHint | null;
  frame: string | null;
}

export type CommentState = "draft" | "pending" | "sending" | "delivered" | "failed";

export interface Comment {
  id: string;
  text: string;
  selection: Selection;
  createdAt: string;
  state: CommentState;
  error: string | null;
}

export interface Batch {
  id: string;
  sessionId: string;
  pageUrl: string;
  comments: Comment[];
}

export type DeliveryMode = "channel" | "no-channel";

export type WatchState = "off" | "waiting" | "busy" | "gap";

export interface Session {
  id: string;
  projectDir: string;
  projectName: string;
  startedAt: string;
  /** Absent when the session runs a helper older than feature 002. */
  mode?: DeliveryMode;
  watch?: WatchState;
}

export type SuggestionReason = "port-owner" | "name-match" | "recent";

export interface SessionSuggestion {
  session: Session;
  reason: SuggestionReason;
  score: number;
}

export interface SiteBinding {
  origin: string;
  sessionId: string;
  projectDir: string;
  confirmedAt: string;
}

export type ErrorCode =
  | "session-gone"
  | "timeout"
  | "invalid-request"
  | "too-large"
  | "unsupported-version"
  | "inbox-full"
  | "internal";

export interface ProtocolError {
  code: ErrorCode;
  message: string;
}

export interface ErrorResponse {
  v: 1;
  ok: false;
  error: ProtocolError;
}

// Extension <-> native host (contracts/native-messaging.md)

export interface ListSessionsRequest {
  v: 1;
  type: "list-sessions";
  pageUrl: string;
  pageTitle: string;
}

export interface ListSessionsResponse {
  v: 1;
  ok: true;
  sessions: SessionSuggestion[];
}

export interface SendBatchRequest {
  v: 1;
  type: "send-batch";
  sessionId: string;
  batch: Batch;
}

export interface DeliveredResponse {
  v: 1;
  ok: true;
  batchId: string;
  deliveredAt: string;
  /** "pushed": sent as a channel event; "waiting": held for pick-up. Absent before 002. */
  status?: "pushed" | "waiting";
}

export interface BatchStatusRequest {
  v: 1;
  type: "batch-status";
  sessionId: string;
  batchIds: string[];
}

export type NativeRequest = ListSessionsRequest | SendBatchRequest | BatchStatusRequest;
export type NativeResponse =
  ListSessionsResponse | DeliveredResponse | StatusResponse | ErrorResponse;

// Native host <-> channel server (contracts/session-socket.md)

export interface InfoRequest {
  v: 1;
  type: "info";
}

export interface InfoResponse {
  v: 1;
  ok: true;
  session: Session;
}

export interface DeliverRequest {
  v: 1;
  type: "deliver";
  batch: Batch;
}

// Feature 002 (specs/002-no-channel-delivery/contracts/session-socket.md)

export interface StatusRequest {
  v: 1;
  type: "status";
  batchIds: string[];
}

export type BatchState = "waiting" | "picked-up" | "unknown";

export interface BatchStatus {
  batchId: string;
  state: BatchState;
  at: string | null;
}

export interface StatusResponse {
  v: 1;
  ok: true;
  statuses: BatchStatus[];
}

export interface PeekRequest {
  v: 1;
  type: "peek";
}

export interface PeekResponse {
  v: 1;
  ok: true;
  waiting: number;
  pages: string[];
}

export interface WaitRequest {
  v: 1;
  type: "wait";
}

export type WaitOutcome = "comments" | "timeout" | "expired" | "stopped" | "replaced";

export interface WaitResponse {
  v: 1;
  ok: true;
  outcome: WaitOutcome;
  waiting: number;
}

export type SocketRequest =
  InfoRequest | DeliverRequest | StatusRequest | PeekRequest | WaitRequest;
export type SocketResponse =
  InfoResponse | DeliveredResponse | StatusResponse | PeekResponse | WaitResponse | ErrorResponse;

export function errorResponse(code: ErrorCode, message: string): ErrorResponse {
  return { v: 1, ok: false, error: { code, message } };
}
