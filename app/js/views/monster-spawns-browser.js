// ============================================================
// monster-spawns-browser.js
// Browser for Monsters > Spawns -- the spawn LOGIC chain from the
// three populated per-world tables under DataAssets/WorldAdmin/:
// SocketPop (wave configs) -> CharacterGroupLot (weighted lotteries)
// -> CharacterGroup (compositions of Blueprint classes).
//
// Anchored on GROUPS (the compositions -- the thing a player thinks
// of as "what spawns"), with each group's reverse references walking
// UP the chain (which lots roll this group, which pop configs roll
// those lots). Enemy Blueprint classes resolve to Monster database
// names via the confirmed E{code} <-> EnemyName_{code} link, joined
// against the SAME loaded Monsters data the Monsters tab renders.
//
// HONEST LIMITS (also in Data Coverage): per-enemy Level/PopNum are
// -1 ("inherit") in 2,941 of 2,950 slots in THIS table specifically --
// that's genuinely what it says, and this tab keeps showing -1 rather
// than substituting another table's number. Each enemy's own default
// level and HP/stat curves arrived in a later Blueprints/ export and
// now live in their own tab, Monsters > Stats (same enemy-code join).
// The two genuine level curves that live in THIS table's own scope
// (XP coefficient, damage coefficient) are shown in the
// overview banner popover. Spawn placement geometry is also mostly
// absent from the exported levels -- this is the spawn logic, not a
// spawn map.
// ============================================================

