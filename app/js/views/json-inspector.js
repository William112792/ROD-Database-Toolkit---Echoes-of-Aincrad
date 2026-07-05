// ============================================================
// json-inspector.js
// Raw JSON browser for reverse-engineering: lets the user pick
// any weapon (by display name OR raw ItemKey) and see the exact
// underlying JSON record the app is using, plus the source file
// it came from. Built per spec's "JSON inspector" UI requirement.
// ============================================================

const JsonInspectorView = {
  state: {
    selectedItemKey: null,
    search: "",
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-panel" id="inspectorDevRef" style="margin-bottom:14px;"></div>
      <div class="toolbar">
        <input type="text" class="search-input" id="inspectorSearch"
               placeholder="Find by display name or ItemKey..." />
      </div>
      <div class="equip-layout two-col" style="--list-col: 320px;">
        <div id="inspectorList"></div>
        <div id="inspectorDetail"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderDevRefStrip();

    document.getElementById("inspectorSearch").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderList({ resetScroll: true });
    });

    this.renderList();
    this.renderDetail();
  },

  renderDevRefStrip() {
    const el = document.getElementById("inspectorDevRef");
    const devRef = DataStore.devReference;
    if (!devRef) {
      el.innerHTML = `<p style="font-size:12px; color:var(--hud-text-dim); margin:0;">dev-reference.json failed to load.</p>`;
      return;
    }

    const linksHtml = (devRef.mappingFiles || []).map((m) =>
      `<a href="${m.url}" target="_blank" rel="noopener" class="pill" style="text-decoration:none; background:rgba(64,207,216,0.15); color:var(--db-cyan-bright);">${escapeHtml(m.label)} ↗</a>`
    ).join(" ");

    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
        <span style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text-dim); text-transform:uppercase; letter-spacing:0.05em;">Dev Reference</span>
        <span style="display:flex; align-items:center; gap:6px;">
          <code id="inspectorAesKey" data-hidden="true" data-full-key="${escapeHtml(devRef.aesEncryptionKey)}"
                style="background:rgba(0,0,0,0.3); border:1px solid var(--hud-border); border-radius:4px; padding:4px 8px; font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright);">
            AES key hidden
          </code>
          <button class="toggle-btn" id="inspectorRevealAes" style="padding:4px 10px; font-size:11px;">Reveal</button>
        </span>
        <span style="display:flex; gap:8px;">${linksHtml}</span>
        <a href="#" data-route="coverage" id="inspectorSeeMoreRef" style="margin-left:auto; font-size:11px; color:var(--db-cyan-bright); text-decoration:none;">Full reference →</a>
      </div>
    `;

    const revealBtn = document.getElementById("inspectorRevealAes");
    revealBtn.addEventListener("click", () => {
      const keyEl = document.getElementById("inspectorAesKey");
      const isHidden = keyEl.dataset.hidden === "true";
      keyEl.textContent = isHidden ? keyEl.dataset.fullKey : "AES key hidden";
      keyEl.dataset.hidden = isHidden ? "false" : "true";
      revealBtn.textContent = isHidden ? "Hide" : "Reveal";
    });

    document.getElementById("inspectorSeeMoreRef").addEventListener("click", (e) => {
      e.preventDefault();
      App.setActiveNav("coverage");
      App.renderRoute("coverage");
    });
  },

  getFiltered() {
    const all = DataStore.getAllEquipmentFlat();
    if (!this.state.search.trim()) return all;
    const q = this.state.search.trim().toLowerCase();
    return all.filter((w) => {
      const name = DataStore.getDisplayName(w.itemKey).toLowerCase();
      return name.includes(q) || w.itemKey.toLowerCase().includes(q);
    });
  },

  renderList(options = {}) {
    const { resetScroll = false } = options;
    const pane = document.getElementById("inspectorList");

    // BUG FIX: clicking a row calls renderList() again (to update which
    // row shows the "selected" highlight), which previously did
    // `pane.innerHTML = ""` and rebuilt the whole list from scratch --
    // destroying and recreating the scrollable element itself, which
    // resets its scrollTop to 0. That's what caused the view to jump
    // back to the top on every single click. Capturing the existing
    // scroll container's scrollTop here and restoring it after
    // rebuilding fixes this without a heavier no-rebuild/DOM-diffing
    // approach. resetScroll=true (passed by the search input handler
    // below) deliberately skips this -- a freshly-filtered list
    // SHOULD start at the top, since the old scroll position has no
    // relationship to the new filtered content's length or order.
    const previousList = pane.querySelector(".hud-panel");
    const previousScrollTop = (!resetScroll && previousList) ? previousList.scrollTop : 0;

    const weapons = this.getFiltered();
    const list = document.createElement("div");
    list.className = "hud-panel";
    list.style.maxHeight = "calc(100vh - 220px)";
    list.style.overflowY = "auto";
    list.innerHTML = `<h3>Equipment (${weapons.length})</h3>`;
    weapons.forEach((w) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (w.itemKey === this.state.selectedItemKey ? " selected" : "");
      row.innerHTML = `
        <span class="wl-name" style="font-size:13px;">${escapeHtml(DataStore.getDisplayName(w.itemKey))}</span>
        <span class="wl-id">${w.itemKey}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedItemKey = w.itemKey;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(list);
    list.scrollTop = previousScrollTop;

    if (!this.state.selectedItemKey && weapons.length > 0) {
      this.state.selectedItemKey = weapons[0].itemKey;
    }
  },

  renderDetail() {
    const pane = document.getElementById("inspectorDetail");
    const weapon = DataStore.weaponsByItemKey[this.state.selectedItemKey]
      || DataStore.armorByItemKey[this.state.selectedItemKey];

    if (!weapon) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an item to inspect its raw JSON record.</p></div></div>`;
      return;
    }

    const isArmor = !!DataStore.armorByItemKey[this.state.selectedItemKey];
    const meta = isArmor
      ? DataStore.armorCategoryIndex[weapon.category]
      : DataStore.categoryIndex[weapon.category];
    const locEntry = DataStore.localization[weapon.itemKey] || {};

    pane.innerHTML = `
      <div class="hud-panel">
        <h3>Source</h3>
        <div style="font-family:var(--font-mono); font-size:12px; color:var(--hud-text-dim); margin-bottom:14px; line-height:1.7;">
          File: <span style="color:var(--db-cyan-bright);">Content/ROD/${meta.file}</span><br/>
          Array index lookup key: <b style="color:var(--hud-text);">itemKey === "${weapon.itemKey}"</b><br/>
          Localization: <span style="color:var(--db-cyan-bright);">Content/ROD/DataAssets/Items/Localization/en.json</span>
          → name: <b>${locEntry.name ? escapeHtml(locEntry.name) : "(unset, falls back to ItemKey)"}</b>
          ${locEntry.verified ? '<span class="pill verified" style="margin-left:6px;">verified</span>' : '<span class="pill unverified" style="margin-left:6px;">unverified</span>'}
        </div>
        <h3>Raw Record (as loaded by the app)</h3>
        <div class="json-inspector">${syntaxHighlightJson(weapon)}</div>
      </div>
    `;
  },
};

function syntaxHighlightJson(obj) {
  const json = JSON.stringify(obj, null, 2);
  const escaped = escapeHtml(json);
  return escaped
    .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="jv-str">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="jv-num">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="jv-bool">$1</span>');
}
