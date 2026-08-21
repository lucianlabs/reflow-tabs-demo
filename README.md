# "More Tabs" Menu Button (Overflow)

A working demo of one proposed solution for making the [ARIA Authoring Practices Guide (APG) Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) reflow gracefully when a tablist doesn't have room to show every tab.

## Purpose

The W3C ARIA and Assistive Technologies Community Group opened [aria-practices issue #2438](https://github.com/w3c/aria-practices/issues/2438) to determine how the APG's Tabs example should support reflow for an arbitrary number of tabs, since the current example simply overflows or wraps with no defined behavior. [The issue's proposal](https://github.com/w3c/aria-practices/issues/2438#issuecomment-4264466609) lays out four viable solutions for tablist reflow. This demo implements the fourth: a **"More Tabs" menu button (overflow)**.

## Mechanism

A menu button sits at the end of the tablist. As tabs stop fitting, they're moved out of the visible tablist and into a dropdown menu opened by that button, in the style of a typical "overflow" or "kebab" menu.

## Pros / Cons

This is a common, and by many measures elegant, approach — it's the pattern most users already recognize from toolbars and app menus. But of the four proposed solutions it's also the most complex from an accessibility standpoint:

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
@container tabs (max-width: 705px) {
  .tablist-row { --visible-count: 6; }
}
@container tabs (max-width: 585px) {
  .tablist-row { --visible-count: 5; }
}
/* …down to --visible-count: 1 at the narrowest breakpoint */
```

The breakpoint numbers are deliberately offset below round values (705px rather than 760px, and so on). A container query measures `.tabs-container`'s own content-box, which excludes its horizontal padding and its reserved scrollbar-gutter space — about 52px combined here — even though neither one takes width away from the tabs themselves. Without that offset, the container's normal resting width (with no resize at all) already measures just under the first breakpoint, so tabs would silently overflow into the menu by default.

Doing the size-to-tab-count mapping in CSS, rather than in JavaScript, means the thresholds live next to the styles they affect and the mapping updates synchronously with layout — no JS measurement pass has to run before the browser knows how many tabs currently fit.

### Reacting to size changes: `ResizeObserver`

JavaScript still needs to know *when* to re-read `--visible-count` and *act* on it — CSS can't move DOM nodes into a menu on its own. [`reflow-tabs.js`](reflow-tabs.js) watches `.tabs-container` with a `ResizeObserver`:

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
2. **Keep the active tab visible.** `promoteToLastVisibleSlot(activeId, visibleCount)` checks whether the currently-selected tab would fall outside the visible range at this width. If it would, it's moved to the last visible slot, and whatever tab was previously there is bumped into the overflow menu instead. This is what guarantees a user is never looking at a blank tablist because their selection silently scrolled out of view — it also covers the case where a tab is selected while visible and *then* the container shrinks past it.
3. **Diff before touching the DOM.** The resulting visible-tab-id sequence is compared against the sequence already applied. `ResizeObserver` can fire again for a size that's already been handled (settling can take a couple of frames), so this comparison keeps a redundant call from doing any DOM work at all — which also sidesteps a real Chromium quirk where re-appending an already-correctly-positioned node still blurs a focused descendant.
4. **Apply it.** Visible tab `<li>` elements are reordered in the DOM to match the working order, non-visible ones get the `hidden` attribute, and the overflow set is handed to `renderMenu()` to rebuild the `<ul role="menu">` contents (listed in the tabs' original order, not the working order, so the menu itself stays predictable rather than reshuffling based on what was most recently promoted).
5. **Update the live region.** A visually-hidden-adjacent status line (`aria-live="polite"`) announces how many of the tabs are currently showing, so screen reader users get the same "N of M tabs, rest in More" information sighted users get for free from the menu button simply existing.

### The two ARIA patterns in play

Because the tabs and the overflow menu are semantically distinct widgets, the JS implements two APG patterns side by side rather than inventing a hybrid:

- **[Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)**, with automatic activation — arrow keys move focus and activate the tab in the same step, `Home`/`End` jump to the first/last *visible* tab, and `aria-selected`/roving `tabindex` are kept in sync on every activation.
- **[Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)**, for the "More" dropdown — `aria-haspopup`/`aria-expanded` on the button, a roving-tabindex `role="menu"`/`role="menuitem"` list, arrow key/`Home`/`End`/`Escape`/typeahead navigation, and click-outside/focus-out closing.

Choosing a tab from the menu (`chooseFromMenu`) calls the same `setActiveTab` + `recomputeLayout` path a direct click would, so the newly-chosen tab gets promoted into the last visible slot exactly as described above, and focus moves to it afterward — closing the loop between "picked from the overflow menu" and "now behaves like any other visible tab."

## Keyboard shortcuts

| Key(s) | Action |
| --- | --- |
| <kbd>←</kbd> <kbd>→</kbd> | Move between visible tabs |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to the first / last visible tab |
| <kbd>↑</kbd> / <kbd>↓</kbd> on **More** | Open the overflow menu |
| <kbd>↑</kbd> / <kbd>↓</kbd> in the menu | Move between overflow items |
| <kbd>Enter</kbd> | Choose the focused menu item |
| <kbd>Esc</kbd> | Close the menu |

## Files

| File | Role |
| --- | --- |
| [`reflow-tabs.html`](reflow-tabs.html) | The tablist/panel markup — a complete, semantic APG tablist with no JS-dependent structure |
| [`reflow-tabs.css`](reflow-tabs.css) | Visual styling, the container-query breakpoints, and `--visible-count` |
| [`reflow-tabs.js`](reflow-tabs.js) | `ResizeObserver`-driven reflow calculation, tab activation, and the More menu's Menu Button behavior |

## Browser support

Relies on [CSS container queries](https://caniuse.com/css-container-queries) and `ResizeObserver`, both broadly supported in current Chrome, Edge, Firefox, and Safari. Older browsers simply see all tabs at their default `--visible-count` (no reflow, no overflow menu) rather than a broken layout.
