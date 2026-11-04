// Messages between content scripts / popup and the background page.

import type { Comment, Session } from "../../../shared/types";

export type BackgroundCall =
  | { type: "resolve-target"; pageUrl: string; pageTitle: string }
  | { type: "list-sessions"; pageUrl: string; pageTitle: string }
  | { type: "confirm-target"; pageUrl: string; session: Session }
  | {
      type: "send";
      pageUrl: string;
      sessionId: string;
      projectName: string;
      comments: Comment[];
      batchId: string;
    };

export type PopupCall =
  | { type: "toggle-picker"; tabId?: number }
  | { type: "popup-state"; tabId?: number }
  | { type: "forget-target"; pageUrl: string }
  /** Refresh the pick-up state of this origin's waiting sends; answers the history. */
  | { type: "batch-status"; origin: string }
  | { type: "resend"; origin: string; batchId: string };

export type TabMessage = { type: "toggle" } | { type: "ping" };
