// ============================================================
// gates-browser.js
// Browser for World > Gates -- the full flattened teleport-gate
// registry from DA_InGame.json's WorldDatas: 192 gates across floor
// indexes Dungeon/First/Second, one row per gate.
//
// Confirmed structure, surfaced as-is:
//   - two ID families with two separate art sets (confirmed under
//     ENV/Theme/Elven/): SA_* Safe Area terminals (170) and WT_*
//     Warp Terminals (22 -- WT_TOB etc. match the Towns section's
//     terminal IDs, joined client-side below so the two sections can
//     never disagree)
//   - two nameKey kinds kept distinct: TerminalName_* (the gate's own
//     display string, often a {Rep_} template) and AreaTitle_* (the
//     gate's Key IS an area key = its destination; linked into
//     World > Areas)
//   - real world coordinates where non-zero in the source (122/192);
//     null otherwise, never a fake origin
//   - dungeon attribution parsed from the {WT|SA}_{code}_F{n}{s|e}
//     pattern (69 gates; SA_ERU_WAY_BOEROE_01 is the one dungeon-floor
//     gate matching nothing, left honestly unattributed)
//   - map-reveal piece data from DA_MapPiece_PL_WL01/02_WP.json where
//     the gate's ID has an entry (117 of 192)
//
// "Golden Gates" are deliberately NOT a column here: the term exists
// in exactly two official item strings (Usable_74, an imperfect
// Healing Crystal that "can also open Golden Gates") and nothing in
// any file identifies which gates -- if any currently shipped -- are
// golden. The SA_* crystal-activated hypothesis is recorded as an
// OPEN question in Data Coverage, not encoded as data.
// ============================================================

