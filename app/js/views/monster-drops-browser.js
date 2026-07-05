// ============================================================
// monster-drops-browser.js
// Browser for Monsters > Drops -- the reward chain from the two
// global loot tables under DataAssets/WorldAdmin/:
// DT_RewardLotTable (reward key -> weighted picks of item-pool keys,
// including explicit "None" no-drop entries) and DT_ItemLotTable
// (pool key -> weighted item slots).
//
// Monster attribution uses the confirmed E{code} <-> EnemyName_{code}
// link only (68 of 242 keys are E-coded; 38 resolve to a database
// name). Named keys like Boar01 are shown UNLINKED -- name-similarity
// guesses are deliberately not encoded. Explicit *Test*/Rarelity*
// debug rows are flagged.
//
// Item names resolve per-language via the drop localization file
// (equipment slots use the data's real ItemKey via the same context
// Equipment is built from; other categories use the verified
// ItemName_{Cat}_{Id} pattern). Cost/Col/Invalid slots have no
// display name by either route and show their raw category+id.
// All percentages shown are WEIGHT-DERIVED shares of a pool's total,
// labeled as such -- the tables store weights, not printed rates.
// ============================================================

const MonsterDropsBrowserView = {
  state: {
    selectedRewardKey: null,
    search: "",
    linkFilter: "all", // all | linked | ecode | unlinked | debug
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="dropQuickCoverage"></div>
      <div class="toolbar" id="dropToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="dropListPane" style="max-height:70vh; overflow-y:auto;"></div>
        <div id="dropDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("dropQuickCoverage");
    const idx = DataStore.monsterDropIndex || {};
    el.innerHTML = `
      <span><b>${idx.rewardCount || 0}</b> reward rows</span>
      <span><b>${idx.monsterLinked || 0}</b> monster-linked (via enemy code)</span>
      <span><b>${idx.debugKeys || 0}</b> debug rows</span>
      <span><b>${idx.poolsReferencedByRewards || 0}</b>/${idx.poolTotal || 0} item pools referenced</span>
      <span style="margin-left:auto; opacity:0.6;" title="The other ~${(idx.poolTotal || 0) - (idx.poolsReferencedByRewards || 0)} pools in DT_ItemLotTable serve other systems (chests, gathering, quests) — future sections">Percentages are weight-derived</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("dropToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="dropSearchInput" placeholder="Search by reward key, monster, or item name..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="dropLinkSelect" style="max-width:230px;">
        <option value="all" ${this.state.linkFilter === "all" ? "selected" : ""}>All rewards</option>
        <option value="linked" ${this.state.linkFilter === "linked" ? "selected" : ""}>Monster-linked</option>
        <option value="ecode" ${this.state.linkFilter === "ecode" ? "selected" : ""}>E-coded (any)</option>
        <option value="unlinked" ${this.state.linkFilter === "unlinked" ? "selected" : ""}>Unlinked keys</option>
        <option value="debug" ${this.state.linkFilter === "debug" ? "selected" : ""}>Debug rows</option>
      </select>
    `;
    document.getElementById("dropSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("dropLinkSelect").addEventListener("change", (e) => {
      this.state.linkFilter = e.target.value;
      this.renderListPane();
    });
  },

  dropMonsterName(drop) {
    if (!drop.enemyNameKey) return null;
    const m = DataStore.getMonsterByTitleKey(drop.enemyNameKey);
    return m ? DataStore.getMonsterDisplayName(m) : null;
  },

  dropItemNames(drop) {
    const names = [];
    for (const slots of Object.values(drop.pools || {})) {
      for (const s of slots) {
        if (s.itemKey) names.push(DataStore.getDropItemName(s.itemKey));
      }
    }
    return names;
  },

  getFilteredDrops() {
    let drops = DataStore.monsterDrops;
    if (this.state.linkFilter === "linked") drops = drops.filter((d) => d.enemyNameKey);
    else if (this.state.linkFilter === "ecode") drops = drops.filter((d) => d.enemyCode);
    else if (this.state.linkFilter === "unlinked") drops = drops.filter((d) => !d.enemyCode && !d.isDebugKey);
    else if (this.state.linkFilter === "debug") drops = drops.filter((d) => d.isDebugKey);
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      drops = drops.filter((d) =>
        d.rewardKey.toLowerCase().includes(q)
        || (this.dropMonsterName(d) || "").toLowerCase().includes(q)
        || this.dropItemNames(d).some((n) => n.toLowerCase().includes(q))
      );
    }
    return drops;
  },

  renderListPane() {
    const pane = document.getElementById("dropListPane");
    const drops = this.getFilteredDrops();

    if (drops.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No reward rows match</h4>
            <p>Try clearing the search or widening the filter.</p>
          </div>
        </div>
      `;
      return;
    }

    const listEl = document.createElement("div");
    drops.forEach((d) => listEl.appendChild(this.buildListRow(d)));
    pane.innerHTML = "";
    pane.appendChild(listEl);

    if (!this.state.selectedRewardKey || !drops.find((d) => d.rewardKey === this.state.selectedRewardKey)) {
      this.state.selectedRewardKey = drops[0].rewardKey;
      this.renderDetail();
    }
  },

  buildListRow(drop) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (drop.rewardKey === this.state.selectedRewardKey ? " selected" : "");
    const monsterName = this.dropMonsterName(drop);
    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="wl-name">${escapeHtml(monsterName || drop.rewardKey)}</div>
        <div class="wl-id">${escapeHtml(drop.rewardKey)}${Object.keys(drop.pools || {}).length ? ` &middot; ${Object.keys(drop.pools).length} pool${Object.keys(drop.pools).length === 1 ? "" : "s"}` : ""}</div>
      </div>
      ${drop.enemyNameKey ? '<span class="pill verified" title="Reward key reuses this monster\'s enemy Blueprint code — confirmed code link">monster</span>'
        : (drop.enemyCode ? '<span class="pill" style="opacity:0.75;" title="E-coded, but no matching EnemyName_* entry exists in the Monster database">E-code</span>'
        : (drop.isDebugKey ? '<span class="pill unverified">debug</span>' : ""))}
    `;
    row.addEventListener("click", () => {
      this.state.selectedRewardKey = drop.rewardKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const pane = document.getElementById("dropDetailPane");
    const drop = DataStore.monsterDrops.find((d) => d.rewardKey === this.state.selectedRewardKey);

    if (!drop) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a reward row</p></div></div>`;
      return;
    }

    const monsterName = this.dropMonsterName(drop);

    const rewardSetBlocks = (drop.rewardSets || []).map((rs) => `
      <div style="margin-top:8px;">
        <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:4px;">Reward set: <span style="font-family:var(--font-mono);">${escapeHtml(rs.questRewardID || "Default")}</span>${rs.hasCraftLevelParams ? ' <span class="pill" style="opacity:0.7;" title="This set also carries craft-level reward parameters in the source">craft-level params</span>' : ""}</div>
        ${rs.entries.map((e) => `
          <div style="display:flex; gap:8px; align-items:baseline; line-height:1.8;">
            <span style="min-width:64px; text-align:right; font-family:var(--font-mono); font-size:12px;" title="Weight-derived share of this set's total — the tables store weights, not printed rates">${e.sharePct != null ? e.sharePct + "%" : "—"}</span>
            ${e.lotItemKey
              ? `<span style="font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright);">${escapeHtml(e.lotItemKey)}</span><span style="font-size:11px; color:var(--hud-text-dim);">(weight ${e.weight} — pool below)</span>`
              : `<span style="font-size:12px; color:var(--hud-text-dim);" title="An explicit 'None' entry in the source — the chance this kill drops nothing from this set">no drop (weight ${e.weight})</span>`}
          </div>
        `).join("")}
      </div>
    `).join("");

    const poolBlocks = Object.entries(drop.pools || {}).map(([poolKey, slots]) => `
      <div class="hud-panel" style="width:100%; text-align:left; margin-top:10px; padding:10px 14px;">
        <div style="font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright); margin-bottom:6px;">${escapeHtml(poolKey)}</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--hud-border);">
            <th style="padding:3px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Item</th>
            <th style="padding:3px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Category / ID</th>
            <th style="padding:3px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Qty</th>
            <th style="padding:3px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);" title="Weight-derived share of this pool's total">Share</th>
          </tr></thead>
          <tbody>
            ${slots.map((s) => `
              <tr>
                <td style="padding:3px 10px; font-size:12px;">${s.itemKey
                  ? `${escapeHtml(DataStore.getDropItemName(s.itemKey))}${!DataStore.isDropItemNameVerified(s.itemKey) ? ' <span class="pill unverified">unverified</span>' : ""}`
                  : `<span style="color:var(--hud-text-dim);" title="No display name resolves for this category by either route (equipment ItemKey lookup or the ItemName pattern) — shown raw, not faked. Cost/Col are internal currency/cost entries.">${escapeHtml(s.category)} #${s.itemId}</span>`}</td>
                <td style="padding:3px 10px; font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim);">${escapeHtml(s.category)} / ${s.itemId}</td>
                <td style="padding:3px 10px; text-align:right; font-family:var(--font-mono); font-size:12px;">${s.num}</td>
                <td style="padding:3px 10px; text-align:right; font-family:var(--font-mono); font-size:12px;">${s.sharePct != null ? s.sharePct + "%" : "—"} <span style="opacity:0.55; font-size:10px;">(w ${s.weight})</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `).join("");

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Reward Row</h3>
        <div class="preview-name">${escapeHtml(monsterName || drop.rewardKey)}</div>
        <div class="preview-itemkey">${escapeHtml(drop.rewardKey)}
          ${drop.enemyNameKey ? '<span class="pill verified" title="Confirmed enemy-code link">monster-linked</span>' : ""}
          ${drop.variantOf ? `<span class="pill" style="opacity:0.75;" title="A _NN variant of the base reward key — the base code is ${escapeHtml(drop.variantOf)}">variant of ${escapeHtml(drop.variantOf)}</span>` : ""}
          ${drop.isDebugKey ? '<span class="pill unverified">debug row</span>' : ""}
        </div>

        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag" title="Which pools this reward rolls">Rewards: DT_RewardLotTable.json["${escapeHtml(drop.rewardKey)}"]</span>
          <span class="mod-source-tag" title="What each pool yields">Pools: DT_ItemLotTable.json</span>
        </div>

        ${!drop.enemyCode && !drop.isDebugKey ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Not linked to a monster</div>
            <div class="mod-effect-line">
              This reward key isn't an enemy code (named keys like <code>Boar01</code> or encounter
              keys like <code>WL01Hills2_sub002Boss1</code> are referenced by unexported Blueprint
              logic). A name-similarity guess would be easy here — and is deliberately not made.
            </div>
          </div>
        ` : ""}
        ${drop.enemyCode && !drop.enemyNameKey ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">E-coded, but not in the Monster database</div>
            <div class="mod-effect-line">
              <code>${escapeHtml(drop.enemyCode)}</code> follows the enemy Blueprint code pattern, but
              <code>EnemyName_${escapeHtml(drop.enemyCode.slice(1))}</code> exists in no language's
              table — the enemy exists in spawn data but has no database entry yet.
            </div>
          </div>
        ` : ""}

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:2px;">Reward Sets</div>
          <div style="font-size:11px; color:var(--hud-text-dim);">
            Per kill, one entry is rolled per set by weight — including explicit no-drop entries.
          </div>
          ${rewardSetBlocks}
        </div>

        ${poolBlocks || '<div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px;">This reward references no item pools.</div>'}
        ${(drop.missingPoolKeys || []).length ? `
          <div style="width:100%; text-align:left; font-size:11px; color:var(--rank-a); margin-top:8px;">
            Referenced pool key${drop.missingPoolKeys.length === 1 ? "" : "s"} missing from DT_ItemLotTable:
            ${drop.missingPoolKeys.map((k) => `<span style="font-family:var(--font-mono);">${escapeHtml(k)}</span>`).join(", ")} — shown, not hidden.
          </div>
        ` : ""}
      </div>
    `;
  },
};