const MonsterSpawnsBrowserView = {
  state: {
    selectedGroupKey: null, // "WL01:Animal_Rabbit" (world-qualified: keys repeat across worlds)
    search: "",
    worldFilter: "all",  // all | WL01 | WL02
    kindFilter: "all",   // all | boss | summon | enemy | other
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="spawnQuickCoverage"></div>
      <div class="toolbar" id="spawnToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 380px;">
        <div id="spawnListPane" style="max-height:70vh; overflow-y:auto;"></div>
        <div id="spawnDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("spawnQuickCoverage");
    const idx = DataStore.spawnIndex || {};
    el.innerHTML = `
      <span><b>${idx.groupCount || 0}</b> spawn groups</span>
      <span><b>${idx.lotCount || 0}</b> lotteries</span>
      <span><b>${idx.popCount || 0}</b> pop configs</span>
      <span><b>${idx.distinctEnemyCodes || 0}</b> enemy codes (<b>${idx.codesWithDatabaseName || 0}</b> database-named)</span>
      <span style="margin-left:auto; opacity:0.6;" title="This table's own Level field is -1 ('inherit') in ${idx.levelDefaultSlots || 0} of ${(idx.levelDefaultSlots || 0) + (idx.levelSetSlots || 0)} slots -- that's genuinely what it says. Each enemy's own default level and HP/stat curves now live in the Monsters › Stats tab (joined by the same enemy code).">Levels/HP: see Monsters › Stats</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("spawnToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="spawnSearchInput" placeholder="Search by group key, enemy code, or monster name..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="spawnWorldSelect" style="max-width:160px;">
        ${["all", "WL01", "WL02"].map((w) => `<option value="${w}" ${this.state.worldFilter === w ? "selected" : ""}>${w === "all" ? "Both worlds" : w}</option>`).join("")}
      </select>
      <select class="search-input" id="spawnKindSelect" style="max-width:200px;">
        <option value="all" ${this.state.kindFilter === "all" ? "selected" : ""}>All group kinds</option>
        <option value="boss" ${this.state.kindFilter === "boss" ? "selected" : ""}>Boss_*</option>
        <option value="summon" ${this.state.kindFilter === "summon" ? "selected" : ""}>Summon_*</option>
        <option value="enemy" ${this.state.kindFilter === "enemy" ? "selected" : ""}>Enemy_* / E-code</option>
        <option value="other" ${this.state.kindFilter === "other" ? "selected" : ""}>Other (Ark/Animal/Wave...)</option>
      </select>
    `;
    document.getElementById("spawnSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("spawnWorldSelect").addEventListener("change", (e) => {
      this.state.worldFilter = e.target.value;
      this.renderListPane();
    });
    document.getElementById("spawnKindSelect").addEventListener("change", (e) => {
      this.state.kindFilter = e.target.value;
      this.renderListPane();
    });
  },

  groupKind(key) {
    if (/^Boss/i.test(key)) return "boss";
    if (/^Summon/i.test(key)) return "summon";
    if (/^Enemy/i.test(key) || /^E\d{6}/.test(key)) return "enemy";
    return "other";
  },

  groupMonsterNames(group) {
    // Localized names of resolvable members, for search + list rows.
    const names = [];
    for (const c of group.characters || []) {
      if (c.enemyNameKey) {
        const m = DataStore.getMonsterByTitleKey(c.enemyNameKey);
        if (m) names.push(DataStore.getMonsterDisplayName(m));
      }
    }
    return names;
  },

  getFilteredGroups() {
    let groups = DataStore.spawnGroups;
    if (this.state.worldFilter !== "all") {
      groups = groups.filter((g) => g.world === this.state.worldFilter);
    }
    if (this.state.kindFilter !== "all") {
      groups = groups.filter((g) => this.groupKind(g.groupKey) === this.state.kindFilter);
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      groups = groups.filter((g) =>
        g.groupKey.toLowerCase().includes(q)
        || (g.characters || []).some((c) => (c.bpClass || "").toLowerCase().includes(q))
        || this.groupMonsterNames(g).some((n) => n.toLowerCase().includes(q))
      );
    }
    return groups;
  },

  qualifiedKey(group) {
    return `${group.world}:${group.groupKey}`;
  },

  renderListPane() {
    const pane = document.getElementById("spawnListPane");
    const groups = this.getFilteredGroups();

    if (groups.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No spawn groups match</h4>
            <p>Try clearing the search or widening the filters.</p>
          </div>
        </div>
      `;
      return;
    }

    const listEl = document.createElement("div");
    // 1,514 rows total: filters + scroll keep this usable without
    // inventing pagination the rest of the app doesn't have.
    groups.forEach((g) => listEl.appendChild(this.buildListRow(g)));
    pane.innerHTML = "";
    pane.appendChild(listEl);

    if (!this.state.selectedGroupKey || !groups.find((g) => this.qualifiedKey(g) === this.state.selectedGroupKey)) {
      this.state.selectedGroupKey = this.qualifiedKey(groups[0]);
      this.renderDetail();
    }
  },

  buildListRow(group) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (this.qualifiedKey(group) === this.state.selectedGroupKey ? " selected" : "");
    const names = this.groupMonsterNames(group);
    const memberCount = (group.characters || []).length;
    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="wl-name">${escapeHtml(group.groupKey)}</div>
        <div class="wl-id">${escapeHtml(group.world)} &middot; ${memberCount} member${memberCount === 1 ? "" : "s"}${names.length ? ` &middot; ${escapeHtml(names.slice(0, 2).join(", "))}${names.length > 2 ? "…" : ""}` : ""}</div>
      </div>
      <span class="pill" style="opacity:0.75;">${escapeHtml(this.groupKind(group.groupKey))}</span>
    `;
    row.addEventListener("click", () => {
      this.state.selectedGroupKey = this.qualifiedKey(group);
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const pane = document.getElementById("spawnDetailPane");
    const group = DataStore.spawnGroups.find((g) => this.qualifiedKey(g) === this.state.selectedGroupKey);

    if (!group) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a spawn group</p></div></div>`;
      return;
    }

    const memberRows = (group.characters || []).map((c) => {
      const monster = c.enemyNameKey ? DataStore.getMonsterByTitleKey(c.enemyNameKey) : null;
      return `
        <tr>
          <td style="padding:4px 10px; font-size:12px;">${monster
            ? `${escapeHtml(DataStore.getMonsterDisplayName(monster))} <span style="opacity:0.6;">(see Monsters tab)</span>`
            : '<span style="color:var(--hud-text-dim);" title="No matching EnemyName_* entry in the Monster database — shown by Blueprint class, not guessed">—</span>'}</td>
          <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright);">${escapeHtml(c.bpClass || "?")}</td>
          <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px;">${c.level === -1 ? '<span style="color:var(--hud-text-dim);" title="-1 in the source: inherit/default — the actual level is set by the enemy Blueprint, which this export does not contain">inherit</span>' : c.level}</td>
          <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px;">${c.popNum === -1 ? '<span style="color:var(--hud-text-dim);" title="-1 in the source: default count">default</span>' : c.popNum}</td>
        </tr>
      `;
    }).join("");

    const lots = DataStore.spawnLots.filter((l) => l.world === group.world && (group.referencedByLots || []).includes(l.lotKey));
    const lotBlocks = lots.map((l) => {
      const mine = l.entries.find((e) => e.groupKey === group.groupKey);
      const pops = l.referencedByPops || [];
      return `
        <div style="margin-top:8px; line-height:1.8;">
          <span style="font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright);">${escapeHtml(l.lotKey)}</span>
          <span style="font-size:12px; color:var(--hud-text-dim);"> — rolls this group at weight ${mine ? mine.weight : "?"}${mine && mine.sharePct != null ? ` (<span title="Weight-derived share of this lottery's total — the tables store weights, not printed rates">${mine.sharePct}%</span>)` : ""} of ${l.entries.length} entr${l.entries.length === 1 ? "y" : "ies"}</span>
          ${pops.length ? `<div style="font-size:11px; color:var(--hud-text-dim); margin-left:12px;">rolled by pop config${pops.length === 1 ? "" : "s"}: ${pops.map((p) => `<span style="font-family:var(--font-mono);">${escapeHtml(p)}</span>`).join(", ")}</div>` : ""}
        </div>
      `;
    }).join("");

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Spawn Group</h3>
        <div class="preview-name">${escapeHtml(group.groupKey)}</div>
        <div class="preview-itemkey">${escapeHtml(group.world)} <span class="pill" style="opacity:0.75;">${escapeHtml(this.groupKind(group.groupKey))}</span>${group.hasWeightAdjusts ? ' <span class="pill" title="This group carries weather/tension weight adjustments in the source table">weight adjusts</span>' : ""}</div>

        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag" title="Where this composition comes from">Group: DT_CharacterGroupTable_${escapeHtml(group.world)}.json</span>
          <span class="mod-source-tag" title="Enemy code to Monster database name — confirmed code link, not name matching">Names: BP_E{code} → EnemyName_{code}</span>
        </div>

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">Composition (${(group.characters || []).length})</div>
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="border-bottom:1px solid var(--hud-border);">
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Monster</th>
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Blueprint class</th>
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Level</th>
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Pop count</th>
            </tr></thead>
            <tbody>${memberRows}</tbody>
          </table>
        </div>

        ${lots.length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:4px;">Rolled By (${lots.length} lotter${lots.length === 1 ? "y" : "ies"})</div>
            <div style="font-size:11px; color:var(--hud-text-dim);">
              The chain upward: pop configs (DT_SocketPopTable) roll lotteries
              (DT_CharacterGroupLotTable), which roll this group by weight.
            </div>
            ${lotBlocks}
          </div>
        ` : `
          <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px;">
            No lottery references this group in ${escapeHtml(group.world)} — genuinely unreferenced
            in the tables (it may be spawned directly by unexported Blueprint logic).
          </div>
        `}
      </div>
    `;
  },
};
