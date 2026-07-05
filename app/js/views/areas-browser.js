// ============================================================
// areas-browser.js
// Browser for World > Areas -- 179 areas: the 176 official
// AreaTitle_* keys from the game's own localization export (all 13
// languages carry the identical key set, verified before this was
// built) plus 3 spawner-referenced *_SA_02 keys that exist in NO
// language table (shown flagged, following the Items section's
// "Hand Mirror" referenced-but-missing precedent).
//
// Genuinely different shape from every category before it, confirmed
// before this was written:
//   - NO data-table list file exists for areas AT ALL (no
//     DT_AreaList/DT_AreaDatabase anywhere; DT_InitPopAreaTable_WL01/
//     WL02 exist but have zero rows) -- the official localization key
//     set IS the registry. Every other category so far had a DT/
//     DataAsset list to source from.
//   - NO image/texture exists for any area (the in-game area title is
//     a spawned banner widget, not a stored image -- confirmed by
//     search), so like Monsters there is no thumbnail handling here.
//   - The value-add is CROSS-REFERENCES, all from real data:
//     teleport terminals (DA_InGame.json's per-floor WorldDatas
//     registry -- both gates whose destination IS the area and gates
//     NAMED AFTER the area via {Rep_} templates, kept distinct),
//     title-spawner level placements (BP_AreaTitle_Gimmick_Spawner
//     actors scanned from Maps/ + DNG/ level files -- a SOFT
//     dependency, those ship in separate Content-*.zip archives), and
//     quest references.
// ============================================================

