// ============================================================
// dungeons-browser.js
// Browser for World > Dungeons -- the 17 officially named dungeons
// (DungeonName_* keys, identical set in all 13 languages, verified)
// across 5 families matching the DNG/ folder codes
// (ERU/HFO/HTE/MGK/NTR).
//
// Same registry situation as Areas, confirmed before building: NO
// dungeon data-table list file exists anywhere in the export -- the
// localization key set IS the list. What each dungeon DOES have in
// real data, and what this view shows:
//   - its per-floor gate chain from DA_InGame's terminal registry
//     (start/end gates parsed from the {WT|SA}_{code}_F{n}{s|e}
//     ID pattern, incl. instanced _NNNNN end-gate variants)
//   - linked areas (areas whose own official title embeds this
//     dungeon's name key -- the same template link the Areas section
//     resolves; joined client-side against the SAME loaded data so
//     the two sections can never disagree)
//   - quest references
//   - its slice of DA_InGame's procedural generation config
//     (themes/ways/rooms/safe-seed sets, prefix-matched to the
//     dungeon code; near-misses like NTR_Twilight_* vs NTR_TWI are
//     deliberately NOT aliased -- they live in the index's unassigned
//     bucket, surfaced in Data Coverage)
//   - DNG/ module levels attributed by exact path-token match (a
//     SOFT dependency: DNG ships in Content-DNG.zip; when absent the
//     view says "not scanned", never "none exist")
// No image exists for any dungeon (searched), so no thumbnails.
// ============================================================

