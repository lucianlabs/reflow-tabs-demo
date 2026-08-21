(() => {
  "use strict";

  const widgetRoot = document.querySelector('[data-js="tabs"]');
  if (!widgetRoot) return;

  const DECIMAL_RADIX = 10;
  const MIN_VISIBLE_COUNT = 1;
  const TYPEAHEAD_RESET_MS = 600;

  const container = document.getElementById("tabsContainer");
  const tablistRow = document.getElementById("tablistRow");
  const tablistEl = document.getElementById("tablist");
  const moreWrapper = document.getElementById("moreWrapper");
  const moreButton = document.getElementById("moreButton");
  const moreMenu = document.getElementById("moreMenu");
  const statusEl = document.getElementById("tabsStatus");

  const staticItems = Array.from(tablistEl.querySelectorAll(".tab-item"));

  const tabsData = staticItems.map((li) => {
    const id = li.getAttribute("data-tab-id");
    const tabEl = li.querySelector(".tab");
    return {
      id: id,
      label: tabEl.textContent.trim(),
      itemEl: li,
      tabEl: tabEl,
      panelEl: document.getElementById("panel-" + id),
    };
  });

  // `order` is the left-to-right display order: order[0..visibleCount-1]
  // are visible, the rest are in the More menu. Only promoteToLastVisibleSlot
  // moves entries, and only the one being promoted.
  const order = tabsData.map((t) => t.id);
  let activeId = tabsData[0].id;

  // Runs the initial selection through the normal code path instead of
  // trusting the HTML's hardcoded defaults.
  setActiveTab(activeId);

  function tabById(id) {
    for (let i = 0; i < tabsData.length; i++)
      if (tabsData[i].id === id) return tabsData[i];
    return null;
  }

  // ---- Activation (APG Tabs: automatic activation) -----------------------
  function setActiveTab(id) {
    activeId = id;
    // Reveals the new panel before hiding the old one, so both are visible
    // for one instant instead of neither. Hiding the old panel first would
    // briefly collapse the panel area to zero height; browsers can respond
    // by clamping scroll position, then snapping back once the new panel
    // appears.
    tabById(id).panelEl.hidden = false;
    tabsData.forEach((t) => {
      const selected = t.id === id;
      t.tabEl.setAttribute("aria-selected", String(selected));
      t.tabEl.tabIndex = selected ? 0 : -1;
      if (!selected) t.panelEl.hidden = true;
    });
  }

  function visibleTabs() {
    // Reads from the DOM, not tabsData: recomputeLayout() reorders
    // tab-items to match `order`, so tabsData's array order drifts from
    // what's rendered.
    return Array.from(tablistEl.children)
      .filter((li) => !li.hidden)
      .map((li) => tabById(li.getAttribute("data-tab-id")));
  }

  function focusTabByOffset(offset) {
    const visible = visibleTabs();
    let currentIndex = visible.findIndex(
      (t) => t.tabEl === document.activeElement,
    );
    if (currentIndex === -1)
      currentIndex = visible.findIndex((t) => t.id === activeId);
    const next = (currentIndex + offset + visible.length) % visible.length;
    const target = visible[next];
    setActiveTab(target.id);
    target.tabEl.focus();
  }

  tablistEl.addEventListener("click", (event) => {
    const tabEl = event.target.closest(".tab");
    if (!tabEl) return;
    const tab = tabsData.find((t) => t.tabEl === tabEl);
    if (tab) setActiveTab(tab.id);
  });

  tablistEl.addEventListener("keydown", (event) => {
    const visible = visibleTabs();
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusTabByOffset(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusTabByOffset(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveTab(visible[0].id);
        visible[0].tabEl.focus();
        break;
      case "End":
        event.preventDefault();
        setActiveTab(visible[visible.length - 1].id);
        visible[visible.length - 1].tabEl.focus();
        break;
    }
  });

  // ---- Container-query-driven overflow -----------------------------------
  let lastStatusText = "";

  // Visible-tab id sequence currently applied to the DOM. recomputeLayout()
  // can run again for a size that hasn't changed (ResizeObserver settling
  // can take a couple of frames). appendChild() below detaches and
  // reattaches every visible tab even when already in place, which blurs a
  // tab that was just focused (e.g. via a More-menu selection) with nothing
  // to refocus it. Skipping DOM work when nothing changed avoids that.
  let lastVisibleIds = null;

  function idsEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function getVisibleCount() {
    const raw =
      getComputedStyle(tablistRow).getPropertyValue("--visible-count");
    const parsedCount = Number.parseInt(raw, DECIMAL_RADIX);
    const hasValidVisibleCount =
      Number.isFinite(parsedCount) && parsedCount >= MIN_VISIBLE_COUNT;

    return hasValidVisibleCount
      ? Math.min(parsedCount, tabsData.length)
      : tabsData.length;
  }

  // Moves `id` into the last visible slot if it isn't already visible,
  // bumping whatever tab was there into the menu. Every other visible tab
  // keeps its position.
  function promoteToLastVisibleSlot(id, visibleCount) {
    const idx = order.indexOf(id);
    if (idx === -1 || idx < visibleCount) return;
    order.splice(idx, 1);
    const insertAt = Math.min(visibleCount - 1, order.length);
    order.splice(insertAt, 0, id);
  }

  function recomputeLayout() {
    const visibleCount = getVisibleCount();

    // The active tab must never end up hidden. If a resize squeezes it
    // out, it's promoted the same as an explicit menu selection.
    promoteToLastVisibleSlot(activeId, visibleCount);

    const visibleIds = order.slice(0, visibleCount);

    // Skips DOM work if nothing changed; see lastVisibleIds above.
    if (idsEqual(visibleIds, lastVisibleIds)) return;
    lastVisibleIds = visibleIds;

    // Reorder tab-items in the DOM to match `order`.
    visibleIds.forEach((id) => tablistEl.appendChild(tabById(id).itemEl));

    const visibleSet = {};
    visibleIds.forEach((id) => {
      visibleSet[id] = true;
    });

    tabsData.forEach((t) => {
      t.itemEl.hidden = !visibleSet[t.id];
    });

    // List menu items in original tab order (not `order`) so the menu stays
    // predictable.
    const overflow = tabsData.filter((t) => !visibleSet[t.id]);

    if (overflow.length === 0) {
      moreWrapper.hidden = true;
      closeMenu({ restoreFocus: false });
    } else {
      moreWrapper.hidden = false;
      renderMenu(overflow);
    }

    const statusText = `Showing ${tabsData.length - overflow.length} of ${tabsData.length} tabs${overflow.length ? ` — ${overflow.length} in the More menu.` : "."}`;

    if (statusText !== lastStatusText) {
      statusEl.textContent = statusText;
      lastStatusText = statusText;
    }
  }

  function renderMenu(overflowTabs) {
    moreMenu.innerHTML = "";
    overflowTabs.forEach((t) => {
      const li = document.createElement("li");
      li.setAttribute("role", "none");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.id = "menuitem-" + t.id;
      btn.tabIndex = -1;
      btn.textContent = t.label;
      btn.setAttribute("data-tab-id", t.id);
      li.appendChild(btn);
      moreMenu.appendChild(li);
    });
  }

  const ro = new ResizeObserver(() =>
    window.requestAnimationFrame(recomputeLayout),
  );
  ro.observe(container);
  recomputeLayout();

  // ---- More menu: APG Menu Button pattern --------------------------------

  function menuItems() {
    return Array.from(moreMenu.querySelectorAll('[role="menuitem"]'));
  }

  function openMenu(focusPosition) {
    moreMenu.hidden = false;
    moreButton.setAttribute("aria-expanded", "true");
    const items = menuItems();
    items.forEach((el) => {
      el.tabIndex = -1;
    });
    const target =
      focusPosition === "last" ? items[items.length - 1] : items[0];
    if (target) {
      target.tabIndex = 0;
      target.focus();
    }
  }

  function closeMenu(opts) {
    opts = opts || {};
    if (moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
    if (opts.restoreFocus !== false) moreButton.focus();
  }

  function isMenuOpen() {
    return !moreMenu.hidden;
  }

  moreButton.addEventListener("click", () => {
    if (isMenuOpen()) closeMenu();
    else openMenu("first");
  });

  moreButton.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        openMenu("first");
        break;
      case "ArrowUp":
        event.preventDefault();
        openMenu("last");
        break;
    }
  });

  function focusMenuItemByOffset(offset) {
    const items = menuItems();
    const current = items.indexOf(document.activeElement);
    const next = (current + offset + items.length) % items.length;
    items.forEach((el) => {
      el.tabIndex = -1;
    });
    items[next].tabIndex = 0;
    items[next].focus();
  }

  let typeaheadBuffer = "";
  let typeaheadTimer = null;

  moreMenu.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusMenuItemByOffset(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusMenuItemByOffset(-1);
        break;
      case "Home":
        event.preventDefault();
        focusMenuItemByOffset(-menuItems().length); // wraps to 0
        break;
      case "End": {
        event.preventDefault();
        const items = menuItems();
        items.forEach((el) => {
          el.tabIndex = -1;
        });
        items[items.length - 1].tabIndex = 0;
        items[items.length - 1].focus();
        break;
      }
      case "Escape":
        event.preventDefault();
        closeMenu();
        break;
      case "Enter":
      case " ":
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          typeaheadBuffer += event.key.toLowerCase();
          clearTimeout(typeaheadTimer);
          typeaheadTimer = setTimeout(() => {
            typeaheadBuffer = "";
          }, TYPEAHEAD_RESET_MS);
          const items = menuItems();
          const start = items.indexOf(document.activeElement) + 1;
          for (let i = 0; i < items.length; i++) {
            const idx = (start + i) % items.length;
            if (
              items[idx].textContent
                .trim()
                .toLowerCase()
                .indexOf(typeaheadBuffer) === 0
            ) {
              items.forEach((el) => {
                el.tabIndex = -1;
              });
              items[idx].tabIndex = 0;
              items[idx].focus();
              break;
            }
          }
        }
    }
  });

  moreMenu.addEventListener("click", (event) => {
    const item = event.target.closest('[role="menuitem"]');
    if (!item) return;
    chooseFromMenu(item.getAttribute("data-tab-id"));
  });

  // Selecting a menu item makes it active; recomputeLayout() then promotes
  // it into the last visible slot, bumping another tab into the menu.
  function chooseFromMenu(id) {
    // Close first so recomputeLayout()'s menu rebuild happens on an already-
    // hidden menu instead of flashing the item that was just clicked.
    closeMenu({ restoreFocus: false });
    setActiveTab(id);
    recomputeLayout();
    tabById(id).tabEl.focus();
  }

  document.addEventListener("click", (event) => {
    if (isMenuOpen() && !moreWrapper.contains(event.target)) {
      closeMenu({ restoreFocus: false });
    }
  });

  moreWrapper.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (isMenuOpen() && !moreWrapper.contains(document.activeElement)) {
        closeMenu({ restoreFocus: false });
      }
    }, 0);
  });
})();
