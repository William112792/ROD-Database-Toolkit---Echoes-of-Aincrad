// ============================================================
// equipment-browser.js
// Database browser for armor (Upper/Lower/Glove/Shield).
// Simpler than weapons -- no enhancement, no ACV/ATK math, just
// Def + item grade + Unique MOD, per confirmed data structure.
// ============================================================

// Weapon categories that, by common action-RPG convention, require both
// hands and therefore can't equip a shield. NOTE: this is an INFERENCE,
// not confirmed by any field in the data export -- there is no
// "AllowShield" or hand-count flag anywhere in ItemDataAsset.json. It's
// based on the category names themselves (Two-Handed Sword is explicit;
// Mace/Axe groups include heavy weapons typically depicted two-handed in
// the reference screenshots). Flagged here AND in the UI so it's never
// presented as confirmed fact.
const INFERRED_TWO_HANDED_CATEGORIES = ["TwoHandedSword", "Mace", "Axe"];

const EquipmentBrowserView = {
  /**
   * Costume Feature colors. ECostumeKind in the game's SDK has exactly
   * three values -- Upper=0, Gloves=1, Lower=2 -- which is why only
   * those three armor categories show a palette (shields and other
   * slots have no costume colouring, and pretending otherwise would be
   * an invention). DT_CostumeColorList is ONE shared palette of 50: no
   * field scopes a color to a kind or to an individual piece, so the
   * same swatches are shown for each of the three, stated plainly.
   */
  COSTUME_KINDS: { Upper: "Upper", Gloves: "Gloves", Glove: "Gloves", Lower: "Lower" },

  costumeColorsHtml(armor) {
    const kind = this.COSTUME_KINDS[armor.category];
    const colors = DataStore.costumeColors || [];
    if (!kind || !colors.length) return "";
    return `
      <div class="hud-panel" style="width:100%; text-align:left; margin-top:12px; padding:12px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:3px;">
          COSTUME FEATURE COLORS — ${escapeHtml(kind)} <span style="opacity:0.6; font-weight:400;">(${colors.length})</span>
        </div>
        <div style="font-size:10.5px; color:var(--hud-text-dim); margin-bottom:7px;">
          The palette the in-game Costume Feature offers once unlocked. <b>One shared palette</b> —
          DT_CostumeColorList scopes no color to a kind or to an individual piece, so these same ${colors.length}
          apply to Upper, Gloves and Lower alike (ECostumeKind has exactly those three values).
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">
          ${colors.map((c) => `
            <div title="ID ${c.id} · #${escapeHtml(c.hex || "")} · row ${escapeHtml(c.rowKey)}"
                 style="width:22px; height:22px; border-radius:3px; border:1px solid rgba(255,255,255,0.18); background:#${escapeHtml(c.hex || "888888")};"></div>`).join("")}
        </div>
      </div>`;
  },

  state: {
    activeCategory: "Upper",
    selectedItemKey: null,
    search: "",
    rankFilter: "all",
    viewMode: "grid",
    verifiedOnly: false,
    gender: "Male", // for gendered categories (Upper/Lower/Glove)
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="equipQuickCoverage"></div>
      <div class="type-tabs" id="equipTypeTabs"></div>
      <div class="toolbar" id="equipToolbar"></div>
      <div class="equip-layout">
        <div id="equipListPane"></div>
        <div id="equipDetailPane"></div>
        <div id="equipStatsPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderTypeTabs();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("equipQuickCoverage");
    const all = DataStore.getAllArmorFlat();
    const verifiedNames = all.filter((a) => DataStore.isVerifiedName(a.itemKey)).length;
    el.innerHTML = `
      <span><b>${all.length}</b> armor pieces loaded</span>
      <span><b>${verifiedNames}</b>/${all.length} names verified</span>
      <span style="margin-left:auto; opacity:0.6;">Def + item grade confirmed from data — no enhancement/ACV/EX-MOD on armor</span>
    `;
  },

  renderTypeTabs() {
    const el = document.getElementById("equipTypeTabs");
    const cats = DataStore.armorCategoryIndex;
    el.innerHTML = "";
    Object.keys(cats).forEach((catKey) => {
      const meta = cats[catKey];
      const tab = document.createElement("div");
      tab.className = "type-tab" + (catKey === this.state.activeCategory ? " active" : "");
      tab.title = meta.label + " (icon mapping visually identified — see Data Coverage)";
      tab.innerHTML = `<img src="${equipmentCategoryIconPath(catKey)}" alt="" />`;
      tab.addEventListener("click", () => {
        this.state.activeCategory = catKey;
        this.state.selectedItemKey = null;
        this.renderTypeTabs();
        this.renderToolbar();
        this.renderListPaneWithSkeleton();
        this.renderDetail();
      });
      el.appendChild(tab);
    });
    const countEl = document.createElement("span");
    countEl.className = "type-tab-count";
    countEl.textContent = `${cats[this.state.activeCategory].label} — ${cats[this.state.activeCategory].count} items`;
    el.appendChild(countEl);
  },

  renderToolbar() {
    const el = document.getElementById("equipToolbar");
    const meta = DataStore.armorCategoryIndex[this.state.activeCategory];
    el.innerHTML = `
      <input type="text" class="search-input" id="equipSearchInput" placeholder="Search by name or ItemKey..." value="${escapeHtml(this.state.search)}" />
      <select class="filter-select" id="equipRankFilter">
        <option value="all">All Ranks</option>
        <option value="RankD">Rank D</option>
        <option value="RankC">Rank C</option>
        <option value="RankB">Rank B</option>
        <option value="RankA">Rank A</option>
        <option value="RankS">Rank S</option>
      </select>
      ${meta.gendered ? `
        <button class="toggle-btn ${this.state.gender === "Male" ? "active" : ""}" id="genderMaleBtn">Male</button>
        <button class="toggle-btn ${this.state.gender === "Female" ? "active" : ""}" id="genderFemaleBtn">Female</button>
      ` : ""}
      <button class="toggle-btn" id="equipVerifiedToggle">${this.state.verifiedOnly ? "✓ " : ""}Verified names only</button>
      <button class="toggle-btn" id="equipViewModeToggle">${this.state.viewMode === "grid" ? "☰ List view" : "▦ Grid view"}</button>
    `;
    document.getElementById("equipRankFilter").value = this.state.rankFilter;

    document.getElementById("equipSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("equipRankFilter").addEventListener("change", (e) => {
      this.state.rankFilter = e.target.value;
      this.renderListPane();
    });
    document.getElementById("equipVerifiedToggle").addEventListener("click", () => {
      this.state.verifiedOnly = !this.state.verifiedOnly;
      this.renderToolbar();
      this.renderListPane();
    });
    document.getElementById("equipViewModeToggle").addEventListener("click", () => {
      this.state.viewMode = this.state.viewMode === "grid" ? "list" : "grid";
      this.renderToolbar();
      this.renderListPane();
    });
    const maleBtn = document.getElementById("genderMaleBtn");
    const femaleBtn = document.getElementById("genderFemaleBtn");
    if (maleBtn) maleBtn.addEventListener("click", () => {
      this.state.gender = "Male";
      this.renderToolbar();
      this.renderListPane();
      this.renderDetail();
    });
    if (femaleBtn) femaleBtn.addEventListener("click", () => {
      this.state.gender = "Female";
      this.renderToolbar();
      this.renderListPane();
      this.renderDetail();
    });
  },

  getFilteredArmor() {
    let items = DataStore.armorByCategory[this.state.activeCategory] || [];
    if (this.state.rankFilter !== "all") {
      items = items.filter((a) => a.rank === this.state.rankFilter);
    }
    if (this.state.verifiedOnly) {
      items = items.filter((a) => DataStore.isVerifiedName(a.itemKey));
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      items = items.filter((a) => {
        const name = DataStore.getDisplayName(a.itemKey).toLowerCase();
        return name.includes(q) || a.itemKey.toLowerCase().includes(q);
      });
    }
    return items;
  },

  getArmorIconPath(armor, size) {
    const meta = DataStore.armorCategoryIndex[armor.category];
    if (meta.gendered) {
      const genderKey = size === "small" ? `iconSmall${this.state.gender}` : `icon${this.state.gender}`;
      return armor.textures[genderKey];
    }
    return size === "small" ? armor.textures.iconSmall : armor.textures.icon;
  },

  renderListPaneWithSkeleton() {
    const pane = document.getElementById("equipListPane");
    const targetCount = Math.min(this.getFilteredArmor().length, 18) || 12;
    pane.innerHTML = LoadingSkeleton.grid(targetCount);
    const detailPane = document.getElementById("equipDetailPane");
    const statsPane = document.getElementById("equipStatsPane");
    if (detailPane) detailPane.innerHTML = LoadingSkeleton.detailPanel();
    if (statsPane) statsPane.innerHTML = LoadingSkeleton.statsPanel();

    requestAnimationFrame(() => {
      setTimeout(() => this.renderListPane(), 160);
    });
  },

  renderListPane() {
    const pane = document.getElementById("equipListPane");
    const items = this.getFilteredArmor();

    if (items.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No items match</h4>
            <p>Try clearing the search or rank filter.</p>
          </div>
        </div>
      `;
      return;
    }

    if (this.state.viewMode === "grid") {
      const grid = document.createElement("div");
      grid.className = "weapon-grid";
      items.forEach((a) => grid.appendChild(this.buildTile(a)));
      pane.innerHTML = "";
      pane.appendChild(grid);
      AnimationSettings.applyScanFrameTiming(grid);
    } else {
      const list = document.createElement("div");
      items.forEach((a) => list.appendChild(this.buildListRow(a)));
      pane.innerHTML = "";
      pane.appendChild(list);
    }

    if (!this.state.selectedItemKey || !items.find((a) => a.itemKey === this.state.selectedItemKey)) {
      this.state.selectedItemKey = items[0].itemKey;
      this.renderDetail();
    }
  },

  buildTile(armor) {
    const tile = document.createElement("div");
    tile.className = "weapon-tile scan-frame scan-frame-sm" + (armor.itemKey === this.state.selectedItemKey ? " selected" : "");
    tile.style = scanFrameStyle(armor.rank);
    const verified = DataStore.isVerifiedName(armor.itemKey);
    const iconPath = this.getArmorIconPath(armor, "small");
    tile.innerHTML = `
      ${scanBarHtml()}
      <span class="rank-chip" style="color:${rankColor(armor.rank)}" title="Item grade (Class): ${rankShort(armor.rank)}">${rankShort(armor.rank)}</span>
      ${!verified ? '<span class="unverified-dot" title="Name not verified"></span>' : ""}
      <button class="tile-zoom-btn" title="Zoom" aria-label="Zoom icon">🔍</button>
      <img src="${iconPath}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='${armor.textures.categoryPlaceholderRender}';" />
    `;
    tile.title = DataStore.getDisplayName(armor.itemKey);
    tile.querySelector(".tile-zoom-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openIconZoom({ ...armor, textures: { icon: iconPath, categoryPlaceholderRender: armor.textures.categoryPlaceholderRender } });
    });
    tile.addEventListener("click", () => {
      this.state.selectedItemKey = armor.itemKey;
      this.renderListPane();
      this.renderDetail();
    });
    return tile;
  },

  buildListRow(armor) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (armor.itemKey === this.state.selectedItemKey ? " selected" : "");
    const verified = DataStore.isVerifiedName(armor.itemKey);
    const iconPath = this.getArmorIconPath(armor, "small");
    row.innerHTML = `
      <span class="wl-icon"><img src="${iconPath}" alt="" loading="lazy"
            onerror="this.onerror=null;this.src='${armor.textures.categoryPlaceholderRender}';" /></span>
      <span class="rank-badge" title="Item grade (Class)">${rankBadgeImg(armor.rank)}</span>
      <span class="wl-name">${escapeHtml(DataStore.getDisplayName(armor.itemKey))}</span>
      ${armor.def !== null ? `<span class="pill" style="background:rgba(94,235,109,0.12); color:var(--hud-hp);">DEF ${armor.def}</span>` : ""}
      ${!verified ? '<span class="pill unverified">unverified</span>' : ""}
      <span class="wl-id">${armor.itemKey}</span>
      ${armor.id != null ? `<span class="id-chip" title="Numeric ItemId — the value DataTables, shops and RODSchema patches reference">#${armor.id}</span>` : ""}
    `;
    row.addEventListener("click", () => {
      this.state.selectedItemKey = armor.itemKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const detailPane = document.getElementById("equipDetailPane");
    const statsPane = document.getElementById("equipStatsPane");
    const armor = DataStore.armorByItemKey[this.state.selectedItemKey];

    if (!armor) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an item</p></div></div>`;
      statsPane.innerHTML = "";
      return;
    }

    const verified = DataStore.isVerifiedName(armor.itemKey);
    const displayName = DataStore.getDisplayName(armor.itemKey);
    const iconPath = this.getArmorIconPath(armor, "full");
    const meta = DataStore.armorCategoryIndex[armor.category];

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Equipment Preview</h3>
        <div class="preview-img-wrap zoomable-icon scan-frame" id="equipPreviewImgWrap" title="Click to zoom" style="${scanFrameStyle(armor.rank)}">
          ${scanBarHtml()}
          <img src="${iconPath}" alt=""
               onerror="this.onerror=null;this.src='${armor.textures.categoryPlaceholderRender}';" />
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${armor.itemKey} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified — showing raw key</span>'}</div>

        ${renderDescriptionBlock(armor.itemKey)}

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.7;">
          <div>Category: ${armor.categoryLabel}${meta.gendered ? ` (${this.state.gender} variant shown)` : ""}</div>
          <div title="The item's overall quality/grade tier (Class field).">
            Item grade (Class): ${rankBadgeImg(armor.rank)} ${rankShort(armor.rank)}
          </div>
          <div>Sell value: ${armor.sellAmount >= 0 ? armor.sellAmount + " Col" : "—"}</div>
        </div>

        ${this.renderShieldCompatNote(armor)}
        ${this.renderModCalloutForArmor(armor)}
        ${ModelPanel.html(DataStore.getModelRef("armor", armor.itemKey), DataStore.getArmorDisplayName ? DataStore.getArmorDisplayName(armor) : armor.itemKey)}
        ${this.costumeColorsHtml(armor)}
        ${renderItemSourcesPanelHtml(armor.itemKey)}
      </div>
    `;

    statsPane.innerHTML = `
      <div class="hud-panel">
        <h3>Defense</h3>
        ${armor.def !== null ? `
          <div class="atk-display">
            <div>
              <div class="atk-label" style="color:var(--hud-hp);">DEF</div>
              <div class="atk-total">${armor.def}</div>
            </div>
            <div class="atk-breakdown">flat value from data — no enhancement scaling on armor</div>
          </div>
        ` : `
          <div class="empty-state" style="padding:20px 10px;">
            <p>No <code>Def</code> field exists for ${armor.categoryLabel} in this data export — confirmed empty across all ${DataStore.armorByCategory[armor.category].length} items in this category, not a missing-data gap specific to this item.</p>
          </div>
        `}
      </div>
    `;

    const previewImgWrap = document.getElementById("equipPreviewImgWrap");
    if (previewImgWrap) {
      previewImgWrap.addEventListener("click", () => {
        openIconZoom({ ...armor, textures: { icon: iconPath, categoryPlaceholderRender: armor.textures.categoryPlaceholderRender } });
      });
    }
    AnimationSettings.applyScanFrameTiming(detailPane);
  },

  renderShieldCompatNote(armor) {
    if (armor.category !== "Shield") return "";
    return `
      <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:10px;">
        <div class="mod-name">Shield compatibility — inferred, not confirmed</div>
        <div class="mod-effect-line">
          No field in the data export states which weapon categories block shield use.
          Convention (not data) suggests Two-Handed Sword, Mace, and Axe weapons can't
          equip a shield — currently: <b>${INFERRED_TWO_HANDED_CATEGORIES.join(", ")}</b>.
          Treat this as a guess until confirmed in-game.
        </div>
      </div>
    `;
  },

  renderModCalloutForArmor(armor) {
    if (!armor.modNames || armor.modNames.length === 0) return "";
    return armor.modNames.map((modName) =>
      renderModCalloutShared(modName, { topMargin: true })
    ).join("");
  },
};

// Icon mapping confirmed visually -- NOT confirmed via any data field,
// since the armor Category field values (6/7/8/9) don't align numerically
// with these icon suffixes. Same situation as the weapon type tab icons.
//
// CORRECTED after user report: A1 is a torso/collar shape (jacket), A3 is
// two hand/mitt shapes (gloves) -- these were swapped in an earlier pass.
// A2 (two leg shapes = pants/Lower) was correct from the start.
//   A1 = Upper (jacket/torso silhouette with collar + shoulder pads)
//   A2 = Lower (two leg/boot shapes)
//   A3 = Glove (two hand/mitt shapes side by side)
//   S_S = Shield (shield outline)
const ARMOR_ICON_MAP = {
  Upper: "A1",
  Lower: "A2",
  Glove: "A3",
  Shield: "S_S",
};

function equipmentCategoryIconPath(catKey) {
  const code = ARMOR_ICON_MAP[catKey] || "Unknown";
  return `Content/ROD/Widget/Common/IconImage/ItemCategoryIconImage/T_ItemCategoryIcon_${code}.png`;
}
