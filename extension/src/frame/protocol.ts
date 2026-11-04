// Messages between the content script and the comment frame, over one MessagePort.

/** Content script to frame. */
export type ViewMessage =
  | {
      type: "init";
      label: string;
      allowAdd: boolean;
      canDelete: boolean;
      initialText?: string;
      addLabel?: string;
    }
  | { type: "busy"; busy: boolean }
  | { type: "status"; kind: "info" | "ok" | "error"; text: string }
  | { type: "focus" };

/** Frame to content script. */
export type FrameMessage =
  | { type: "send"; text: string }
  | { type: "add"; text: string }
  | { type: "delete" }
  | { type: "close" }
  | { type: "size"; height: number };

/** First message to the frame, carrying the port; `nonce` comes from the frame URL hash. */
export interface FrameHandshake {
  type: "claude-pointer-init";
  nonce: string;
}

export const FRAME_PAGE = "comment-frame.html";
