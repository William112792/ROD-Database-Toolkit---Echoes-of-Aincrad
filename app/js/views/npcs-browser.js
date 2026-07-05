// ============================================================
// npcs-browser.js
// Browser for Characters > NPCs -- the union of the three NPC data
// sources under DataAssets/Character/NPC/ (183 entries: 114 NPCData
// definitions + 69 roster-only IDs), shown honestly with all their
// mismatches visible rather than hidden:
//   - roster tables DT_NPC_001..006 (ID lists per town -- numbered to
//     match the six towns with detail files)
//   - NPCData files (NameKey, appearance PartsID, sequences, look-at)
//   - NPCParts files (Head/HeadGear/Body skeletal-mesh paths into
//     CHR/ -- a forward reference to the future Skeleton Assets tab)
//   - NPCAction files (placed action scripts: move types + gesture
//     animation montages)
//
// CONFIRMED before building: NPC display names DO NOT RESOLVE -- all
// 114 NameKeys (NPC1002 style) exist in NO language's localization
// tables. Generic townsfolk are unnamed in this export, so entries
// are shown by ID with the raw NameKey, labeled as unresolvable.
// ============================================================

const NPCsBrowserView = {
  state: {
    selectedNpcId: null,
    search: "",
    filter: "all", // all | town | dataonly | rosteronly | debug
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="npcQuickCoverage"></div>
      <div class="toolbar" id="npcToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 340px;">
        <div id="npcListPane" style="max-height:68vh; overflow-y:auto;"></div>
        <div id="npcDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("npcQuickCoverage");
    const idx = DataStore.npcIndex || {};
    el.innerHTML = `
      <span><b>${idx.count || 0}</b> NPCs</span>
      <span><b>${idx.withDataFile || 0}</b> with data files</span>
      <span><b>${idx.withParts || 0}</b> with appearance parts</span>
      <span><b>${idx.withActions || 0}</b> with placed actions</span>
      <span style="margin-left:auto; opacity:0.6;" title="All 114 NameKeys (NPC1002 style) exist in NO language's localization tables — generic townsfolk are unnamed in this export. Confirmed, not a lookup failure.">0 names resolve in any language</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("npcToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="npcSearchInput" placeholder="Search by ID, NameKey, or mesh..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="npcFilterSelect" style="max-width:230px;">
        <option value="all" ${this.state.filter === "all" ? "selected" : ""}>All NPCs</option>
        <option value="town" ${this.state.filter === "town" ? "selected" : ""}>In a town roster</option>
        <option value="dataonly" ${this.state.filter === "dataonly" ? "selected" : ""}>Data file, no roster</option>
        <option value="rosteronly" ${this.state.filter === "rosteronly" ? "selected" : ""}>Roster only (no data file)</option>
        <option value="debug" ${this.state.filter === "debug" ? "selected" : ""}>Debug set (009_FacialCheck)</option>
      </select>
    `;
    document.getElementById("npcSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("npcFilterSelect").addEventListener("change", (e) => {
      this.state.filter = e.target.value;
      this.renderListPane();
    });
  },

  getFilteredNpcs() {
    let npcs = DataStore.npcList;
    if (this.state.filter === "town") npcs = npcs.filter((n) => n.roster);
    else if (this.state.filter === "dataonly") npcs = npcs.filter((n) => n.dataFile && !n.roster && !n.isDebugSet);
    else if (this.state.filter === "rosteronly") npcs = npcs.filter((n) => !n.dataFile);
    else if (this.state.filter === "debug") npcs = npcs.filter((n) => n.isDebugSet);
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      npcs = npcs.filter((n) =>
        String(n.npcId).includes(q)
        || (n.nameKey || "").toLowerCase().includes(q)
        || Object.values(n.meshes || {}).some((m) => m.toLowerCase().includes(q))
      );
    }
    return npcs;
  },

  renderListPane() {
    const pane = document.getElementById("npcListPane");
    const npcs = this.getFilteredNpcs();
    if (!npcs.length) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state" style="padding:30px 10px;"><div class="empty-icon">🔍</div><h4>No NPCs match</h4><p>Try widening the filter.</p></div></div>`;
      return;
    }
    const listEl = document.createElement("div");
    npcs.forEach((n) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (n.npcId === this.state.selectedNpcId ? " selected" : "");
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">NPC ${n.npcId}</div>
          <div class="wl-id">${escapeHtml(n.nameKey || "(no data file)")}${n.roster ? ` &middot; town ${escapeHtml(n.roster.townId)}` : ""}</div>
        </div>
        ${n.isDebugSet ? '<span class="pill unverified">debug</span>' : ""}
        ${!n.dataFile ? '<span class="pill unverified" title="Listed in a town roster table but no NPCData file exists anywhere in the export">roster only</span>' : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedNpcId = n.npcId;
        this.renderListPane();
        this.renderDetail();
      });
      listEl.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(listEl);
    if (this.state.selectedNpcId == null || !npcs.find((n) => n.npcId === this.state.selectedNpcId)) {
      this.state.selectedNpcId = npcs[0].npcId;
      this.renderDetail();
    }
  },

  renderDetail() {
    const pane = document.getElementById("npcDetailPane");
    const npc = DataStore.npcList.find((n) => n.npcId === this.state.selectedNpcId);
    if (!npc) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an NPC</p></div></div>`;
      return;
    }
    const town = npc.roster ? (DataStore.getAllTownsFlat ? DataStore.getAllTownsFlat() : []).find((t) => t.id === npc.roster.townId) : null;

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">NPC</h3>
        <div class="preview-name unverified">NPC ${npc.npcId}</div>
        <div class="preview-itemkey">${escapeHtml(npc.nameKey || "—")}
          <span class="pill unverified" title="This NameKey exists in NO language's localization tables — 0 of 114 NPC keys resolve anywhere. Generic townsfolk are unnamed in this export (confirmed).">name unresolvable</span>
          ${npc.isDebugSet ? '<span class="pill unverified">debug set</span>' : ""}
        </div>

        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          ${npc.dataFile ? `<span class="mod-source-tag">Data: ${escapeHtml(npc.dataFile)}</span>` : ""}
          ${npc.roster ? `<span class="mod-source-tag">Roster: ${escapeHtml(npc.roster.table)}.json</span>` : ""}
        </div>

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
          <table style="width:100%; border-collapse:collapse;"><tbody>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim); white-space:nowrap;">Town roster</td>
              <td style="padding:4px 10px; font-size:12px;">${npc.roster
                ? `${town ? escapeHtml(DataStore.getTownDisplayName(town)) + " " : ""}(${escapeHtml(npc.roster.table)} — see World &gt; Towns)`
                : '<span style="color:var(--hud-text-dim);">not in any DT_NPC roster</span>'}</td></tr>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Placement folder</td>
              <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px;">${escapeHtml(npc.placementFolder || "—")}</td></tr>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Sequences / Look-at</td>
              <td style="padding:4px 10px; font-size:12px;">${npc.sequenceCount} sequence${npc.sequenceCount === 1 ? "" : "s"} · look-at ${npc.lookAt ? "on" : "off"}</td></tr>
          </tbody></table>
        </div>

        ${npc.meshes ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:6px;">Appearance Parts (PartsID ${npc.partsId})</div>
            ${Object.entries(npc.meshes).map(([slot, path]) => `
              <div style="line-height:1.8;"><span style="font-size:11px; color:var(--hud-text-dim); display:inline-block; min-width:70px;">${escapeHtml(slot)}</span>
              <span style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all;">${escapeHtml(path)}</span></div>
            `).join("")}
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;">
              Skeletal-mesh references into <code>CHR/</code> — browsable in detail once the
              planned Skeleton Assets tab lands (Asset Inspector, later in the roadmap).
            </div>
          </div>
        ` : (npc.partsMissing ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Appearance parts missing</div>
            <div class="mod-effect-line">This NPC references PartsID <code>${npc.partsId}</code>, but no
            <code>NPCParts_${npc.partsId}.json</code> exists in the export — shown, not hidden
            (the 9xxx debug set references parts that were never exported).</div>
          </div>
        ` : "")}

        ${(npc.actions || []).length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:6px;">Placed Actions (${npc.actions.length})</div>
            ${npc.actions.map((a) => `
              <div style="margin-bottom:8px;">
                <div style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all;">${escapeHtml(a.file)}</div>
                ${a.moveTypes.length ? `<div style="font-size:11px; color:var(--hud-text-dim);">move: ${a.moveTypes.map(escapeHtml).join(", ")}</div>` : ""}
                ${a.gestureAnimations.length ? `<div style="font-size:11px; color:var(--hud-text-dim);">gestures: ${a.gestureAnimations.slice(0, 4).map((g) => `<span style="font-family:var(--font-mono);">${escapeHtml(g)}</span>`).join(", ")}${a.gestureAnimations.length > 4 ? ` +${a.gestureAnimations.length - 4} more` : ""}</div>` : ""}
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  },
};