const DungeonsBrowserView = {
  state: {
    selectedDungeonKey: null,
    search: "",
    familyFilter: "all", // all | ERU | HFO | HTE | MGK | NTR
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="dungeonQuickCoverage"></div>
      <div class="toolbar" id="dungeonToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="dungeonListPane"></div>
        <div id="dungeonDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("dungeonQuickCoverage");
    const idx = DataStore.dungeonIndex || {};
    const all = DataStore.getAllDungeonsFlat();
    const named = all.filter((d) => DataStore.isDungeonNameVerified(d)).length;
    const dngNote = idx.dngScanAvailable
      ? `DNG module levels scanned (${Object.values(idx.dngFamilyLevelCounts || {}).reduce((a, b) => a + b, 0)} level files)`
      : "DNG/ not in this export — module levels not scanned (upload Content-DNG.zip and rebuild)";
    el.innerHTML = `
      <span><b>${all.length}</b> dungeons loaded</span>
      <span><b>${named}</b>/${all.length} names verified</span>
      <span><b>${idx.withGates || 0}</b> with gate chains</span>
      <span><b>${idx.withLinkedAreas || 0}</b> with linked areas</span>
      <span style="margin-left:auto; opacity:0.6;">${dngNote}</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("dungeonToolbar");
    const fams = ["all", "ERU", "HFO", "HTE", "MGK", "NTR"];
    el.innerHTML = `
      <input type="text" class="search-input" id="dungeonSearchInput" placeholder="Search by name or code..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="dungeonFamilySelect" style="max-width:200px;">
        ${fams.map((f) => `<option value="${f}" ${this.state.familyFilter === f ? "selected" : ""}>${f === "all" ? "All families" : f}</option>`).join("")}
      </select>
    `;
    document.getElementById("dungeonSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("dungeonFamilySelect").addEventListener("change", (e) => {
      this.state.familyFilter = e.target.value;
      this.renderListPane();
    });
  },

  getFilteredDungeons() {
    let list = DataStore.getAllDungeonsFlat();
    if (this.state.familyFilter !== "all") {
      list = list.filter((d) => d.family === this.state.familyFilter);
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      list = list.filter((d) =>
        DataStore.getDungeonDisplayName(d).toLowerCase().includes(q)
        || d.code.toLowerCase().includes(q)
      );
    }
    return list;
  },

  renderListPane() {
    const pane = document.getElementById("dungeonListPane");
    const list = this.getFilteredDungeons();

    if (list.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No dungeons match</h4>
            <p>Try clearing the search or picking another family.</p>
          </div>
        </div>
      `;
      return;
    }

    const listEl = document.createElement("div");
    list.forEach((d) => listEl.appendChild(this.buildListRow(d)));
    pane.innerHTML = "";
    pane.appendChild(listEl);

    if (!this.state.selectedDungeonKey || !list.find((d) => d.dungeonKey === this.state.selectedDungeonKey)) {
      this.state.selectedDungeonKey = list[0].dungeonKey;
      this.renderDetail();
    }
  },

  buildListRow(dungeon) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (dungeon.dungeonKey === this.state.selectedDungeonKey ? " selected" : "");
    const gateCount = (dungeon.gates || []).length;
    const areaCount = (dungeon.linkedAreaKeys || []).length;
    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="wl-name">${escapeHtml(DataStore.getDungeonDisplayName(dungeon))}</div>
        <div class="wl-id">${escapeHtml(dungeon.code)}${gateCount ? ` &middot; ${gateCount} gate${gateCount === 1 ? "" : "s"}` : ""}${areaCount ? ` &middot; ${areaCount} area${areaCount === 1 ? "" : "s"}` : ""}</div>
      </div>
      <span class="pill" style="opacity:0.8;">${escapeHtml(dungeon.family)}</span>
    `;
    row.addEventListener("click", () => {
      this.state.selectedDungeonKey = dungeon.dungeonKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const pane = document.getElementById("dungeonDetailPane");
    const dungeon = DataStore.dungeonByKey[this.state.selectedDungeonKey];

    if (!dungeon) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a dungeon</p></div></div>`;
      return;
    }

    const verified = DataStore.isDungeonNameVerified(dungeon);
    const idx = DataStore.dungeonIndex || {};
    const gen = dungeon.generation || {};

    // Gate chain grouped by dungeon floor number
    const gatesByFloor = {};
    (dungeon.gates || []).forEach((g) => {
      (gatesByFloor[g.dungeonFloorNum] = gatesByFloor[g.dungeonFloorNum] || []).push(g);
    });
    const floorNums = Object.keys(gatesByFloor).map(Number).sort((a, b) => a - b);

    const gateChainHtml = floorNums.map((fn) => `
      <tr>
        <td style="padding:4px 10px; font-size:12px; color:var(--hud-text); white-space:nowrap;">F${fn}</td>
        <td style="padding:4px 10px;">
          ${gatesByFloor[fn].map((g) => {
            const liveGate = DataStore.gateById[g.id];
            const gateName = liveGate ? DataStore.getGateDisplayName(liveGate) : g.id;
            return `<div style="display:flex; gap:8px; align-items:baseline; line-height:1.8;">
              <span class="pill" style="min-width:44px; text-align:center; ${g.gateKind === "start" ? "background:rgba(64,207,216,0.15); color:var(--db-cyan-bright);" : "opacity:0.75;"}">${g.gateKind}</span>
              <span style="font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright);">${escapeHtml(g.id)}</span>
              <span style="font-size:12px; color:var(--hud-text-dim);">${escapeHtml(gateName)}</span>
              ${g.variant ? '<span class="pill" style="opacity:0.6;" title="Instanced variant of this floor\'s end gate — the base ID exists alongside it in the registry">variant</span>' : ""}
            </div>`;
          }).join("")}
        </td>
      </tr>
    `).join("");

    const genList = (label, keys, title) => keys && keys.length ? `
      <div style="margin-top:8px;">
        <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:3px;" title="${escapeHtml(title)}">${label} (${keys.length})</div>
        <div>${keys.map((k) => `<span class="pill" style="font-family:var(--font-mono); font-size:10px; margin:2px 3px 2px 0; display:inline-block;">${escapeHtml(k)}</span>`).join("")}</div>
      </div>
    ` : "";

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Dungeon Preview</h3>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(DataStore.getDungeonDisplayName(dungeon))}</div>
        <div class="preview-itemkey">${escapeHtml(dungeon.dungeonKey)} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified</span>'} <span class="pill" style="opacity:0.8;">family ${escapeHtml(dungeon.family)}</span></div>

        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag" title="Where this dungeon's name comes from">Name: Localization/Game/{lang}/Game.json → ST_GeneralLocalizeList["${escapeHtml(dungeon.dungeonKey)}"]</span>
          <span class="mod-source-tag" title="Where gate chains and generation config come from">Gates + generation: DA_InGame.json</span>
        </div>

        ${(dungeon.gates || []).length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">Gate Chain (${dungeon.gates.length} gates)</div>
            <table style="width:100%; border-collapse:collapse;"><tbody>${gateChainHtml}</tbody></table>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:8px;">
              Parsed from the <code>{WT|SA}_${escapeHtml(dungeon.code)}_F{n}{s|e}</code> gate ID pattern
              in <code>DA_InGame.json</code>'s terminal registry. Full per-gate detail
              (coordinates, map pieces) lives in World &gt; Gates.
            </div>
          </div>
        ` : `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No registered gates</div>
            <div class="mod-effect-line">
              This dungeon has NO gates in <code>DA_InGame.json</code>'s terminal registry —
              genuinely absent (ERU_OKU / HFO_Ruin / HTE_FI / MGK_Test are the four such
              dungeons), not a lookup failure.
            </div>
          </div>
        `}

        ${(dungeon.linkedAreaKeys || []).length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:8px;">Linked Areas (${dungeon.linkedAreaKeys.length})</div>
            ${dungeon.linkedAreaKeys.map((k) => {
              const area = DataStore.areaByKey[k];
              return `<div style="display:flex; gap:8px; align-items:baseline; line-height:1.8;">
                <span style="font-size:12px; color:var(--hud-text);">${escapeHtml(area ? DataStore.getAreaDisplayName(area) : k)}</span>
                <span style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim);">${escapeHtml(k)}</span>
              </div>`;
            }).join("")}
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:8px;">
              Areas whose own official title embeds <code>{Rep_${escapeHtml(dungeon.dungeonKey)}}</code> —
              the same template link World &gt; Areas resolves, joined against the same loaded data.
            </div>
          </div>
        ` : ""}

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:4px;">Procedural Generation Config</div>
          <div style="font-size:11px; color:var(--hud-text-dim);">
            This dungeon's slice of <code>DA_InGame.json</code>'s generation data, prefix-matched by
            code — entries that match no named dungeon (debug/test/default/common) are listed in
            Data Coverage's unassigned bucket, not force-attributed here.
          </div>
          ${genList("Themes", gen.themes, "DungeonThemes entries: grid size / cell counts / elite + monster-house population parameters per theme")}
          ${genList("Ways", gen.ways, "Corridor/way module sets")}
          ${genList("Rooms", gen.rooms, "Chamber module sets, including boss chambers")}
          ${(gen.seedSets || []).length ? `
            <div style="margin-top:8px;">
              <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:3px;" title="SafeDungeonSeeds: pre-validated seed lists per theme + grid config">Safe seed sets (${gen.seedSets.length})</div>
              ${gen.seedSets.map((s) => `<div style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim); line-height:1.7;">${escapeHtml(s.themeKey)} — grid ${escapeHtml(String(s.gridSize && s.gridSize.X !== undefined ? `${s.gridSize.X}x${s.gridSize.Y}` : s.gridSize))} — ${s.seedCount} seeds</div>`).join("")}
            </div>
          ` : ""}
          ${!(gen.themes || []).length && !(gen.ways || []).length && !(gen.rooms || []).length && !(gen.seedSets || []).length
            ? '<div style="font-size:12px; color:var(--hud-text-dim); margin-top:8px;">No generation entries prefix-match this dungeon\'s code — genuinely absent from DA_InGame, not a scan gap.</div>' : ""}
        </div>

        ${(dungeon.moduleLevels || []).length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">Module Levels (${dungeon.moduleLevels.length})</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:6px;">
              DNG/ level files attributed by exact path-token match of <code>${escapeHtml(dungeon.code.split("_").slice(1).join("_"))}</code>
              within the <code>DNG/${escapeHtml(dungeon.family)}/</code> family folder. Files with no
              sub-code token stay family-shared (counted in Data Coverage), never misattributed.
            </div>
            <div style="max-height:220px; overflow-y:auto;">
              ${dungeon.moduleLevels.map((p) => `<div style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all; line-height:1.7;">${escapeHtml(p)}</div>`).join("")}
            </div>
          </div>
        ` : (idx.dngScanAvailable ? `
          <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px;">
            No DNG level file carries this dungeon's sub-code as a path token — its modules are
            among the <b>${(idx.dngFamilySharedCounts && idx.dngFamilySharedCounts[dungeon.family]) || 0}</b> family-shared
            files under <code>DNG/${escapeHtml(dungeon.family)}/</code> (attribution is token-exact by design,
            never guessed from partial matches).
          </div>
        ` : `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Module levels not scanned</div>
            <div class="mod-effect-line">
              DNG/ isn't present in this instance's raw export (it ships in Content-DNG.zip), so
              module levels couldn't be scanned — "no list here" means NOT SCANNED, not "none
              exist". Upload the archive and rebuild the Dungeons section to populate this.
            </div>
          </div>
        `)}

        ${(dungeon.questRefs || []).length ? `
          <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px;">
            Referenced by quest${dungeon.questRefs.length === 1 ? "" : "s"}:
            ${dungeon.questRefs.map((q) => `<span style="font-family:var(--font-mono); color:var(--hud-text);">${escapeHtml(q)}</span>`).join(", ")}
            <span style="opacity:0.7;">(see World &gt; Quests)</span>
          </div>
        ` : ""}
      </div>
    `;
  },
};