const AreasBrowserView = {
  state: {
    selectedAreaKey: null,
    search: "",
    filter: "all", // all | dungeon | field | terminals | unofficial
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="areaQuickCoverage"></div>
      <div class="toolbar" id="areaToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="areaListPane"></div>
        <div id="areaDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("areaQuickCoverage");
    const idx = DataStore.areaIndex || {};
    const all = DataStore.getAllAreasFlat();
    const named = all.filter((a) => DataStore.isAreaNameVerified(a)).length;
    const scanNote = idx.levelScanAvailable
      ? `${idx.areasWithSpawners} areas have title-spawner placements (${idx.levelFilesScanned} level files scanned)`
      : "Maps/DNG not in this export — level placements not scanned (upload Content-Maps.zip / Content-DNG.zip and rebuild)";
    el.innerHTML = `
      <span><b>${all.length}</b> areas loaded</span>
      <span><b>${named}</b>/${all.length} names verified</span>
      <span><b>${idx.dungeonLinkedCount || 0}</b> dungeon-linked</span>
      <span><b>${idx.areasWithTerminals || 0}</b> with teleport gates</span>
      <span style="margin-left:auto; opacity:0.6;">${scanNote}</span>
    `;
  },

  renderToolbar() {
    const el = document.getElementById("areaToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="areaSearchInput" placeholder="Search by name or key..." value="${escapeHtml(this.state.search)}" />
      <select class="search-input" id="areaFilterSelect" style="max-width:240px;">
        <option value="all" ${this.state.filter === "all" ? "selected" : ""}>All areas</option>
        <option value="dungeon" ${this.state.filter === "dungeon" ? "selected" : ""}>Dungeon-linked</option>
        <option value="field" ${this.state.filter === "field" ? "selected" : ""}>No dungeon link</option>
        <option value="terminals" ${this.state.filter === "terminals" ? "selected" : ""}>With teleport gates</option>
        <option value="unofficial" ${this.state.filter === "unofficial" ? "selected" : ""}>Unofficial keys</option>
      </select>
    `;
    document.getElementById("areaSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("areaFilterSelect").addEventListener("change", (e) => {
      this.state.filter = e.target.value;
      this.renderListPane();
    });
  },

  getFilteredAreas() {
    let areas = DataStore.getAllAreasFlat();
    if (this.state.filter === "dungeon") {
      areas = areas.filter((a) => a.dungeonKey);
    } else if (this.state.filter === "field") {
      areas = areas.filter((a) => !a.dungeonKey);
    } else if (this.state.filter === "terminals") {
      areas = areas.filter((a) => a.terminals && a.terminals.length > 0);
    } else if (this.state.filter === "unofficial") {
      areas = areas.filter((a) => a.isUnofficialKey);
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      // Search hits both the display name AND the raw key -- same
      // stays-usable-mid-edit reasoning weapons/armor search follows.
      areas = areas.filter((a) =>
        DataStore.getAreaDisplayName(a).toLowerCase().includes(q)
        || a.areaKey.toLowerCase().includes(q)
      );
    }
    return areas;
  },

  renderListPane() {
    const pane = document.getElementById("areaListPane");
    const areas = this.getFilteredAreas();

    if (areas.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No areas match</h4>
            <p>Try clearing the search or picking another filter.</p>
          </div>
        </div>
      `;
      return;
    }

    const list = document.createElement("div");
    areas.forEach((a) => list.appendChild(this.buildListRow(a)));
    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedAreaKey || !areas.find((a) => a.areaKey === this.state.selectedAreaKey)) {
      this.state.selectedAreaKey = areas[0].areaKey;
      this.renderDetail();
    }
  },

  /**
   * Text-only row, no icon -- no image exists for any area anywhere
   * in the export (confirmed), so unlike Towns there is nothing real
   * to show here and no placeholder is faked.
   */
  buildListRow(area) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (area.areaKey === this.state.selectedAreaKey ? " selected" : "");
    const verified = DataStore.isAreaNameVerified(area);
    const gateCount = (area.terminals || []).length;
    row.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="wl-name">${escapeHtml(DataStore.getAreaDisplayName(area))}</div>
        <div class="wl-id">${escapeHtml(area.areaId)}${gateCount ? ` &middot; ${gateCount} gate${gateCount === 1 ? "" : "s"}` : ""}</div>
      </div>
      ${area.dungeonKey ? '<span class="pill" style="background:rgba(155,111,224,0.18); color:var(--rank-a); border-color:rgba(155,111,224,0.4);" title="This area\'s official title embeds a dungeon name — see the detail pane">dungeon</span>' : ""}
      ${area.isUnofficialKey ? '<span class="pill unverified" title="Referenced by a level file\'s area-title spawner, but this key exists in no language\'s official table">unofficial key</span>' : (!verified ? '<span class="pill unverified">unnamed</span>' : "")}
    `;
    row.addEventListener("click", () => {
      this.state.selectedAreaKey = area.areaKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const pane = document.getElementById("areaDetailPane");
    const area = DataStore.areaByKey[this.state.selectedAreaKey];

    if (!area) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an area</p></div></div>`;
      return;
    }

    const verified = DataStore.isAreaNameVerified(area);
    const displayName = DataStore.getAreaDisplayName(area);
    const dungeonName = DataStore.getAreaDungeonName(area);
    const idx = DataStore.areaIndex || {};

    const terminalRows = (area.terminals || []).map((t) => `
      <tr>
        <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright);">${escapeHtml(t.id)}</td>
        <td style="padding:4px 10px; font-size:12px;">${escapeHtml(t.floor)}</td>
        <td style="padding:4px 10px; font-size:12px;">${t.linkKind === "destination"
          ? '<span title="Teleporting to this gate places you in this area (the gate\'s own destination Key IS this area)">destination</span>'
          : '<span title="The gate\'s display name embeds this area\'s name via a {Rep_} template">named after area</span>'}</td>
        <td style="padding:4px 10px; font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim);">${t.coordinate
          ? `${Math.round(t.coordinate.X)}, ${Math.round(t.coordinate.Y)}, ${Math.round(t.coordinate.Z)}`
          : '<span title="This entry\'s coordinate is genuinely 0,0,0 in the source data — shown as unset rather than a fake origin point">—</span>'}</td>
      </tr>
    `).join("");

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Area Preview</h3>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${escapeHtml(area.areaKey)} ${verified
          ? '<span class="pill verified">verified</span>'
          : (area.isUnofficialKey
              ? '<span class="pill unverified" title="Referenced by level data but present in no language\'s official table">unofficial key</span>'
              : '<span class="pill unverified">unverified</span>')}</div>

        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag" title="Where this area's name comes from">Name: Localization/Game/{lang}/Game.json → ST_GeneralLocalizeList["${escapeHtml(area.areaKey)}"]</span>
          <span class="mod-source-tag" title="Where the gate links come from">Gates: DA_InGame.json → WorldDatas[].TerminalDatas</span>
        </div>

        ${area.isUnofficialKey ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Unofficial key</div>
            <div class="mod-effect-line">
              This key is referenced by a level file's <code>BP_AreaTitle_Gimmick_Spawner</code>
              actor but exists in NO language's official string table. Its <code>*_SA_02</code>
              suffix pattern suggests an internal variant of the same-named area (a second
              safe-area gate placement), but that reading is inferred from the naming alone,
              not confirmed by any data field. Shown rather than silently dropped — same
              precedent as Items' "Hand Mirror".
            </div>
          </div>
        ` : ""}

        ${area.dungeonKey ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:6px;">Linked Dungeon</div>
            <div style="font-size:13px; color:var(--hud-text);">${escapeHtml(dungeonName || area.dungeonKey)}</div>
            <div style="font-size:11px; font-family:var(--font-mono); color:var(--hud-text-dim); margin-top:2px;">${escapeHtml(area.dungeonKey)}</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:6px;">
              Link source: this area's own official title is a template embedding the dungeon's
              name key (<code>{Rep_${escapeHtml(area.dungeonKey)}}</code>) — resolved per-language
              the same way Recipes resolve their produced-item templates.
            </div>
          </div>
        ` : ""}

        ${(area.terminals || []).length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">Teleport Gates (${area.terminals.length})</div>
            <table style="width:100%; border-collapse:collapse;">
              <thead>
                <tr style="border-bottom:1px solid var(--hud-border);">
                  <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Terminal ID</th>
                  <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Floor</th>
                  <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Link</th>
                  <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">World Coordinate</th>
                </tr>
              </thead>
              <tbody>${terminalRows}</tbody>
            </table>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-top:8px;">
              <code>SA_*</code> IDs use the Safe Area terminal art set; <code>WT_*</code> IDs use the
              Warp Terminal art set — two confirmed, separate asset families. Whether either
              corresponds to the "Golden Gates" that item Usable_74 opens is an OPEN question:
              nothing in this export is named GoldenGate anywhere (see Data Coverage).
            </div>
          </div>
        ` : ""}

        ${(area.spawnerLevels || []).length ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">Level / Instance Placements (${area.spawnerLevels.length})</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:6px;">
              Level files containing a <code>BP_AreaTitle_Gimmick_Spawner</code> with this area's
              key — the trigger that shows the area-title banner in-game. Same
              level/instance-loading identifier family Towns and Quests already surface.
            </div>
            ${area.spawnerLevels.map((p) => `
              <div style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all; line-height:1.7;">${escapeHtml(p)}</div>
            `).join("")}
          </div>
        ` : (idx.levelScanAvailable ? "" : `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Level placements not scanned</div>
            <div class="mod-effect-line">
              Maps/ and DNG/ aren't present in this instance's raw export (they ship in separate
              Content-Maps.zip / Content-DNG.zip archives), so title-spawner placements couldn't
              be scanned — "no list here" means NOT SCANNED, not "none exist". Upload those
              archives and rebuild the Areas section to populate this.
            </div>
          </div>
        `)}

        ${(area.questRefs || []).length ? `
          <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px;">
            Referenced by quest${area.questRefs.length === 1 ? "" : "s"}:
            ${area.questRefs.map((q) => `<span style="font-family:var(--font-mono); color:var(--hud-text);">${escapeHtml(q)}</span>`).join(", ")}
            <span style="opacity:0.7;">(see World &gt; Quests)</span>
          </div>
        ` : ""}
      </div>
    `;
  },
};
