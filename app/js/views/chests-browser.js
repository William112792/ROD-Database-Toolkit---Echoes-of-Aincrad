// ============================================================
// chests-browser.js
// Browser for Items > Chests -- the 526 fixed treasure boxes of
// DT_FixTBoxTable.json (the FixTBoxTable DA_InGame points at), with
// contents resolved through the SAME shared pool resolver Monsters >
// Drops uses -- a pool can never resolve differently between the two
// tabs. This is where most of the ~900 item pools Drops found
// unreferenced by monster rewards turn out to live.
//
// Location context: chest keys are TB_{location}_{n}, and the
// location fragment is the SAME naming the gate registry uses after
// its SA_/WT_ prefix -- 522/526 chests match a registered gate's
// fragment exactly (checked). The join below runs client-side against
// the loaded Gates list. NO chest placement coordinates exist in the
// exported levels (searched) -- the gate link is location context,
// deliberately not a map position.
// ============================================================

const ChestsBrowserView = {
  state: {
    selectedChestId: null,
    search: "",
    locationFilter: "all",
  },

  render(container) {
    const idx = DataStore.chestIndex || {};
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${idx.count || 0}</b> fixed treasure boxes</span>
        <span><b>${idx.locations || 0}</b> locations</span>
        <span><b>${idx.withPools || 0}</b> with resolved pools</span>
        <span><b>${idx.missingPoolRefs || 0}</b> missing pool refs</span>
        <span style="margin-left:auto; opacity:0.6;" title="No chest placement coordinates exist in the exported levels — the gate-location link is context, not a map position.">no placement coordinates in export</span>
      </div>
      <div class="toolbar" id="chestToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 340px;">
        <div id="chestListPane" style="max-height:66vh; overflow-y:auto;"></div>
        <div id="chestDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderToolbar();
    this.renderList();
    this.renderDetail();
  },

  locationsList() {
    return [...new Set((DataStore.chestList || []).map((c) => c.location).filter(Boolean))].sort();
  },

  renderToolbar() {
    const el = document.getElementById("chestToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="chestSearchInput" placeholder="Search by chest ID, location, or item name..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="chestLocationSelect" style="max-width:260px;">
        <option value="all">All locations (${this.locationsList().length})</option>
        ${this.locationsList().map((l) => `<option value="${escapeHtml(l)}" ${this.state.locationFilter === l ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}
      </select>
    `;
    document.getElementById("chestSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderList();
    });
    document.getElementById("chestLocationSelect").addEventListener("change", (e) => {
      this.state.locationFilter = e.target.value;
      this.renderList();
    });
  },

  chestItemNames(chest) {
    const names = [];
    for (const slots of Object.values(chest.pools || {})) {
      for (const s of slots) if (s.itemKey) names.push(DataStore.getChestItemName(s.itemKey));
    }
    return names;
  },

  getFiltered() {
    let chests = DataStore.chestList || [];
    if (this.state.locationFilter !== "all") {
      chests = chests.filter((c) => c.location === this.state.locationFilter);
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      chests = chests.filter((c) =>
        c.chestId.toLowerCase().includes(q)
        || (c.location || "").toLowerCase().includes(q)
        || this.chestItemNames(c).some((n) => n.toLowerCase().includes(q))
      );
    }
    return chests;
  },

  renderList() {
    const pane = document.getElementById("chestListPane");
    const chests = this.getFiltered();
    if (!chests.length) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state" style="padding:30px 10px;"><div class="empty-icon">🔍</div><h4>No chests match</h4><p>Try widening the filter.</p></div></div>`;
      return;
    }
    const el = document.createElement("div");
    chests.forEach((c) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (c.chestId === this.state.selectedChestId ? " selected" : "");
      const names = this.chestItemNames(c);
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(c.chestId)}</div>
          <div class="wl-id">${escapeHtml(c.location || "?")}${names.length ? ` &middot; ${escapeHtml(names.slice(0, 2).join(", "))}${names.length > 2 ? "…" : ""}` : ""}</div>
        </div>
        ${c.missingPoolKeys.length ? '<span class="pill unverified" title="References a pool key missing from DT_ItemLotTable">missing pool</span>' : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedChestId = c.chestId;
        this.renderList();
        this.renderDetail();
      });
      el.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(el);
    if (!this.state.selectedChestId || !chests.find((c) => c.chestId === this.state.selectedChestId)) {
      this.state.selectedChestId = chests[0].chestId;
      this.renderDetail();
    }
  },

  renderDetail() {
    const pane = document.getElementById("chestDetailPane");
    const chest = (DataStore.chestList || []).find((c) => c.chestId === this.state.selectedChestId);
    if (!chest) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a chest</p></div></div>`;
      return;
    }
    // Client-side gate join: gate.id minus its SA_/WT_ prefix equals
    // the chest's location fragment -- against the same loaded Gates
    // data World > Gates renders (522/526 match, checked at build).
    const gates = (DataStore.getAllGatesFlat ? DataStore.getAllGatesFlat() : [])
      .filter((g) => g.id.replace(/^(SA|WT)_/, "") === chest.location);

    const poolBlocks = Object.entries(chest.pools || {}).map(([poolKey, slots]) => `
      <div class="hud-panel" style="width:100%; text-align:left; margin-top:10px; padding:10px 14px;">
        <div style="font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright); margin-bottom:6px;">${escapeHtml(poolKey)}</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--hud-border);">
            <th style="padding:3px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Item</th>
            <th style="padding:3px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Qty</th>
            <th style="padding:3px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);" title="Weight-derived share of this pool's total — the tables store weights, not printed rates">Share</th>
          </tr></thead>
          <tbody>
            ${slots.map((s) => `
              <tr>
                <td style="padding:3px 10px; font-size:12px;">${s.itemKey
                  ? `${escapeHtml(DataStore.getChestItemName(s.itemKey))}${s.itemKeySource && s.itemKeySource.startsWith("recipe") ? ' <span style="opacity:0.55; font-size:10px;" title="A Cost-category recipe purchase token — resolves to a recipe, see Items › Recipes">recipe</span>' : ""}`
                  : `<span style="color:var(--hud-text-dim);" title="No display name resolves for this slot by any route — shown raw, not faked">${escapeHtml(s.category)} #${s.itemId}</span>`}</td>
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
        <h3 style="align-self:stretch;">Fixed Treasure Box</h3>
        <div class="preview-name">${escapeHtml(chest.chestId)}</div>
        <div class="preview-itemkey">location ${escapeHtml(chest.location || "?")} &middot; box #${chest.chestNum != null ? chest.chestNum : "?"}</div>
        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag">Chest: DT_FixTBoxTable.json["${escapeHtml(chest.chestId)}"]</span>
          <span class="mod-source-tag">Contents: DT_ItemLotTable.json (shared resolver with Monsters › Drops)</span>
        </div>

        ${gates.length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:6px;">Location Context</div>
            ${gates.map((g) => `
              <div style="line-height:1.8; font-size:12px;">
                Near gate <span style="font-family:var(--font-mono); color:var(--db-cyan-bright);">${escapeHtml(g.id)}</span>
                — ${escapeHtml(DataStore.getGateDisplayName(g))} <span style="opacity:0.6;">(${escapeHtml(g.floor)}; see World › Gates)</span>
              </div>
            `).join("")}
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;">
              The chest key's location fragment exactly matches this gate's ID after its
              SA_/WT_ prefix — location CONTEXT only; no chest placement coordinates exist in
              the exported levels.
            </div>
          </div>
        ` : `
          <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px;">
            No registered gate shares this chest's location fragment (one of the 4/526 without a
            match) — shown as-is.
          </div>
        `}

        ${poolBlocks || ""}
        ${chest.missingPoolKeys.length ? `
          <div style="width:100%; text-align:left; font-size:11px; color:var(--rank-a); margin-top:8px;">
            Referenced pool key${chest.missingPoolKeys.length === 1 ? "" : "s"} missing from DT_ItemLotTable:
            ${chest.missingPoolKeys.map((k) => `<span style="font-family:var(--font-mono);">${escapeHtml(k)}</span>`).join(", ")} — shown, not hidden.
          </div>
        ` : ""}
      </div>
    `;
  },
};
