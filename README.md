# "More Tabs" Menu Button (Overflow)

Demo of one proposed solution for tablist reflow in the [ARIA Authoring Practices Guide (APG) Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

## Purpose

The W3C ARIA and Assistive Technologies Community Group opened [aria-practices issue #2438](https://github.com/w3c/aria-practices/issues/2438) to define how the APG's Tabs example should handle reflow for an arbitrary number of tabs. [The issue's proposal](https://github.com/w3c/aria-practices/issues/2438#issuecomment-4264466609) lists four viable solutions. This demo implements the fourth: a **"More Tabs" menu button (overflow)**.

## Mechanism

A menu button sits at the end of the tablist. Tabs that don't fit are moved out of the visible tablist into a dropdown menu opened by that button.

## Pros / Cons

Common approach, recognizable from toolbars and app menus. Most complex of the four solutions from an accessibility standpoint:

- `button` is not an allowed child of an element with `role="tablist"`, so the menu button must live outside the tablist rather than as a peer of the `tab` elements it stands in for.
- A `tab` element made to behave like a menu button violates the intent of the `tab` role and is confusing to assistive technology users, since it would announce as a tab while behaving as a menu trigger.
- May become more viable once [`aria-actions`](https://github.com/w3c/aria/issues/1980) is available, allowing a tab-like element to expose a secondary action without overloading the `tab` role.

This demo keeps the More button outside `role="tablist"` and does not use a `tab` element as a menu trigger. It's a plain `<button>` placed immediately after the tablist `<ul>` in the DOM (see [`reflow-tabs.html`](reflow-tabs.html)); `role="tablist"` contains only `tab` elements.

## How this demo implements it

### Measuring available space: CSS container queries

[`.tabs-container`](reflow-tabs.css) is a [CSS container query](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries) context (`container-type: inline-size`). `@container tabs (max-width: …)` rules on `.tablist-row` set a `--visible-count` custom property based on the container's own width, not the viewport:

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
/* down to --visible-count: 1 */
```

A container query only measures `.tabs-container`'s pixel width. It can't see how wide the currently-visible tabs are, and the visible set changes at runtime — selecting an overflowed tab from the More menu promotes it into the last visible slot, displacing another tab. Thresholds tuned to the default tab order fit only that combination and wrap for any wider one.

Each threshold is sized for the worst case instead: the N widest tab labels of all 8, not whichever N happen to be first. No combination of N visible tabs is ever wider than the N widest tabs overall, so this guarantees N tabs fit regardless of which N are shown. Cost: the container may show one fewer tab than the current combination could actually fit.

Each threshold's value is the sum of the N widest tab widths, the gaps between them, the gap before the More button, and the More button's own width — measured from the rendered demo and rounded up. (integrations 112 / overview 95 / analytics 90 / settings 84 / activity 79 / billing 70 / team 64 / files 58; tab gap 4; row gap 6.4; More button 77.) There is no `--visible-count: 7` tier: 7 of the widest tabs plus the More button need more room than all 8 tabs need with no button, so that tier is unreachable.

A `max-width` rule stays in effect down to the next rule's threshold, not just at its own boundary. Each threshold is therefore the requirement for the next tier up, not its own: the value on the `--visible-count: 6` rule is what 6 of the widest tabs need, and marks the point where 8 tabs stop fitting. `.tabs-container`'s `min-width: 255px` covers the narrowest tier the same way, sized for its own worst case (a lone "Integrations" tab plus the More button), since there is no narrower rule to hand off to.

#### Why not measure real widths in JS instead

A more precise approach: cache each tab's rendered width once (labels are static), then have `recomputeLayout()` sum real widths to compute the exact number of tabs that fit for the current combination. Not implemented here:

- Real-width fitting reruns on more triggers (resize, zoom, font-size changes) than a coarse CSS breakpoint read, running the DOM-reordering path in `recomputeLayout()` more often — the same path where a redundant run was found to steal focus from a just-selected tab (see below).
- The `aria-live` status line currently changes at a few coarse steps. Pixel-accurate fitting recalculates on every resize tick, which would announce every intermediate count during a drag-resize without added debouncing.
- `hidden` sets `display: none`, and elements with `display: none` measure as zero width, so widths must be cached before anything is hidden, not measured live off overflowed tabs.

### Reacting to size changes: `ResizeObserver`

[`reflow-tabs.js`](reflow-tabs.js) watches `.tabs-container` with a `ResizeObserver`:

```js
const ro = new ResizeObserver(() =>
  window.requestAnimationFrame(recomputeLayout),
);
ro.observe(container);
```

A size change — resize-handle drag, window resize, or a layout change around the widget — schedules `recomputeLayout()` on the next animation frame.

### The reflow calculation

`recomputeLayout()`:

1. **Read the target count.** `getVisibleCount()` reads `--visible-count` off `.tablistRow`, clamped to the real number of tabs.
2. **Keep the active tab visible.** `promoteToLastVisibleSlot(activeId, visibleCount)` moves the active tab into the last visible slot if it would otherwise fall outside the visible range, bumping whatever tab was there into the menu. Covers both an explicit menu selection and a resize that squeezes the active tab out.
3. **Diff before touching the DOM.** The resulting visible-tab-id sequence is compared against the sequence already applied. `ResizeObserver` can fire again for a size already handled; this skips redundant DOM work, including a Chromium behavior where re-appending an already-correctly-positioned node still blurs a focused descendant.
4. **Apply it.** Visible `<li>` elements are reordered to match the working order, non-visible ones get `hidden`, and the overflow set is passed to `renderMenu()` to rebuild `<ul role="menu">` (in original tab order, not the working order).
5. **Update the live region.** `aria-live="polite"` status text reports how many tabs are showing.

### The two ARIA patterns in play

- **[Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)**, automatic activation — arrow keys move focus and activate in one step, `Home`/`End` jump to the first/last visible tab, `aria-selected`/roving `tabindex` stay in sync on activation.
- **[Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)**, for the More dropdown — `aria-haspopup`/`aria-expanded`, roving-tabindex `role="menu"`/`role="menuitem"`, arrow key/`Home`/`End`/`Escape`/typeahead navigation, click-outside/focus-out closing.

Choosing a tab from the menu (`chooseFromMenu`) calls the same `setActiveTab` + `recomputeLayout` path as a direct click, so the chosen tab is promoted into the last visible slot and focus moves to it.

## Keyboard shortcuts

| Key(s)                                  | Action                               |
| ---------------------------------------- | ------------------------------------ |
| <kbd>←</kbd> <kbd>→</kbd>               | Move between visible tabs            |
| <kbd>Home</kbd> / <kbd>End</kbd>        | Jump to the first / last visible tab |
| <kbd>↑</kbd> / <kbd>↓</kbd> on **More** | Open the overflow menu               |
| <kbd>↑</kbd> / <kbd>↓</kbd> in the menu | Move between overflow items          |
| <kbd>Enter</kbd>                        | Choose the focused menu item         |
| <kbd>Esc</kbd>                          | Close the menu                       |

## Files

| File                                   | Role                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`reflow-tabs.html`](reflow-tabs.html) | Tablist/panel markup — a complete, semantic APG tablist with no JS-dependent structure                |
| [`reflow-tabs.css`](reflow-tabs.css)   | Visual styling, container-query breakpoints, `--visible-count`                                        |
| [`reflow-tabs.js`](reflow-tabs.js)     | `ResizeObserver`-driven reflow calculation, tab activation, More menu's Menu Button behavior          |

## Browser support

Requires [CSS container queries](https://caniuse.com/css-container-queries) and `ResizeObserver`, both supported in current Chrome, Edge, Firefox, and Safari. Unsupported browsers show all tabs at the default `--visible-count` (no reflow, no overflow menu).
