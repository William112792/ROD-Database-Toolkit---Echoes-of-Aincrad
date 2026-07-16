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
        ${(() => {
          // Post-release the export carries the game's OWN Database-menu
          // model definition per monster (Database_{id}.json). When the
          // 3D Model Registry has it, the old "nothing to preview"
          // placeholder gives way to real model info + a View 3D button
          // (lit once a .glb is uploaded for the mesh).
          const mref = DataStore.getModelRef("monster", monster.titleKey);
          if (mref) {
            const meshName = (mref.meshJson || "").split("/").pop() || "?";
            return `<div style="width:100%; text-align:left; font-size:11.5px; color:var(--hud-text-dim); padding:10px 0 0;">
              In-game the Database shows this monster as a live rotating model:
              <span style="font-family:var(--font-mono); color:var(--hud-text);">${escapeHtml(meshName.replace(".json", ""))}</span>${mref.scale && mref.scale.x !== 1 ? ` at ×${mref.scale.x} scale` : ""}
              — from the game's own <span style="font-family:var(--font-mono);">${escapeHtml((mref.sourceFile || "").split("/").pop() || "")}</span>.
            </div>`;
          }
          return `<div class="empty-state" style="padding:36px 10px 20px;">
            <div class="empty-icon">🎮</div>
            <p style="font-size:12px;">
              Shown in-game as a live rotating 3D model, not a static
              image — no texture or icon exists for any monster in this
              export. Model references (Database_{id}.json) arrive with the
              post-release export: upload it and rebuild the Monsters focus
              group to see them here.
            </p>
          </div>`;
        })()}
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
        ${ModelPanel.html(DataStore.getModelRef("monster", monster.titleKey), displayName)}

        ${!verified ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No name found</div>
            <div class="mod-effect-line">
              This row exists in the database (a real ${escapeHtml(monster.enemyTypeLabel)} entry,
              ID ${escapeHtml(String(monster.titleId))}) but has no matching name string in any of the
              language files included in this export. It may be unreleased content, a cut
              monster, or simply not yet localized -- there's no way to tell which from this
              data alone.
            </div>
          </div>
        ` : ""}
        <div id="monsterJoinsPane" style="width:100%; text-align:left;"></div>
      </div>
    `;
    this.renderJoins(monster, displayName);
  },

  /**
   * Combat Stats / Drops / Spawns for the selected monster, joined by
   * enemyNameKey === titleKey (the shared key across all three builds
   * -- verified: 174 stat entries, 62 drop rows, and 1584/1606 spawn
   * groups carry it). Drops are already in memory; MonsterStats.json
   * and Spawns Groups.json are lazy-loaded on first monster detail
   * render and cached, matching each browser tab's own lazy pattern.
   * Full tables stay in their dedicated tabs; these are the
   * per-monster slices with links across.
   */
  async renderJoins(monster, displayName) {
    const pane = document.getElementById("monsterJoinsPane");
    if (!pane) return;
    if (!this._statsByKey) {
      this._statsByKey = {};
      this._spawnGroupsByKey = {};
      try {
        const stats = await (await fetch("Content/ROD/DataAssets/Database/MonsterStats/MonsterStats.json")).json();
        for (const s of stats) (this._statsByKey[s.enemyNameKey] = this._statsByKey[s.enemyNameKey] || []).push(s);
      } catch (e) { /* stats not built on this instance -- section simply doesn't render */ }
      try {
        const groups = await (await fetch("Content/ROD/DataAssets/Database/MonsterSpawns/Groups.json")).json();
        for (const g of groups) {
          for (const c of g.characters || []) {
            if (c.enemyNameKey) (this._spawnGroupsByKey[c.enemyNameKey] = this._spawnGroupsByKey[c.enemyNameKey] || []).push(g);
          }
        }
      } catch (e) { /* spawns not built -- same */ }
    }
    if (this.state.selectedTitleKey !== monster.titleKey) return; // user moved on mid-fetch

    const stats = this._statsByKey[monster.titleKey] || [];
    const drops = (DataStore.monsterDrops || []).filter((d) => d.enemyNameKey === monster.titleKey);
    const spawnGroups = this._spawnGroupsByKey[monster.titleKey] || [];

    const statBlock = stats.length ? `
      <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--hud-text); margin:12px 0 4px; border-top:1px solid rgba(135,200,210,0.12); padding-top:10px;">COMBAT STATS (${stats.length} variant${stats.length === 1 ? "" : "s"})</div>
      ${stats.map((s) => `
        <div style="font-size:11px; color:var(--hud-text-dim); line-height:1.7; margin-bottom:4px;">
          <span style="font-family:var(--font-mono); color:var(--db-cyan-bright);">${escapeHtml(s.code)}</span>
          · Lv <b style="color:var(--hud-text);">${s.level}</b>
          · ATK <b style="color:var(--hud-text);">${s.attackPower}</b>
          · DEF <b style="color:var(--hud-text);">${s.defencePower}</b>
          ${s.hasCurve ? `<span title="Has a per-level growth curve — full table in Monsters › Stats">· 📈 curve</span>` : ""}
        </div>`).join("")}
      <div style="font-size:9.5px; opacity:0.65;">Full growth curves + difficulty rewards in the <b>Stats</b> tab.</div>` : "";

    const fmtDropItems = (d) => {
      const items = [];
      for (const pool of Object.values(d.pools || {})) {
        for (const slot of pool) if (slot.itemKey) items.push(slot);
      }
      return items.slice(0, 6).map((s) =>
        `<span style="font-family:var(--font-mono); font-size:10px;">${escapeHtml(DataStore.getItemDisplayNameByKey ? (DataStore.getItemDisplayNameByKey(s.itemKey) || s.itemKey) : s.itemKey)}${s.sharePct != null ? ` <span style="opacity:0.6;">(${s.sharePct}%)</span>` : ""}</span>`
      ).join(" · ") + (items.length > 6 ? ` <span style="opacity:0.6;">+${items.length - 6} more</span>` : "");
    };
    const dropBlock = drops.length ? `
      <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--hud-text); margin:12px 0 4px; border-top:1px solid rgba(135,200,210,0.12); padding-top:10px;">DROPS (${drops.length} reward table${drops.length === 1 ? "" : "s"})</div>
      ${drops.map((d) => `
        <div style="font-size:11px; color:var(--hud-text-dim); line-height:1.7; margin-bottom:4px;">
          <span style="font-family:var(--font-mono); color:var(--db-cyan-bright);">${escapeHtml(d.rewardKey)}</span>${d.isDebugKey ? ` <span class="pill unverified">debug</span>` : ""}<br/>
          ${fmtDropItems(d)}
        </div>`).join("")}
      <div style="font-size:9.5px; opacity:0.65;">Weights, quest-reward variants, and craft-level params in the <b>Drops</b> tab.</div>` : "";

    const worlds = [...new Set(spawnGroups.map((g) => g.world))].sort();
    const spawnBlock = spawnGroups.length ? `
      <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--hud-text); margin:12px 0 4px; border-top:1px solid rgba(135,200,210,0.12); padding-top:10px;">SPAWNS (${spawnGroups.length} group${spawnGroups.length === 1 ? "" : "s"}${worlds.length ? " · " + worlds.join(", ") : ""})</div>
      <div style="display:flex; flex-wrap:wrap; gap:4px;">
        ${spawnGroups.slice(0, 14).map((g) => `<span class="pill" style="font-size:9.5px;" title="${g.referencedByLots && g.referencedByLots.length ? "Referenced by: " + escapeHtml(g.referencedByLots.slice(0, 6).join(", ")) : "Not referenced by any lot in this export"}">${escapeHtml(g.groupKey)}</span>`).join("")}
        ${spawnGroups.length > 14 ? `<span style="font-size:10px; color:var(--hud-text-dim);">+${spawnGroups.length - 14} more</span>` : ""}
      </div>
      <div style="font-size:9.5px; opacity:0.65; margin-top:3px;">Pop points, lots, and wave logic in the <b>Spawns</b> tab.</div>` : "";

    pane.innerHTML = statBlock + dropBlock + spawnBlock +
      (!stats.length && !drops.length && !spawnGroups.length
        ? `<div style="font-size:10px; color:var(--hud-text-dim); margin-top:10px;">No stat/drop/spawn rows reference this monster's key in this export — cross-checked all three tables, not assumed.</div>`
        : "");
  },
};
