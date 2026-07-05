// ============================================================
// monsters-browser.js
// Database browser for monsters (Beast / Demi-Human / Plant-Insect /
// Demon), built from DT_MonsterDatabase.json (120 rows).
//
// Deliberately much thinner than weapons/armor: there is NO per-
// monster combat data anywhere in this export (no level/HP/ATK/DEF --
// confirmed by searching every datatable before this was built) and
// NO image/texture reference on any of the 120 rows (monsters are 3D
// models shown in a live rotating viewer in-game, per the reference
// screenshot, not a 2D icon the way every other category in this app
// is). So unlike EquipmentBrowserView, there's no icon grid, no zoom
// lightbox, no stats pane -- just a searchable list and a detail panel
// with whatever identity + flavor text actually exists.
//
// Coverage is also much lower here: only 27 of 120 monsters have ANY
// localization in this export. Per the user, unnamed monsters stay in
// the list (not hidden by default) showing their raw EnemyType +
// DatabaseTitleID identity, the same way an unverified weapon falls
// back to its raw ItemKey -- with a toggle to hide them, mirroring the
// existing "verified names only" pattern used elsewhere.
// ============================================================

const MonstersBrowserView = {
  state: {
    activeCategory: "Beast",
    selectedTitleKey: null,
    search: "",
    namedOnly: false,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="monsterQuickCoverage"></div>
      <div class="toolbar" id="monsterTypeTabs" style="margin-bottom:10px;"></div>
      <div class="toolbar" id="monsterToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="monsterListPane"></div>
        <div id="monsterDetailPane"></div>
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
    const el = document.getElementById("monsterQuickCoverage");
    const all = DataStore.getAllMonstersFlat();
    const namedCount = all.filter((m) => DataStore.isMonsterNameVerified(m)).length;
    el.innerHTML = `
      <span><b>${all.length}</b> monsters loaded</span>
      <span><b>${namedCount}</b>/${all.length} names verified</span>
      <span style="margin-left:auto; opacity:0.6;">No combat stats or images exist in this export — see Data Coverage</span>
    `;
  },

  renderTypeTabs() {
    const el = document.getElementById("monsterTypeTabs");
    const cats = DataStore.monsterCategoryIndex || {};
    el.innerHTML = Object.keys(cats).map((catKey) => {
      const meta = cats[catKey];
      const active = catKey === this.state.activeCategory;
      return `<button class="toggle-btn${active ? " active" : ""}" data-cat="${catKey}">${escapeHtml(meta.label)} <span style="opacity:0.6;">(${meta.count})</span></button>`;
    }).join("");

    el.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.activeCategory = btn.dataset.cat;
        this.state.selectedTitleKey = null;
        this.renderTypeTabs();
        this.renderListPane();
        this.renderDetail();
      });
    });
  },

  renderToolbar() {
    const el = document.getElementById("monsterToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="monsterSearchInput" placeholder="Search by name or enemy type..." value="${escapeHtml(this.state.search)}" />
      <button class="toggle-btn" id="monsterNamedOnlyToggle">${this.state.namedOnly ? "✓ " : ""}Named only</button>
    `;
    document.getElementById("monsterSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("monsterNamedOnlyToggle").addEventListener("click", () => {
      this.state.namedOnly = !this.state.namedOnly;
      this.renderToolbar();
      this.renderListPane();
    });
  },

  getFilteredMonsters() {
    let items = DataStore.monstersByCategory[this.state.activeCategory] || [];
    if (this.state.namedOnly) {
      items = items.filter((m) => DataStore.isMonsterNameVerified(m));
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      items = items.filter((m) => {
        const name = DataStore.getMonsterDisplayName(m).toLowerCase();
        return name.includes(q) || m.enemyTypeLabel.toLowerCase().includes(q) || m.titleKey.toLowerCase().includes(q);
      });
    }
    return items;
  },

  renderListPane() {
    const pane = document.getElementById("monsterListPane");
    const items = this.getFilteredMonsters();

    if (items.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No monsters match</h4>
            <p>Try clearing the search or the "Named only" filter.</p>
          </div>
        </div>
      `;
      return;
    }

    const list = document.createElement("div");
    items.forEach((m) => list.appendChild(this.buildListRow(m)));
    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedTitleKey || !items.find((m) => m.titleKey === this.state.selectedTitleKey)) {
      this.state.selectedTitleKey = items[0].titleKey;
      this.renderDetail();
    }
  },

  buildListRow(monster) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (monster.titleKey === this.state.selectedTitleKey ? " selected" : "");
    const verified = DataStore.isMonsterNameVerified(monster);
    row.innerHTML = `
      <span class="wl-name">${escapeHtml(DataStore.getMonsterDisplayName(monster))}</span>
      ${!verified ? '<span class="pill unverified">unnamed</span>' : ""}
      <span class="wl-id">${escapeHtml(monster.titleKey)}</span>
    `;
    row.addEventListener("click", () => {
      this.state.selectedTitleKey = monster.titleKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const detailPane = document.getElementById("monsterDetailPane");
    const monster = DataStore.monstersByTitleKey[this.state.selectedTitleKey];

    if (!monster) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a monster</p></div></div>`;
      return;
    }

    const verified = DataStore.isMonsterNameVerified(monster);
    const displayName = DataStore.getMonsterDisplayName(monster);
    const description = DataStore.getMonsterDescription(monster);
    const descVerified = DataStore.isMonsterDescriptionVerified(monster);

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Monster Preview</h3>
        <div class="empty-state" style="padding:36px 10px 20px;">
          <div class="empty-icon">🎮</div>
          <p style="font-size:12px;">
            Shown in-game as a live rotating 3D model, not a static
            image -- no texture or icon exists for any monster in this
            export (confirmed: all 120 rows have a placeholder
            <code>DatabaseImagetID</code>). Nothing to preview here yet.
          </p>
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${escapeHtml(monster.titleKey)} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified — no localization found</span>'}</div>

        ${description ? `
          <div class="item-description${descVerified ? "" : " unverified-desc"}">
            ${escapeHtml(description)}
          </div>
        ` : ""}

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.7;">
          <div>Enemy type: ${escapeHtml(monster.enemyTypeLabel)}</div>
          <div>Database title ID: ${escapeHtml(String(monster.titleId))}</div>
        </div>

        ${!verified ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No name found</div>
            <div class="mod-effect-line">
              This row exists in the database (a real ${escapeHtml(monster.enemyTypeLabel)} entry,
              ID ${escapeHtml(String(monster.titleId))}) but has no matching name string in any of the
              13 language files included in this export. It may be unreleased content, a cut
              monster, or simply not yet localized -- there's no way to tell which from this
              data alone.
            </div>
          </div>
        ` : ""}
      </div>
    `;
  },
};
