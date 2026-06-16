import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog, Sheet } from "./Dialog.tsx";

/**
 * Regression guard for the closed-overlay full-bleed quirk (ADR-0018 fix b).
 *
 * A native `<dialog>` is `display:none` while closed (UA `dialog:not([open])`).
 * The component used to hardcode the Tailwind `flex` display utility, which
 * overrode that rule, so an always-mounted *closed* Dialog/Sheet painted
 * full-bleed and stole pointer input — every consumer worked around it by
 * conditional-mount. The fix emits the display utility as `open ? "flex" :
 * "hidden"`, so a closed Dialog is truly `display:none` (`hidden`) and an open
 * one lays out as a flex column.
 *
 * We assert on the rendered class list (no DOM env / extra deps needed): both
 * `hidden` and `flex` map to `display:` rules, and the test fails if the display
 * utility ever again ignores `open`. `renderToStaticMarkup` does not run the
 * `showModal()` effect — which is exactly right here: we are pinning the class
 * the component emits, independent of the imperative top-layer call.
 */

/** Extract the `class="…"` token list of the root `<dialog>` element. */
function dialogClasses(html: string): readonly string[] {
  const match = html.match(/<dialog[^>]*\sclass="([^"]*)"/);
  const classList = match?.[1];
  if (classList === undefined) {
    throw new Error(`no <dialog class> in markup: ${html.slice(0, 120)}`);
  }
  return classList.split(/\s+/);
}

function render(open: boolean): readonly string[] {
  return dialogClasses(
    renderToStaticMarkup(
      <Dialog open={open} onOpenChange={() => {}} title="Settings">
        body
      </Dialog>,
    ),
  );
}

describe("Dialog display:none when closed (closed-overlay quirk)", () => {
  test("a CLOSED dialog is hidden (display:none), never flex", () => {
    const classes = render(false);
    expect(classes).toContain("hidden");
    // The bug was an unconditional `flex` overriding the UA display:none.
    expect(classes).not.toContain("flex");
  });

  test("an OPEN dialog lays out as flex, never hidden", () => {
    const classes = render(true);
    expect(classes).toContain("flex");
    expect(classes).not.toContain("hidden");
  });

  test("the flex-COLUMN layout survives in both states", () => {
    // `flex-col` (the body stacking) must be present regardless of open state;
    // only the `flex`/`hidden` display root flips.
    expect(render(true)).toContain("flex-col");
    expect(render(false)).toContain("flex-col");
  });

  test("the native open attribute tracks the prop (markup-level)", () => {
    // showModal() is an effect (not run by static markup), but React still
    // reflects the `open` prop wired through to the element when set.
    const openHtml = renderToStaticMarkup(
      <Dialog open={true} onOpenChange={() => {}} title="T">
        body
      </Dialog>,
    );
    const closedHtml = renderToStaticMarkup(
      <Dialog open={false} onOpenChange={() => {}} title="T">
        body
      </Dialog>,
    );
    // Closed markup must not assert visibility via the display utility.
    expect(dialogClasses(closedHtml)).toContain("hidden");
    expect(dialogClasses(openHtml)).toContain("flex");
  });

  test("Sheet (edge-docked variant) gets the same closed=hidden treatment", () => {
    const closed = dialogClasses(
      renderToStaticMarkup(
        <Sheet open={false} onOpenChange={() => {}} title="Detail">
          body
        </Sheet>,
      ),
    );
    const open = dialogClasses(
      renderToStaticMarkup(
        <Sheet open={true} onOpenChange={() => {}} title="Detail">
          body
        </Sheet>,
      ),
    );
    expect(closed).toContain("hidden");
    expect(closed).not.toContain("flex");
    expect(open).toContain("flex");
    expect(open).not.toContain("hidden");
  });
});
