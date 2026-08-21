# "More Tabs" Menu Button (Overflow)

A working demo of one proposed solution for making the [ARIA Authoring Practices Guide (APG) Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) reflow gracefully when a tablist doesn't have room to show every tab.

## Purpose

The W3C ARIA and Assistive Technologies Community Group opened [aria-practices issue #2438](https://github.com/w3c/aria-practices/issues/2438) to determine how the APG's Tabs example should support reflow for an arbitrary number of tabs, since the current example simply overflows or wraps with no defined behavior. [The issue's proposal](https://github.com/w3c/aria-practices/issues/2438#issuecomment-4264466609) lays out four viable solutions for tablist reflow. This demo implements the fourth: a **"More Tabs" menu button (overflow)**.

## Mechanism

A menu button sits at the end of the tablist. As tabs stop fitting, they're moved out of the visible tablist and into a dropdown menu opened by that button, in the style of a typical "overflow" or "kebab" menu.

## Pros / Cons

This is a common and refined approach — it's the pattern most users already recognize from toolbars and app menus. But of the four proposed solutions it's also the most complex from an accessibility standpoint:

- `button` is not an allowed child of an element with `role="tablist"` per the ARIA spec, so the menu button has to live outside the tablist itself (structurally adjacent to it, not inside it) rather than as a peer of the `tab` elements it's standing in for.
- Making a `tab` element behave like a menu button — as an alternative structure might attempt, to keep it "inside" the tablist — violates the intent of the `tab` role and is confusing for assistive technology users, since it would announce as a tab while actually behaving like a menu trigger.
- This pattern may become more viable once [`aria-actions`](https://github.com/w3c/aria/issues/1980) is available, which would allow a tab-like element to formally expose a secondary action (open the overflow menu) without overloading the `tab` role's semantics.

This demo takes the structurally-conforming route rather than the confusing one: the More button is not a child of the `role="tablist"` element, and it isn't a `role="tab"` pretending to be a menu trigger. It's a plain `<button>` that sits adjacent to the tablist, immediately after it in the DOM (see [`reflow-tabs.html`](reflow-tabs.html)) — `role="tablist"` still only ever contains `tab` elements, and the menu button reads as exactly what it is to assistive technology.

## How this demo implements it

### Measuring available space: CSS container queries

[`.tabs-container`](reflow-tabs.css) is a [CSS container query](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries) context (`container-type: inline-size`). A stack of `@container tabs (max-width: …)` rules on `.tablist-row` sets a `--visible-count` custom property — the number of tabs that should be visible — based purely on the container's own current width, not the viewport:

```css
.tablist-row {
  --visible-count: 8; /* default: everything fits */
}
@container tabs (max-width: 688px) {
  .tablist-row {
    --visible-count: 6;
  }
}
@container tabs (max-width: 640px) {
  .tablist-row {
    --visible-count: 5;
  }
}
/* …down to --visible-count: 1 at the narrowest breakpoint */
```

A container query only ever sees `.tabs-container`'s own pixel width — it has no way to know how wide the *specific* tabs currently in view actually are, and which tabs are visible isn't fixed: picking an overflowed tab from the More menu promotes it into the last visible slot, bumping whatever was there into the menu instead. Tuning each threshold against the default tab order's width would fit that one combination and then wrap onto a second line the moment a wider-labeled combination ends up visible instead — which is exactly the failure this component exists to avoid.

So instead, every threshold is sized for the worst case: assuming the *N widest tab labels of all 8* are the ones showing, not just whichever N happen to be first. That's a real, if pessimistic, upper bound — no actual combination of N visible tabs can ever be wider than the N widest tabs overall, so sizing against it guarantees N tabs always fit, regardless of which N they turn out to be. The trade-off, chosen deliberately over a JS pixel-measurement rewrite (see [Why not measure real widths in JS instead?](#why-not-measure-real-widths-in-js-instead) below), is that a container sometimes shows one fewer tab than the *current* combination could technically fit, in exchange for a guarantee that nothing ever wraps.

There's a second, less obvious wrinkle: a `max-width` rule stays in effect all the way down to the *next* rule's threshold, not just at its own boundary — so `--visible-count: 6`'s safety has to hold across that entire span, right down to where `--visible-count: 5` takes over. The only width that actually guarantees that lower edge is safe is the width the *5*-tab worst case needs, because below that point 5 has already taken over. So each rule's `max-width` is keyed to the *next tier up's* requirement, not its own — the `688px` above is what all 6 of the widest tab labels plus the More button need, and it's written on the rule that hands off from 8 tabs to 6. `.tabs-container`'s `min-width: 255px` closes the last gap: the narrowest tier has no smaller rule to hand off to, so the container simply isn't allowed to shrink past the point where even its own worst case (a lone "Integrations" tab + the More button) stops fitting.

Doing the size-to-tab-count mapping in CSS, rather than in JavaScript, means the thresholds live next to the styles they affect and the mapping updates synchronously with layout — no JS measurement pass has to run before the browser knows how many tabs currently fit.

#### Why not measure real widths in JS instead?

The precise fix would be to drop the worst-case guesswork entirely: cache every tab's real rendered width once (labels are static, so a one-time measurement is enough), then have `recomputeLayout()` sum real widths — not label-agnostic tiers — to compute the exact number of tabs that fit for whatever combination is currently visible. That's strictly more accurate, and it's what a production version of this pattern should probably do.

It was deliberately not done here, because the added precision comes back around and lands on the exact things this demo is supposed to model carefully:

- **More frequent recomputation, more chances to regress focus handling.** Real-width fitting has to rerun on more triggers (resize, zoom, font-size changes) than a coarse CSS breakpoint read, which means the DOM-reordering path in `recomputeLayout()` runs more often — precisely the path where a redundant run was already found to silently steal focus from a just-selected tab (see the reflow calculation below). Each additional trigger is another chance to reopen that bug.
- **Noisier screen reader announcements.** The `aria-live` status line currently only changes at a handful of coarse, discrete steps. Pixel-accurate fitting recalculates on every resize tick, so without deliberate debouncing a screen reader user dragging the resize handle would hear a rapid "Showing 5 of 8… Showing 4 of 8… Showing 5 of 8…" instead of a few meaningful updates.
- **A measurement-ordering trap.** `hidden` sets `display: none`, and elements with `display: none` measure as zero width — so widths have to be cached *before* anything is ever hidden, not measured live off the currently-overflowed tabs. Getting that ordering wrong doesn't fail loudly; it just silently breaks the fit calculation.

None of these are unsolvable, but they're real complexity added to the two areas — focus management and AT announcements — that took the most careful work to get right elsewhere in this demo. For a reference implementation of one accessibility pattern, the CSS-only worst-case approach's cost (occasionally showing one fewer tab than the current combination could technically fit) was judged cheaper than reopening that surface.

### Reacting to size changes: `ResizeObserver`

JavaScript still needs to know _when_ to re-read `--visible-count` and _act_ on it — CSS can't move DOM nodes into a menu on its own. [`reflow-tabs.js`](reflow-tabs.js) watches `.tabs-container` with a `ResizeObserver`:

```js
const ro = new ResizeObserver(() =>
  window.requestAnimationFrame(recomputeLayout),
);
ro.observe(container);
```

Whenever the container's box size changes — the user drags the resize handle, the window resizes, or the widget is dropped into a layout that changes around it — the observer's callback schedules `recomputeLayout()` on the next animation frame (deferring to `requestAnimationFrame` keeps the DOM work off the observer's own callback timing, which the spec recommends against mutating synchronously within).

### The reflow calculation

`recomputeLayout()` does the actual work of deciding which tabs are visible and which are in the menu:

1. **Read the target count.** `getVisibleCount()` reads the computed `--visible-count` value off `.tablistRow` and clamps it to the real number of tabs.
2. **Keep the active tab visible.** `promoteToLastVisibleSlot(activeId, visibleCount)` checks whether the currently-selected tab would fall outside the visible range at this width. If it would, it's moved to the last visible slot, and whatever tab was previously there is bumped into the overflow menu instead. This is what guarantees a user is never looking at a blank tablist because their selection silently scrolled out of view — it also covers the case where a tab is selected while visible and _then_ the container shrinks past it.
3. **Diff before touching the DOM.** The resulting visible-tab-id sequence is compared against the sequence already applied. `ResizeObserver` can fire again for a size that's already been handled (settling can take a couple of frames), so this comparison keeps a redundant call from doing any DOM work at all — which also sidesteps a real Chromium quirk where re-appending an already-correctly-positioned node still blurs a focused descendant.
4. **Apply it.** Visible tab `<li>` elements are reordered in the DOM to match the working order, non-visible ones get the `hidden` attribute, and the overflow set is handed to `renderMenu()` to rebuild the `<ul role="menu">` contents (listed in the tabs' original order, not the working order, so the menu itself stays predictable rather than reshuffling based on what was most recently promoted).
5. **Update the live region.** A visually-hidden-adjacent status line (`aria-live="polite"`) announces how many of the tabs are currently showing, so screen reader users get the same "N of M tabs, rest in More" information sighted users get for free from the menu button simply existing.

### The two ARIA patterns in play

Because the tabs and the overflow menu are semantically distinct widgets, the JS implements two APG patterns side by side rather than inventing a hybrid:

- **[Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)**, with automatic activation — arrow keys move focus and activate the tab in the same step, `Home`/`End` jump to the first/last _visible_ tab, and `aria-selected`/roving `tabindex` are kept in sync on every activation.
- **[Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)**, for the "More" dropdown — `aria-haspopup`/`aria-expanded` on the button, a roving-tabindex `role="menu"`/`role="menuitem"` list, arrow key/`Home`/`End`/`Escape`/typeahead navigation, and click-outside/focus-out closing.

Choosing a tab from the menu (`chooseFromMenu`) calls the same `setActiveTab` + `recomputeLayout` path a direct click would, so the newly-chosen tab gets promoted into the last visible slot exactly as described above, and focus moves to it afterward — closing the loop between "picked from the overflow menu" and "now behaves like any other visible tab."

## Keyboard shortcuts

| Key(s)                                  | Action                               |
| --------------------------------------- | ------------------------------------ |
| <kbd>←</kbd> <kbd>→</kbd>               | Move between visible tabs            |
| <kbd>Home</kbd> / <kbd>End</kbd>        | Jump to the first / last visible tab |
| <kbd>↑</kbd> / <kbd>↓</kbd> on **More** | Open the overflow menu               |
| <kbd>↑</kbd> / <kbd>↓</kbd> in the menu | Move between overflow items          |
| <kbd>Enter</kbd>                        | Choose the focused menu item         |
| <kbd>Esc</kbd>                          | Close the menu                       |

## Files

| File                                   | Role                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`reflow-tabs.html`](reflow-tabs.html) | The tablist/panel markup — a complete, semantic APG tablist with no JS-dependent structure           |
| [`reflow-tabs.css`](reflow-tabs.css)   | Visual styling, the container-query breakpoints, and `--visible-count`                               |
| [`reflow-tabs.js`](reflow-tabs.js)     | `ResizeObserver`-driven reflow calculation, tab activation, and the More menu's Menu Button behavior |

## Browser support

Relies on [CSS container queries](https://caniuse.com/css-container-queries) and `ResizeObserver`, both broadly supported in current Chrome, Edge, Firefox, and Safari. Older browsers simply see all tabs at their default `--visible-count` (no reflow, no overflow menu) rather than a broken layout.
