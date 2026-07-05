// ============================================================
// lore-browser.js
// Database browser for World > Lore, built from
// DT_WorldViewDatabase.json (177 rows).
//
// Genuinely different shape from every other category built so far,
// confirmed before this was written, not assumed from an existing
// pattern:
//   - NO sub-categories or tabs. SubCategory is unused on all 177 rows,
//     and the reference screenshots show one flat scrollable list --
//     so unlike Items (Consumables/Materials/Key Items), there's no
//     category split here at all.
//   - NO icon in the list rows. The reference screenshots show plain
//     text labels in the list; the (large) image only appears in the
//     detail/preview pane once an entry is selected. Only ONE texture
//     family exists per entry (confirmed: no separate small-icon
//     texture anywhere), unlike Items' two-texture-family setup.
//   - The BEST coverage of any category: 177/177 named AND described,
//     confirmed before this was built -- so there's no "named only"
//     toggle here the way Monsters needed one; everything has a name.
//   - 40 of 177 entries (written notes/messages, not landmarks --
//     confirmed by name, e.g. "Scouting Party Note 1") have no
//     thumbnail anywhere in either export. Handled the same way Items
//     handled its KeyItem thumbnail gap: shown with a placeholder
//     image and an honest flag, never hidden or guessed.
// ============================================================

const LoreBrowserView = {
  state: {
    selectedTitleKey: null,
    search: "",
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="loreQuickCoverage"></div>
      <div class="toolbar" id="loreToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="loreListPane"></div>
        <div id="loreDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("loreQuickCoverage");
    const all = DataStore.getAllLoreFlat();
    const missingThumbCount = (DataStore.loreIndex && DataStore.loreIndex.missingThumbnails || []).length;
    el.innerHTML = `
      <span><b>${all.length}</b> lore entries loaded</span>
      <span><b>177/177</b> names verified</span>
      <span style="margin-left:auto; opacity:0.6;">${missingThumbCount} of ${all.length} have no image in this export — see Data Coverage</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("loreToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="loreSearchInput" placeholder="Search by name..." value="${escapeHtml(this.state.search)}" />
    `;
    document.getElementById("loreSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
  },

  getFilteredLore() {
    let items = DataStore.getAllLoreFlat();
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      items = items.filter((l) => DataStore.getLoreDisplayName(l).toLowerCase().includes(q));
    }
    return items;
  },

  renderListPane() {
    const pane = document.getElementById("loreListPane");
    const items = this.getFilteredLore();

    if (items.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No entries match</h4>
            <p>Try clearing the search.</p>
          </div>
        </div>
      `;
      return;
    }

    const list = document.createElement("div");
    items.forEach((l) => list.appendChild(this.buildListRow(l)));
    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedTitleKey || !items.find((l) => l.titleKey === this.state.selectedTitleKey)) {
      this.state.selectedTitleKey = items[0].titleKey;
      this.renderDetail();
    }
  },

  /**
   * Text-only row, no icon -- matches the reference screenshots
   * exactly (the list shows plain name labels; the image only shows
   * up once an entry is selected, in the detail pane).
   */
  buildListRow(lore) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (lore.titleKey === this.state.selectedTitleKey ? " selected" : "");
    row.innerHTML = `
      <span class="wl-name">${escapeHtml(DataStore.getLoreDisplayName(lore))}</span>
      ${!lore.hasThumbnail ? '<span class="pill unverified" title="No image exists for this entry in the current export">no image</span>' : ""}
    `;
    row.addEventListener("click", () => {
      this.state.selectedTitleKey = lore.titleKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const detailPane = document.getElementById("loreDetailPane");
    const lore = DataStore.loreByTitleKey[this.state.selectedTitleKey];

    if (!lore) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an entry</p></div></div>`;
      return;
    }

    const displayName = DataStore.getLoreDisplayName(lore);
    const description = DataStore.getLoreDescription(lore);
    const descVerified = DataStore.isLoreDescriptionVerified(lore);

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Lore Preview</h3>
        <div class="preview-img-wrap zoomable-icon" id="lorePreviewImgWrap" title="Click to zoom" style="border-radius:var(--radius-md); overflow:hidden;">
          <img src="${lore.textures.icon}" alt=""
               onerror="this.onerror=null;this.src='${lore.textures.categoryPlaceholderRender}';" />
        </div>
        <div class="preview-name">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${escapeHtml(lore.titleKey)} <span class="pill verified">verified</span></div>

        ${description ? `
          <div class="item-description${descVerified ? "" : " unverified-desc"}">
            ${escapeHtml(description)}
          </div>
        ` : ""}

        ${!lore.hasThumbnail ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No image found</div>
            <div class="mod-effect-line">
              This entry's name and description are fully confirmed, but no thumbnail image
              exists anywhere in this export for it — likely because it's a written note or
              message rather than a landmark/sight (most entries in this situation are, by name).
              The image shown above is a placeholder, not the real artwork.
            </div>
          </div>
        ` : ""}
      </div>
    `;

    const previewImgWrap = document.getElementById("lorePreviewImgWrap");
    if (previewImgWrap) {
      previewImgWrap.addEventListener("click", () => {
        openIconZoom({
          itemKey: lore.titleKey,
          rank: null,
          textures: { icon: lore.textures.icon, categoryPlaceholderRender: lore.textures.categoryPlaceholderRender },
        }, displayName);
      });
    }
  },
};
