import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../../src/channel/render";
import { validateBatch } from "../../../../shared/validate";
import { makeBatch, makeComment, makeSelection } from "../../../../shared/fixtures";

describe("batch rendering (US3)", () => {
  it("renders 3 comments with a (3) header and sections 1–3 in order", () => {
    const batch = makeBatch({
      comments: ["first", "second", "third"].map((text, i) =>
        makeComment({
          id: `c${i}`,
          text,
          selection: makeSelection({ tag: ["h1", "table", "button"][i]!, classes: [] }),
        }),
      ),
    });
    const out = renderPrompt(batch);
    expect(out.split("\n")[0]).toBe(`Browser comments from ${batch.pageUrl} (3)`);
    const heads = out.split("\n").filter((l) => l.startsWith("## "));
    expect(heads).toEqual(["## 1. h1", "## 2. table", "## 3. button"]);
    expect(out.indexOf("Comment: first")).toBeLessThan(out.indexOf("Comment: second"));
    expect(out.indexOf("Comment: second")).toBeLessThan(out.indexOf("Comment: third"));
  });

  it("rejects a batch of 51 (data-model 1–50)", () => {
    const comments = Array.from({ length: 51 }, (_, i) => makeComment({ id: `c${i}` }));
    expect(validateBatch(makeBatch({ comments }))).toMatchObject({
      ok: false,
      code: "invalid-request",
    });
  });

  it("includes the frame line for iframe elements and the id in the label", () => {
    const out = renderPrompt(
      makeBatch({
        comments: [
          makeComment({ selection: makeSelection({ id: "x", frame: "http://a/inner.html" }) }),
        ],
      }),
    );
    expect(out).toContain("## 1. table#x.queue");
    expect(out).toContain("frame: http://a/inner.html");
  });

  it("renders a source hint without file and without hint", () => {
    const noFile = renderPrompt(
      makeBatch({
        comments: [
          makeComment({
            selection: makeSelection({
              source: { component: "Q", file: null, line: null, column: null, via: "vue" },
            }),
          }),
        ],
      }),
    );
    expect(noFile).toContain("source: Q  via vue");
    const fileNoLine = renderPrompt(
      makeBatch({
        comments: [
          makeComment({
            selection: makeSelection({
              source: {
                component: null,
                file: "a.svelte",
                line: null,
                column: null,
                via: "svelte",
              },
            }),
          }),
        ],
      }),
    );
    expect(fileNoLine).toContain("source: - (a.svelte)  via svelte");
    expect(renderPrompt(makeBatch())).toContain("source: -\n");
  });
});