const GatesBrowserView = {
  state: {
    selectedGateId: null,
    search: "",
    floorFilter: "all", // all | Dungeon | First | Second
    typeFilter: "all",  // all | SA | WT
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="gateQuickCoverage"></div>
      <div class="toolbar" id="gateToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 380px;">
        <div id="gateListPane"></div>
        <div id="gateDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("gateQuickCoverage");
    const idx = DataStore.gateIndex || {};
    const all = DataStore.getAllGatesFlat();
    const named = all.filter((g) => DataStore.isGateNameVerified(g)).length;
    el.innerHTML = `
      <span><b>${all.length}</b> gates loaded</span>
      <span><b>${named}</b>/${all.length} names verified</span>
      <span><b>${(idx.byType && idx.byType.SA) || 0}</b> SA / <b>${(idx.byType && idx.byType.WT) || 0}</b> WT</span>
      <span><b>${idx.withCoordinates || 0}</b> with coordinates</span>
      <span><b>${idx.withMapPieces || 0}</b> with map pieces</span>
      <span style="margin-left:auto; opacity:0.6;">Registry: DA_InGame.json → WorldDatas</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("gateToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="gateSearchInput" placeholder="Search by name, ID, or key..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="gateFloorSelect" style="max-width:180px;">
        ${["all", "First", "Second", "Dungeon"].map((f) => `<option value="${f}" ${this.state.floorFilter === f ? "selected" : ""}>${f === "all" ? "All floors" : `Floor: ${f}`}</option>`).join("")}
      </select>
      <select class="search-input" id="gateTypeSelect" style="max-width:200px;">
        <option value="all" ${this.state.typeFilter === "all" ? "selected" : ""}>All types</option>
        <option value="SA" ${this.state.typeFilter === "SA" ? "selected" : ""}>SA — Safe Area</option>
        <option value="WT" ${this.state.typeFilter === "WT" ? "selected" : ""}>WT — Warp Terminal</option>
      </select>
    `;
    document.getElementById("gateSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("gateFloorSelect").addEventListener("change", (e) => {
      this.state.floorFilter = e.target.value;
      this.renderListPane();
    });
    document.getElementById("gateTypeSelect").addEventListener("change", (e) => {
      this.state.typeFilter = e.target.value;
      this.renderListPane();
    });
  },

  getFilteredGates() {
    let gates = DataStore.getAllGatesFlat();
    if (this.state.floorFilter !== "all") {
      gates = gates.filter((g) => g.floor === this.state.floorFilter);
    }
    if (this.state.typeFilter !== "all") {
      gates = gates.filter((g) => g.type === this.state.typeFilter);
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      gates = gates.filter((g) =>
        DataStore.getGateDisplayName(g).toLowerCase().includes(q)
        || g.id.toLowerCase().includes(q)
        || (g.nameKey || "").toLowerCase().includes(q)
      );
    }
    return gates;
  },

  renderListPane() {
    const pane = document.getElementById("gateListPane");
    const gates = this.getFilteredGates();

    if (gates.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No gates match</h4>
            <p>Try clearing the search or widening the filters.</p>
          </div>
        </div>
      `;
      return;
    }

    const listEl = document.createElement("div");
    gates.forEach((g) => listEl.appendChild(this.buildListRow(g)));
    pane.innerHTML = "";
    pane.appendChild(listEl);

    if (!this.state.selectedGateId || !gates.find((g) => g.id === this.state.selectedGateId)) {
      this.state.selectedGateId = gates[0].id;
      this.renderDetail();
    }
  },

  buildListRow(gate) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (gate.id === this.state.selectedGateId ? " selected" : "");
    const verified = DataStore.isGateNameVerified(gate);
    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="wl-name">${escapeHtml(DataStore.getGateDisplayName(gate))}</div>
        <div class="wl-id">${escapeHtml(gate.id)} &middot; ${escapeHtml(gate.floor)}</div>
      </div>
      <span class="pill" style="${gate.type === "WT" ? "background:rgba(64,207,216,0.15); color:var(--db-cyan-bright);" : "opacity:0.75;"}" title="${gate.type === "WT" ? "Warp Terminal art family" : "Safe Area terminal art family"}">${escapeHtml(gate.type)}</span>
      ${!verified ? '<span class="pill unverified" title="This gate\'s name key exists in no language\'s official table">unnamed</span>' : ""}
    `;
    row.addEventListener("click", () => {
      this.state.selectedGateId = gate.id;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const pane = document.getElementById("gateDetailPane");
    const gate = DataStore.gateById[this.state.selectedGateId];

    if (!gate) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a gate</p></div></div>`;
      return;
    }

    const verified = DataStore.isGateNameVerified(gate);
    const destArea = gate.destinationAreaKey ? DataStore.areaByKey[gate.destinationAreaKey] : null;
    const dungeon = gate.dungeonKey ? DataStore.dungeonByKey[gate.dungeonKey] : null;
    // Client-side town join. NOTE: towns' terminalID (TG_001-style,
    // from DT_TownList.json) is a DIFFERENT ID namespace than this
    // registry's WT_*/SA_* IDs -- checked, they never literally match.
    // The real, confirmed tie is the gate's own display template
    // embedding the town's AreaTitle key (nameRefAreaKeys) or being
    // keyed by it directly (destinationAreaKey).
    const town = (DataStore.getAllTownsFlat ? DataStore.getAllTownsFlat() : [])
      .find((t) => t.nameKey && (
        (gate.nameRefAreaKeys || []).includes(t.nameKey)
        || gate.destinationAreaKey === t.nameKey
      ));

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Gate Preview</h3>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(DataStore.getGateDisplayName(gate))}</div>
        <div class="preview-itemkey">${escapeHtml(gate.id)} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified</span>'}</div>

        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag" title="The registry this gate comes from">Registry: DA_InGame.json → WorldDatas[].TerminalDatas</span>
          <span class="mod-source-tag" title="Where this gate's display name resolves from">Name key: ST_GeneralLocalizeList["${escapeHtml(gate.nameKey || "")}"]</span>
        </div>

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
          <table style="width:100%; border-collapse:collapse;"><tbody>
            <tr>
              <td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim); white-space:nowrap;">Type</td>
              <td style="padding:4px 10px; font-size:12px;">${gate.type === "WT"
                ? "WT — Warp Terminal (one of 22; separate art set from SA gates)"
                : "SA — Safe Area terminal (one of 170; separate art set from WT gates)"}</td>
            </tr>
            <tr>
              <td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Floor index</td>
              <td style="padding:4px 10px; font-size:12px;">${escapeHtml(gate.floor)}</td>
            </tr>
            <tr>
              <td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">World coordinate</td>
              <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px;">${gate.coordinate
                ? `${Math.round(gate.coordinate.X)}, ${Math.round(gate.coordinate.Y)}, ${Math.round(gate.coordinate.Z)}`
                : '<span style="color:var(--hud-text-dim);" title="Genuinely 0,0,0 in the source registry — shown as unset rather than a fake origin point">— (unset in source)</span>'}</td>
            </tr>
            <tr>
              <td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Map pieces</td>
              <td style="padding:4px 10px; font-size:12px;">${gate.mapPieces
                ? `${gate.mapPieces.pieceCount} reveal piece${gate.mapPieces.pieceCount === 1 ? "" : "s"} (${escapeHtml(gate.mapPieces.world)}) — from DA_MapPiece_PL_${escapeHtml(gate.mapPieces.world)}_WP.json`
                : '<span style="color:var(--hud-text-dim);">none keyed by this gate\'s ID</span>'}</td>
            </tr>
          </tbody></table>
        </div>

        ${destArea ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:6px;">Destination Area</div>
            <div style="font-size:13px; color:var(--hud-text);">${escapeHtml(DataStore.getAreaDisplayName(destArea))}</div>
            <div style="font-size:11px; font-family:var(--font-mono); color:var(--hud-text-dim); margin-top:2px;">${escapeHtml(gate.destinationAreaKey)}</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;">
              This gate's registry Key IS an area key — teleporting here places you in this area
              (see World &gt; Areas).
            </div>
          </div>
        ` : ""}

        ${dungeon ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:6px;">Dungeon Gate</div>
            <div style="font-size:13px; color:var(--hud-text);">${escapeHtml(DataStore.getDungeonDisplayName(dungeon))} — Floor ${gate.dungeonFloorNum}, ${escapeHtml(gate.gateKind)} gate${gate.gateVariant ? ` (instanced variant _${escapeHtml(gate.gateVariant)})` : ""}</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;">
              Parsed from the <code>{WT|SA}_{code}_F{n}{s|e}</code> ID pattern (see World &gt; Dungeons
              for the full chain).
            </div>
          </div>
        ` : ""}

        ${town ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:6px;">Town Terminal</div>
            <div style="font-size:13px; color:var(--hud-text);">${escapeHtml(DataStore.getTownDisplayName ? DataStore.getTownDisplayName(town) : town.townId)}</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;">
              This gate's display template embeds the town's <code>AreaTitle</code> key from
              <code>DT_TownList.json</code> (see World &gt; Towns) — note the town's own
              <code>terminalID</code> (${escapeHtml(town.terminalID || "TG_*")}) is a separate ID
              namespace from this registry's WT_/SA_ IDs; the name-template link is the
              confirmed tie, joined against the same loaded data.
            </div>
          </div>
        ` : ""}

        <div style="width:100%; text-align:left; font-size:11px; color:var(--hud-text-dim); margin-top:14px;">
          Whether any currently shipped gate is a "Golden Gate" (the thing item Usable_74's
          Healing Crystal "can also open") is an OPEN question — nothing in this export is named
          GoldenGate anywhere. Recorded in Data Coverage, deliberately not guessed here.
        </div>
      </div>
    `;
  },
};
