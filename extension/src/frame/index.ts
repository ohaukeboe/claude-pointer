// Comment frame entry: an extension page embedded in the overlay, so page scripts cannot
// observe typing. Waits for the content script's port, then renders the comment box.

import { FRAME_CSS, OVERLAY_CSS } from "../content/overlay/styles";
import { acceptPort, createCommentView } from "./comment-view";

const style = document.createElement("style");
style.textContent = OVERLAY_CSS + FRAME_CSS;
document.head.append(style);

void acceptPort(window, location.hash.slice(1)).then((port) =>
  createCommentView(port, document, document.body),
);
