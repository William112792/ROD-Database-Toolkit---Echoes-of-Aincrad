// ============================================================
// world-map-browser.js
// World > Map -- built from the game's OWN coordinate system
// (decoded and verified across several sessions):
//   - DA_MapPiece assets: per-gate map pieces, PiecePosition = piece
//     CENTER in world units, TexturePerPixel = 80, pieces 512x512.
//     Screen axes +X right / +Y down (verified against the floor-map
//     widget's own canvas offsets).
//   - DA_InGame terminal Coordinates: 122 of 192 plot directly.
//     SA = Safe Area, WT = Warp Terminal (the game's own legend).
//   - Floor overview overlays come from WBP_Map_FloorMap_WL01's
//     CanvasPanelSlot offsets -- the game's own layout.
//
// ICONS: 25 real game icon sprites (Widget/3DMapCapture/MapIcon/
// IconImages), recolored server-side by build_pipeline.py's
// build_map_icons() -- each is an unrecolored red(shape)/green(shadow)
// mask sprite, verified by direct pixel sampling, not final art.
// White = explicitly unconfirmed color, never a guess.
//
// MANUAL MARKERS (new): this export has NO coordinate data at all for
// most icon types, and NONE for Towns/Dungeons. Rather than leave
// those permanently empty, a small user-content system (mirroring
// Modding Guides' own outside-the-pipeline pattern) lets a person
// place a pin anywhere on any of the four map surfaces via a form
// (pick an icon, enter normalized X/Y 0-1, optional label, submit),
// backed by server.js's /api/map-markers/:mapType/:areaKey endpoints
// and stored in map-markers/*.json at the project root -- never
// touched by build_pipeline.py, exactly like guides/. Capped at 999
// entries per map surface (server-enforced).
//
// FOUR modes, switched by the top tab bar: Field Map, World View,
// Towns, Dungeons. Field Map / World View use real world coordinates
// for their pieces and auto markers; Towns / Dungeons are a
// completely different, simpler asset (single pre-composited images)
// with NO automatic markers -- only manual ones, which is exactly
// what unlocks a real legend for them per the request.
// ============================================================

// Canonical icon catalog for the Add-Marker picker and legends.
// Keys match build_pipeline.py's MAP_ICON_COLORS exactly.
const MAP_ICON_CATALOG = [
  { key: "safeArea", label: "Safe Area", fallback: "▲" },
  { key: "warpTerminal", label: "Warp Terminal", fallback: "◆" },
  { key: "town", label: "Town", fallback: "◆" },
  { key: "dungeon", label: "Dungeon Entrance", fallback: "◆" },
  { key: "searchTerminal", label: "Search Terminal", fallback: "◆" },
  { key: "door", label: "Door", fallback: "◆" },
  { key: "seal", label: "Seal", fallback: "◆" },
  { key: "magicalSeal", label: "Magical Seal", fallback: "◆" },
  { key: "ark", label: "Ark", fallback: "◆" },
  { key: "boss", label: "Boss", fallback: "☠" },
  { key: "eliteMonster", label: "Elite Monster", fallback: "☠" },
  { key: "monsterSpawn", label: "Monster", fallback: "✦" },
  { key: "townSmithy", label: "Smithy", fallback: "◆" },
  { key: "townItemSeller", label: "Shop", fallback: "◆" },
  { key: "townChest", label: "Chest", fallback: "▣" },
  { key: "treasureChest", label: "Treasure Chest", fallback: "▣" },
  { key: "player", label: "Player", fallback: "●" },
  { key: "material", label: "Material", fallback: "✿" },
  { key: "sideQuestTrinket", label: "Side Quest Trinket", fallback: "◆" },
  { key: "missionObjective", label: "Mission Objective", fallback: "◈" },
  { key: "waypoint", label: "Waypoint Pin (Classic)", fallback: "📍" },
  { key: "waypointPinBase", label: "Waypoint Pin (Base)", fallback: "📍" },
  { key: "waypointPinCommon", label: "Waypoint Pin (Common)", fallback: "📍" },
  { key: "waypointPinEnemy", label: "Waypoint Pin (Enemy)", fallback: "📍" },
  { key: "waypointPinGimmick", label: "Waypoint Pin (Gimmick)", fallback: "📍" },
  { key: "waypointPinItem", label: "Waypoint Pin (Item)", fallback: "📍" },
];
const MAP_ICON_BY_KEY = Object.fromEntries(MAP_ICON_CATALOG.map((i) => [i.key, i]));

// Default legend layers shown per surface before any manual markers
// exist -- curated per the user's own examples ("Towns should have
// Smithy/Shop/Chest"; "Dungeons should have Safe Areas/Warp
// Terminals/Boss/Treasure Chest/Materials"). Any OTHER icon key that
// actually has a manual entry on a given surface is unioned in too,
// so nothing placed is ever invisible in its own legend.
const MAP_DEFAULT_LEGEND = {
  field: ["safeArea", "warpTerminal", "treasureChest", "ark", "seal", "magicalSeal",
          "sideQuestTrinket", "boss", "eliteMonster", "monsterSpawn", "material",
          "missionObjective", "door", "searchTerminal", "waypoint"],
  world: ["safeArea", "warpTerminal", "treasureChest", "ark", "seal", "magicalSeal",
          "sideQuestTrinket", "boss", "eliteMonster", "monsterSpawn", "material",
          "missionObjective", "town", "dungeon", "waypoint"],
  town: ["townSmithy", "townItemSeller", "townChest", "safeArea", "warpTerminal",
         "boss", "treasureChest", "material", "door", "waypoint"],
  dungeon: ["safeArea", "warpTerminal", "boss", "eliteMonster", "treasureChest",
            "material", "seal", "magicalSeal", "ark", "door", "monsterSpawn", "waypoint"],
};

const WorldMapBrowserView = {
  state: {
    loaded: false,
    data: null,
    mode: "field",      // field | world | towns | dungeons
    fieldSub: "overview", // overview | area (within Field Map mode)
    areaGateId: null,
    worldCode: null,
    townCode: null,
    dungeonSuffix: null,
    layers: {},          // populated per-surface from MAP_DEFAULT_LEGEND, all on by default
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedMarkerId: null,
    selectedChestId: null, // chest pin selected on the area map (approximate ring pins)
    manualCache: {},     // { "mapType:areaKey": { entries, count, max } }
    addForm: { icon: "waypointPinCommon", x: "0.5", y: "0.5", label: "" },
    previewHidden: false,
  },

  async render(container) {
    this.container = container;
    if (!this.state.loaded) {
      container.innerHTML = `<div class="hud-panel"><p style="color:var(--hud-text-dim);">Loading world map…</p></div>`;
      try {
        this.state.data = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/WorldMap/WorldMap.json`);
        try {
          this.state.staticMaps = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/WorldMap/StaticMaps.json`);
        } catch (e) {
          this.state.staticMaps = { towns: [], dungeonFloors: [], dungeonMinimapModules: [] };
        }
        this.state.loaded = true;
      } catch (e) {
        container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Couldn't load WorldMap.json — run the World focus build.</p></div></div>`;
        return;
      }
    }
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="toolbar" id="mapModeTabs" style="margin-bottom:10px;"></div><div id="mapModeBody"></div>`;
    container.appendChild(wrap);
    this.renderModeTabs();
    this.renderModeBody();
  },

  renderModeTabs() {
    const el = document.getElementById("mapModeTabs");
    const worlds = Object.keys((this.state.data.worldComposites || {}));
    const tabs = [
      ["field", "🗺 Field Map"],
      ["world", `🌐 World View${worlds.length ? "" : " (n/a)"}`],
      ["towns", `🏘 Towns (${(this.state.staticMaps.towns || []).length})`],
      ["dungeons", `⛰ Dungeons (${(this.state.staticMaps.dungeonFloors || []).length})`],
    ];
    el.innerHTML = tabs.map(([key, label]) =>
      `<button class="toggle-btn${this.state.mode === key ? " active" : ""}" data-modetab="${key}" ${key === "world" && !worlds.length ? "disabled" : ""}>${label}</button>`
    ).join("");
    el.querySelectorAll("[data-modetab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.mode = btn.dataset.modetab;
        this.renderModeTabs();
        this.renderModeBody();
      });
    });
  },

  renderModeBody() {
    const body = document.getElementById("mapModeBody");
    body.innerHTML = "";
    const iconCount = Object.keys(this.icons()).length;
    if (iconCount === 0) {
      // The recolored icon set (26 keys) comes from a pipeline step
      // that needs Pillow + numpy (see build_map_icons in
      // build_pipeline.py) -- it degrades gracefully rather than
      // crashing the build when they're missing, but the visible
      // result is every marker/legend row falling back to a plain
      // text/Unicode symbol instead of a real icon image. Surfacing
      // that plainly here so "old/wrong icons" reads as "not built
      // yet" rather than a rendering bug.
      const banner = document.createElement("div");
      banner.className = "coverage-banner";
      banner.style.marginBottom = "8px";
      banner.innerHTML = `
        <span class="pill unverified">no recolored icons found</span>
        <span style="opacity:0.85;">Markers are showing plain fallback symbols instead of real
        icons. Map icon recoloring runs on the Python standard library alone (no Pillow/numpy
        required) — run the <b>World</b> or <b>Textures</b> focus build from the Build
        Dashboard (or <code>python3 tools/build_pipeline.py --group=world</code>) to generate
        them, then reload this page. If you've already done that and still see this, check the
        server log for a "Map icons" line for a more specific error.</span>
      `;
      body.appendChild(banner);
    }
    if (this.state.mode === "world") return this.renderWorldView(body);
    if (this.state.mode === "towns") return this.renderTownsView(body);
    if (this.state.mode === "dungeons") return this.renderDungeonsView(body);
    if (this.state.fieldSub === "area" && this.state.areaGateId) return this.renderAreaView(body);
    return this.renderOverview(body);
  },

  // ---------- Field Map: overview ----------
  renderOverview(container) {
    // Multi-world since the WL02 export landed: floorOverviews carries
    // one entry per world that ships BOTH the floor texture and the
    // widget (WL01: 8 piece overlays; WL02: the game's own widget has
    // ZERO piece slots yet -- verified, so the floor image renders
    // with that stated rather than fake highlights). Old builds only
    // have .floor -- treated as a one-world list.
    const overviews = (this.state.data.floorOverviews && this.state.data.floorOverviews.length)
      ? this.state.data.floorOverviews
      : (this.state.data.floor ? [this.state.data.floor] : []);
    if (!this.state.overviewWorld || !overviews.find((f) => f.world === this.state.overviewWorld)) {
      this.state.overviewWorld = overviews.length ? overviews[0].world : null;
    }
    const floor = overviews.find((f) => f.world === this.state.overviewWorld) || null;
    const areas = this.state.data.areas || [];
    const withTex = areas.filter((a) => a.hasTextures);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${areas.length}</b> areas in the map-piece registry</span>
        <span><b>${withTex.length}</b> with exported map textures</span>
        <span><b>${floor ? floor.overlays.length : 0}</b> floor overlays (game's own layout${overviews.length > 1 ? `, ${escapeHtml(this.state.overviewWorld || "")}` : ""})</span>
        <span style="margin-left:auto; opacity:0.6;" title="Only some area families have their map textures exported so far — more appear here automatically as exports land, same as the asset sidecars.">textures appear as exported</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 300px;">
        <div id="mapAreaListPane" style="max-height:70vh; overflow-y:auto;"></div>
        <div class="hud-panel" style="padding:14px; text-align:center;">
          <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">
            Floor Overview
            ${overviews.length > 1 ? overviews.map((f) => `<button class="toggle-btn ov-world-btn${f.world === this.state.overviewWorld ? " active" : ""}" data-ovworld="${escapeHtml(f.world)}" style="font-size:11px; margin-left:6px;">${escapeHtml(f.world)}</button>`).join("") : ` — ${escapeHtml(this.state.overviewWorld || "")}`}
          </div>
          ${floor && !floor.overlays.length ? `<div style="font-size:10.5px; color:var(--hud-sp); margin-bottom:6px;">The game's own ${escapeHtml(floor.world)} floor-map widget ships with no highlight pieces yet (verified in the WBP) — the floor image is shown as-is; areas open from the list on the left.</div>` : ""}
          <div id="mapFloorStage" style="position:relative; display:inline-block; max-width:100%;"></div>
          <div style="font-size:11px; color:var(--hud-text-dim); margin-top:8px;">
            The overview uses the game's own floor-map widget layout. Highlighted regions have
            exported area maps — click one (or pick from the list) to open its interactive map.
            Prefer one continuous map? Try <b>World View</b> above.
          </div>
        </div>
      </div>
    `;
    container.appendChild(wrap);
    wrap.querySelectorAll(".ov-world-btn").forEach((b) => b.addEventListener("click", () => {
      this.state.overviewWorld = b.dataset.ovworld;
      this.renderModeBody();
    }));

    const stage = document.getElementById("mapFloorStage");
    if (floor) {
      const scale = 0.62;
      const sz = floor.size * scale;
      stage.style.width = `${sz}px`;
      stage.style.height = `${sz}px`;
      stage.innerHTML = `<img src="${escapeHtml(floor.image)}" alt="Floor map" style="width:100%; height:100%; display:block; border:1px solid var(--hud-border); border-radius:8px;"/>`;
      for (const ov of floor.overlays) {
        // UE canvas-slot semantics (see build_world_map): with the
        // slots' Alignment (0.5, 0.5), Left/Top is where the overlay's
        // CENTER sits relative to the canvas center -- so the top-left
        // corner is Left/Top minus alignment*size. The old top-left
        // interpretation shifted every piece down-right by half its
        // own size (the reported "odd placement" on this overview).
        // alignX/alignY default to 0.5 so a WorldMap.json built before
        // the field existed still renders correctly.
        const ax = ov.alignX != null ? ov.alignX : 0.5;
        const ay = ov.alignY != null ? ov.alignY : 0.5;
        const left = (floor.size / 2 + ov.left - ax * ov.width) * scale;
        const top = (floor.size / 2 + ov.top - ay * ov.height) * scale;
        const area = this.areaForOverlay(ov.name);
        const el = document.createElement("img");
        el.src = ov.image;
        el.alt = ov.name;
        el.title = area ? `${ov.name} — open interactive map` : `${ov.name} (piece shown; detailed map not exported yet)`;
        el.style.cssText = `position:absolute; left:${left}px; top:${top}px; width:${ov.width * scale}px; height:${ov.height * scale}px;`
          + (area ? "cursor:pointer; filter:drop-shadow(0 0 6px rgba(64,207,216,0.8));" : "opacity:0.55;");
        if (area) el.addEventListener("click", () => this.openArea(area.gateId));
        stage.appendChild(el);
      }
    } else {
      stage.innerHTML = `<div class="empty-state"><p>Floor map texture not exported.</p></div>`;
    }

    const pane = document.getElementById("mapAreaListPane");
    const list = document.createElement("div");
    areas.slice().sort((x, y) => (y.hasTextures - x.hasTextures) || x.gateId.localeCompare(y.gateId)).forEach((a) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row";
      row.style.opacity = a.hasTextures ? "1" : "0.5";
      const gate = (DataStore.getAllGatesFlat ? DataStore.getAllGatesFlat() : []).find((g) => g.id === a.gateId);
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(gate ? DataStore.getGateDisplayName(gate) : a.gateId)}</div>
          <div class="wl-id">${escapeHtml(a.gateId)} · ${a.markers.length} markers · ${a.chestIds.length} chests</div>
        </div>
        ${a.hasTextures ? '<span class="pill verified">map</span>' : '<span class="pill unverified" title="Map textures for this area are not in the export yet — appears automatically when exported">no textures yet</span>'}
        ${a.hasTextures && (a.seamRisk === "high" || a.seamRisk === "medium") ? `<span class="pill unverified" title="This area's pieces overlap thinly at one boundary — a visible seam or gap is possible">${a.seamRisk === "high" ? "gaps likely" : "seam possible"}</span>` : ""}
      `;
      if (a.hasTextures) row.addEventListener("click", () => this.openArea(a.gateId));
      list.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(list);
  },

  areaForOverlay(name) {
    const norm = name.replace(/_(\d)$/, (m, d) => `_0${d}`);
    return (this.state.data.areas || []).find((a) => a.hasTextures && (a.location === norm || a.location === name || a.location.startsWith(name)));
  },

  openArea(gateId) {
    this.state.mode = "field";
    this.state.fieldSub = "area";
    this.state.areaGateId = gateId;
    this.state.zoom = 1; this.state.panX = 0; this.state.panY = 0;
    this.state.selectedMarkerId = null;
    this.render(this.container);
  },

  // ---------- Manual markers (server-backed, per map surface) ----------
  manualCacheKey(mapType, areaKey) {
    return `${mapType}:${areaKey}`;
  },

  async loadManualMarkers(mapType, areaKey) {
    const cacheKey = this.manualCacheKey(mapType, areaKey);
    try {
      const res = await fetch(`/api/map-markers/${encodeURIComponent(mapType)}/${encodeURIComponent(areaKey)}`);
      const data = await res.json();
      this.state.manualCache[cacheKey] = data;
      return data;
    } catch (e) {
      this.state.manualCache[cacheKey] = { entries: [], count: 0, max: 999 };
      return this.state.manualCache[cacheKey];
    }
  },

  getManualMarkers(mapType, areaKey) {
    const cacheKey = this.manualCacheKey(mapType, areaKey);
    return this.state.manualCache[cacheKey] || { entries: [], count: 0, max: 999 };
  },

  async submitManualMarker(mapType, areaKey, refreshFn) {
    const form = this.state.addForm;
    const x = Number(form.x), y = Number(form.y);
    if (!form.icon || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      alert("Pick an icon and enter X/Y between 0 and 1.");
      return;
    }
    try {
      const res = await fetch(`/api/map-markers/${encodeURIComponent(mapType)}/${encodeURIComponent(areaKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iconKey: form.icon, x, y, label: form.label || "" }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Could not add marker"); return; }
      await this.loadManualMarkers(mapType, areaKey);
      this.state.addForm.label = "";
      if (refreshFn) refreshFn();
    } catch (e) {
      alert(`Failed to add marker: ${e.message}`);
    }
  },

  async deleteManualMarker(mapType, areaKey, entryId, refreshFn) {
    try {
      const res = await fetch(`/api/map-markers/${encodeURIComponent(mapType)}/${encodeURIComponent(areaKey)}/${encodeURIComponent(entryId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Could not delete marker"); return; }
      await this.loadManualMarkers(mapType, areaKey);
      if (refreshFn) refreshFn();
    } catch (e) {
      alert(`Failed to delete marker: ${e.message}`);
    }
  },

  // Renders the "Add Marker" form + existing-manual-entries list. Call
  // after the map stage exists so "click map to fill X/Y" can attach.
  renderAddMarkerPanel(mapType, areaKey, opts) {
    const el = document.getElementById("mapAddMarkerPanel");
    if (!el) return;
    const manual = this.getManualMarkers(mapType, areaKey);
    const form = this.state.addForm;
    el.innerHTML = `
      <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">
        Add a marker <span style="font-size:10px; color:var(--hud-text-dim); font-weight:400;">(${manual.count}/${manual.max})</span>
      </div>
      <select id="markerIconSelect" class="filter-select" style="width:100%; margin-bottom:6px;">
        ${MAP_ICON_CATALOG.map((i) => `<option value="${i.key}" ${form.icon === i.key ? "selected" : ""}>${escapeHtml(i.label)}</option>`).join("")}
      </select>
      <div style="display:flex; gap:6px; margin-bottom:6px;">
        <input type="number" id="markerXInput" min="0" max="1" step="0.001" value="${escapeHtml(String(form.x))}" placeholder="X (0-1)" class="search-input" style="width:50%;"/>
        <input type="number" id="markerYInput" min="0" max="1" step="0.001" value="${escapeHtml(String(form.y))}" placeholder="Y (0-1)" class="search-input" style="width:50%;"/>
      </div>
      <input type="text" id="markerLabelInput" value="${escapeHtml(form.label)}" placeholder="Label (optional)" class="search-input" style="width:100%; margin-bottom:6px;"/>
      <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
        <div style="font-size:10px; color:var(--hud-text-dim); flex:1;">Click the map to fill X/Y from where you click (also moves the dashed preview pin), or type them directly.</div>
        <button class="toggle-btn" id="markerPreviewToggleBtn" style="font-size:10px; padding:3px 8px; white-space:nowrap;" title="Hide/show the dashed preview pin so it doesn't get confused with markers already placed on the map">${this.state.previewHidden ? "Show preview" : "Hide preview"}</button>
      </div>
      <button class="toggle-btn" id="markerSubmitBtn" style="width:100%;" ${manual.count >= manual.max ? "disabled" : ""}>＋ Add Marker</button>
      <div id="markerExistingList" style="margin-top:10px;"></div>
      <div style="font-size:10px; color:var(--hud-text-dim); margin-top:8px;">Saved on this toolkit's own server (map-markers/) — visible to everyone using this instance.</div>
    `;
    this.renderExistingMarkerList(mapType, areaKey, opts);

    const updatePreview = () => opts.updatePreview && opts.updatePreview();
    document.getElementById("markerPreviewToggleBtn").addEventListener("click", (e) => {
      this.state.previewHidden = !this.state.previewHidden;
      e.target.textContent = this.state.previewHidden ? "Show preview" : "Hide preview";
      updatePreview();
    });
    document.getElementById("markerIconSelect").addEventListener("change", (e) => { form.icon = e.target.value; updatePreview(); });
    document.getElementById("markerXInput").addEventListener("input", (e) => { form.x = e.target.value; updatePreview(); });
    document.getElementById("markerYInput").addEventListener("input", (e) => { form.y = e.target.value; updatePreview(); });
    document.getElementById("markerLabelInput").addEventListener("input", (e) => { form.label = e.target.value; });
    document.getElementById("markerSubmitBtn").addEventListener("click", () => this.submitManualMarker(mapType, areaKey, opts.onChange));
    updatePreview();
  },

  // Split out so adding/deleting a marker can refresh JUST the count +
  // delete list without re-rendering (and losing focus/state in) the
  // rest of the form -- fixes a real bug where the "existing markers"
  // list (the only place to delete one) never updated after Add.
  renderExistingMarkerList(mapType, areaKey, opts) {
    const listEl = document.getElementById("markerExistingList");
    if (!listEl) return;
    const manual = this.getManualMarkers(mapType, areaKey);
    const countEl = document.querySelector("#mapAddMarkerPanel > div:first-child span");
    if (countEl) countEl.textContent = `(${manual.count}/${manual.max})`;
    const submitBtn = document.getElementById("markerSubmitBtn");
    if (submitBtn) submitBtn.disabled = manual.count >= manual.max;
    listEl.innerHTML = manual.entries.length ? `
      <div style="max-height:160px; overflow-y:auto;">
        ${manual.entries.map((e) => `
          <div style="display:flex; align-items:center; gap:6px; padding:3px 0; font-size:11px; color:var(--hud-text-dim);">
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml((MAP_ICON_BY_KEY[e.iconKey] || {}).label || e.iconKey)}${e.label ? " — " + escapeHtml(e.label) : ""}</span>
            <button class="toggle-btn" data-delete-marker="${escapeHtml(e.id)}" style="padding:1px 7px; font-size:10px;">✕ Remove</button>
          </div>
        `).join("")}
      </div>
    ` : `<div style="font-size:10.5px; color:var(--hud-text-dim);">No manual markers here yet.</div>`;
    listEl.querySelectorAll("[data-delete-marker]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteManualMarker(mapType, areaKey, btn.dataset.deleteMarker, opts.onChange));
    });
  },

  // Live "where will this land" preview: a dashed, semi-transparent
  // ghost pin at the form's current X/Y, using the form's currently
  // selected icon -- updates on every icon/X/Y change and on
  // click-to-set, answering "I don't see anything representing where
  // the marker will be added" directly rather than making the person
  // submit blind.
  updateMarkerPreview(stageEl, w, h) {
    if (!stageEl) return;
    stageEl.querySelectorAll(".map-marker-preview").forEach((m) => m.remove());
    if (this.state.previewHidden) return;
    const form = this.state.addForm;
    const x = Number(form.x), y = Number(form.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
    const st = this.iconVisual(form.icon);
    const el = document.createElement("div");
    el.className = "map-marker-preview";
    const scale = 1 / Math.max(this.state.zoom || 1, 0.4);
    el.style.cssText = `position:absolute; left:${x * w}px; top:${y * h}px; transform:translate(-50%,-100%) scale(${scale}); z-index:7; opacity:0.6; pointer-events:none;`
      + `filter:drop-shadow(0 0 4px #40cfd8);`;
    el.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center;">
        ${st.icon
          ? `<img src="${st.icon}" alt="" style="width:26px; height:26px; object-fit:contain;"/>`
          : `<span style="color:#40cfd8; font-size:18px;">${st.fallback}</span>`}
        <div style="width:8px; height:8px; margin-top:-4px; border:1px dashed #40cfd8; border-radius:50%;"></div>
      </div>
    `;
    stageEl.appendChild(el);
  },


  // ---------- Shared marker drawing / legend (Field Map + World View) ----------
  waypointKey() {
    return this.state.mode === "world" ? `world:${this.state.worldCode}` : `field:${this.state.areaGateId}`;
  },

  ensureLayers(mapType) {
    const defaults = MAP_DEFAULT_LEGEND[mapType] || [];
    for (const key of defaults) {
      if (!(key in this.state.layers)) this.state.layers[key] = true;
    }
  },

  renderPieceStageCommon(opts) {
    const wPx = (opts.bounds.maxX - opts.bounds.minX) / opts.tpp;
    const hPx = (opts.bounds.maxY - opts.bounds.minY) / opts.tpp;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="toolbar">
        ${opts.backFn ? `<button class="toggle-btn" id="mapBackBtn">← ${escapeHtml(opts.backLabel || "Back")}</button>` : ""}
        <span style="font-family:var(--font-display); font-size:14px; font-weight:600; color:var(--hud-text);">${escapeHtml(opts.title)}</span>
        <span style="font-size:11px; color:var(--hud-text-dim);">${escapeHtml(opts.subtitle)}</span>
        <span style="margin-left:auto; font-size:11px; color:var(--hud-text-dim);">drag to pan · wheel to zoom · click the map to set marker X/Y</span>
      </div>
      ${opts.seamRisk === "high" || opts.seamRisk === "medium" ? `
        <div class="coverage-banner" style="margin-top:0;">
          <span class="pill unverified">${opts.seamRisk === "high" ? "gaps likely" : "seam possible"}</span>
          <span style="opacity:0.7;">Some of this view's pieces overlap thinly at one boundary — piece placement itself is verified; a visible seam or gap there reflects the game's own authored piece layout.</span>
        </div>
      ` : ""}
      <div class="equip-layout side-right" style="--side-col: 300px;">
        <div class="hud-panel" style="padding:8px; overflow:hidden;">
          <div id="mapViewport" style="position:relative; width:100%; height:66vh; overflow:hidden; cursor:grab; border-radius:6px; background:rgba(0,0,0,0.25);">
            <div id="mapStage" style="position:absolute; left:0; top:0; width:${wPx}px; height:${hPx}px; transform-origin:0 0;"></div>
          </div>
        </div>
        <div>
          <div class="hud-panel" style="padding:12px 14px;">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">Legend — click to toggle</div>
            <div id="mapLegend"></div>
          </div>
          <div class="hud-panel" style="padding:12px 14px; margin-top:12px;" id="mapAddMarkerPanel"></div>
          <div class="hud-panel" style="padding:12px 14px; margin-top:12px;" id="mapSidePanel"></div>
        </div>
      </div>
    `;
    if (opts.backFn) {
      wrap.querySelector("#mapBackBtn").addEventListener("click", opts.backFn);
    }
    return { wrap, wPx, hPx };
  },

  drawPieces(stage, pieces, bounds, tpp, seamRisk) {
    for (const p of pieces) {
      const left = (p.centerX - p.px * tpp / 2 - bounds.minX) / tpp;
      const top = (p.centerY - p.px * tpp / 2 - bounds.minY) / tpp;
      const img = document.createElement("img");
      img.src = p.image;
      img.draggable = false;
      const useMask = p.maskImage && seamRisk !== "high";
      img.style.cssText = `position:absolute; left:${left}px; top:${top}px; width:${p.px}px; height:${p.px}px; user-select:none;`
        + (useMask ? ` -webkit-mask-image:url(${p.maskImage}); mask-image:url(${p.maskImage}); -webkit-mask-size:100% 100%; mask-size:100% 100%; -webkit-mask-mode:luminance; mask-mode:luminance;` : "");
      stage.appendChild(img);
    }
  },

  icons() {
    return this.state.data.icons || {};
  },

  // Gimmick pins come from the runtime dump (GimmickDump Lua mod) --
  // these coordinates exist in NO export, so they only appear once a
  // sweep has captured them. Each kind gets its own colour and its own
  // layer toggle, so a map thick with chests can still be read.
  // Runtime-dump gimmicks -> the game's OWN map pins. Nearly every kind
  // has a real one (seal, ark, door, side-quest trinket, town chest...),
  // so the fallbacks are rare by design:
  //   lore/tips     -> Waypoint Pin (Common), as the game itself has no
  //                    dedicated lore icon.
  //   anything else -> Waypoint Pin (Classic), a deliberate "we don't
  //                    know the right pin yet" marker rather than a
  //                    confident-looking wrong one.
  // The two noisiest kinds (sequence_ctrl, accessible) are INTERNAL logic
  // actors -- barriers, boss triggers, area controllers -- and there are
  // 161 of them in a single sweep. They're captured and listed, but their
  // layers start OFF so they can't bury the things a player cares about.
  GIMMICK_VISUALS: {
    chest:            { iconKey: "treasureChest",     label: "Treasure Chest" },
    chest_town:       { iconKey: "townChest",         label: "Chest (town)" },
    subquest_trinket: { iconKey: "sideQuestTrinket",  label: "Side Quest Trinket" },
    seal:             { iconKey: "seal",              label: "Seal" },
    sealed_ark:       { iconKey: "ark",               label: "Sealed Ark" },
    ark:              { iconKey: "ark",               label: "Ark" },
    lore_tip:         { iconKey: "waypointPinCommon", label: "Lore / Tip" },
    gift_pillar:      { iconKey: "waypointPinCommon", label: "Gift Pillar" },
    quest_terminal:   { iconKey: "searchTerminal",    label: "Quest Terminal" },
    terminal:         { iconKey: "safeArea",          label: "Terminal" },
    barrier:          { iconKey: "door",              label: "Barrier" },
    gate_door:        { iconKey: "door",              label: "Gate Door" },
    wall_door:        { iconKey: "door",              label: "Wall Door" },
    dungeon_guide:    { iconKey: "dungeon",           label: "Dungeon Guide" },
    map_pin:          { iconKey: "waypoint",          label: "Map Pin" },
    signpost:         { iconKey: "waypoint",          label: "Signpost" },
    breakable:        { iconKey: "waypointPinGimmick", label: "Breakable" },
    interactive:      { iconKey: "waypointPinGimmick", label: "Interactive Gimmick" },
    accessible:       { iconKey: "waypointPinGimmick", label: "Area Controller", defaultOff: true },
    sequence_ctrl:    { iconKey: "waypointPinGimmick", label: "Sequence / Boss Trigger", defaultOff: true },
  },

  gimmickVisual(kind) {
    const g = this.GIMMICK_VISUALS[kind];
    // Unknown kind -> Waypoint Pin (Classic). Honest placeholder.
    const iconKey = (g && g.iconKey) || "waypoint";
    const meta = MAP_ICON_BY_KEY[iconKey] || { label: iconKey, fallback: "◆" };
    return {
      icon: this.icons()[iconKey],
      fallback: meta.fallback || "◆",
      color: "#fff",
      label: (g && g.label) || kind,
      layerKey: `gimmick_${kind}`,
      defaultOff: Boolean(g && g.defaultOff),
    };
  },


  markerVisual(kind) {
    const icons = this.icons();
    if (kind === "WT") return { icon: icons.warpTerminal, fallback: "◆", color: "#fff", label: "Warp Terminal", layerKey: "warpTerminal" };
    if (kind === "SA") return { icon: icons.safeArea, fallback: "▲", color: "#fff", label: "Safe Area", layerKey: "safeArea" };
    if (kind && kind !== "SA" && kind !== "WT") return this.gimmickVisual(kind);
    return { icon: null, fallback: "●", color: "var(--hud-text-dim)", label: "Marker", layerKey: null };
  },

  iconVisual(iconKey) {
    const icons = this.icons();
    const meta = MAP_ICON_BY_KEY[iconKey] || { label: iconKey, fallback: "◆" };
    return { icon: icons[iconKey], fallback: meta.fallback, color: "#fff", label: meta.label, layerKey: iconKey };
  },

  drawMarkers(stage, markers, bounds, tpp) {
    stage.querySelectorAll(".map-marker").forEach((m) => m.remove());
    for (const m of markers) {
      const st = this.markerVisual(m.kind);
      if (st.layerKey && !this.state.layers[st.layerKey]) continue;
      const x = (m.x - bounds.minX) / tpp;
      const y = (m.y - bounds.minY) / tpp;
      const el = document.createElement("div");
      el.className = "map-marker";
      const scale = 1 / Math.max(this.state.zoom, 0.4);
      el.style.cssText = `position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-50%) scale(${scale}); cursor:pointer; z-index:5;`
        + (m.id === this.state.selectedMarkerId ? "filter:drop-shadow(0 0 6px #fff);" : "");
      el.innerHTML = st.icon
        ? `<img src="${st.icon}" alt="${escapeHtml(st.label)}" style="width:28px; height:28px; object-fit:contain;"/>`
        : `<span style="color:${st.color}; font-size:16px; text-shadow:0 0 6px rgba(0,0,0,0.9);">${st.fallback}</span>`;
      el.title = `${st.label}: ${m.id}`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.state.selectedMarkerId = m.id;
        this._redrawSidePanel();
        this.drawMarkers(stage, markers, bounds, tpp);
      });
      stage.appendChild(el);
    }
  },

  // Manual markers use NORMALIZED 0-1 coordinates against the stage's
  // own pixel size (wPx/hPx) -- independent of world tpp, which is
  // what lets the same entry shape work for Field Map/World View
  // (which have world coords) AND Towns/Dungeons (which never will).
  drawManualMarkers(stage, mapType, areaKey, wPx, hPx, refreshFn) {
    stage.querySelectorAll(".map-manual-marker").forEach((m) => m.remove());
    const manual = this.getManualMarkers(mapType, areaKey);
    for (const entry of manual.entries) {
      if (!this.state.layers[entry.iconKey]) continue;
      const st = this.iconVisual(entry.iconKey);
      const x = entry.x * wPx, y = entry.y * hPx;
      const el = document.createElement("div");
      el.className = "map-manual-marker";
      const scale = 1 / Math.max(this.state.zoom, 0.4);
      el.style.cssText = `position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-100%) scale(${scale}); cursor:pointer; z-index:6;`;
      el.innerHTML = st.icon
        ? `<img src="${st.icon}" alt="${escapeHtml(st.label)}" style="width:26px; height:26px; object-fit:contain;"/>`
        : `<span style="color:#FFD54A; font-size:18px; text-shadow:0 0 6px rgba(0,0,0,0.9);">${st.fallback}</span>`;
      el.title = `${st.label}${entry.label ? ": " + entry.label : ""} (click to remove)`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (confirm(`Remove this "${st.label}" marker${entry.label ? ` (${entry.label})` : ""}?`)) {
          this.deleteManualMarker(mapType, areaKey, entry.id, refreshFn);
        }
      });
      stage.appendChild(el);
    }
  },

  legendRows(mapType, autoMarkers, chestCount, manualEntries) {
    const icons = this.icons();
    const autoCount = (kind) => autoMarkers.filter((m) => m.kind === kind).length;
    const manualCountFor = (key) => manualEntries.filter((e) => e.iconKey === key).length;
    const keys = new Set(MAP_DEFAULT_LEGEND[mapType] || []);
    for (const e of manualEntries) keys.add(e.iconKey);

    const notes = {
      safeArea: null, warpTerminal: null,
      treasureChest: "Approximate ring near the area gate — the EXPORT has no chest coordinates. Chests captured by the GimmickDump Lua mod get REAL coordinates and appear as their own 'Treasure Chest' layer instead.",
    };
    const rows = [...keys].map((key) => {
      const meta = MAP_ICON_BY_KEY[key] || { label: key, fallback: "◆" };
      let count = manualCountFor(key);
      if (key === "safeArea") count += autoCount("SA");
      if (key === "warpTerminal") count += autoCount("WT");
      if (key === "treasureChest" && mapType === "field") count = chestCount;
      return {
        key, label: `${meta.label} (${count})`, icon: icons[key], fallback: meta.fallback, color: "#fff",
        note: notes[key] || null,
      };
    });

    // One row per gimmick KIND actually captured for this area. Built
    // from the markers present rather than a fixed list, so a kind you
    // haven't swept yet doesn't sit in the legend as a permanent zero.
    const gimmickKinds = [...new Set(autoMarkers.filter((m) => m.fromRuntimeDump).map((m) => m.kind))].sort();
    for (const kind of gimmickKinds) {
      const v = this.gimmickVisual(kind);
      if (!(v.layerKey in this.state.layers)) this.state.layers[v.layerKey] = !v.defaultOff;
      rows.push({
        key: v.layerKey,
        label: `${v.label} (${autoCount(kind)})`,
        icon: v.icon,
        fallback: v.fallback,
        color: v.color,
        note: "Captured at runtime by the GimmickDump Lua mod — real in-world coordinates. These exist in no export.",
      });
    }
    return rows;
  },

  legendIconHtml(iconUrl, fallback, color) {
    return iconUrl
      ? `<img src="${iconUrl}" alt="" style="width:18px; height:18px; object-fit:contain;"/>`
      : `<span style="color:${color}; font-size:15px;">${fallback}</span>`;
  },

  setupLegend(mapType, ctx) {
    const el = document.getElementById("mapLegend");
    const manual = this.getManualMarkers(mapType, ctx.areaKey);
    const rows = this.legendRows(mapType, ctx.markers, ctx.chestCount, manual.entries);
    el.innerHTML = rows.map((r) => `
      <div class="map-legend-row${this.state.layers[r.key] ? " on" : ""}"
           data-layer="${r.key}" ${r.note ? `title="${escapeHtml(r.note)}"` : ""}
           style="display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:5px; margin-bottom:2px; cursor:pointer;
                  ${this.state.layers[r.key] ? "background:rgba(64,207,216,0.1); border:1px solid rgba(64,207,216,0.25);" : "border:1px solid transparent;"}">
        <span style="width:18px; text-align:center; display:inline-flex; align-items:center; justify-content:center;">${this.legendIconHtml(r.icon, r.fallback, r.color)}</span>
        <span style="font-size:12px; color:var(--hud-text); flex:1;">${escapeHtml(r.label)}</span>
        <span style="font-size:10px; color:var(--hud-text-dim);">${this.state.layers[r.key] ? "shown" : "hidden"}</span>
      </div>
    `).join("");
    el.querySelectorAll(".map-legend-row").forEach((row) => {
      row.addEventListener("click", () => {
        const k = row.dataset.layer;
        this.state.layers[k] = !this.state.layers[k];
        this.setupLegend(mapType, ctx);
        if (ctx.onLegendChange) ctx.onLegendChange();
      });
    });
  },

  bindMapClickForCoords(mapType, areaKey, wPx, hPx, isWorldSpace, bounds, tpp) {
    const stage = document.getElementById("mapStage");
    stage.addEventListener("click", (ev) => {
      if (this._justPanned) { this._justPanned = false; return; }
      const rect = stage.getBoundingClientRect();
      const localX = (ev.clientX - rect.left) / this.state.zoom;
      const localY = (ev.clientY - rect.top) / this.state.zoom;
      const nx = Math.min(1, Math.max(0, localX / wPx));
      const ny = Math.min(1, Math.max(0, localY / hPx));
      this.state.addForm.x = nx.toFixed(3);
      this.state.addForm.y = ny.toFixed(3);
      const xInput = document.getElementById("markerXInput");
      const yInput = document.getElementById("markerYInput");
      if (xInput) xInput.value = this.state.addForm.x;
      if (yInput) yInput.value = this.state.addForm.y;
      this.updateMarkerPreview(stage, wPx, hPx);
    });
  },

  bindPanZoom(bounds, tpp, wPx, hPx, onZoom) {
    const vp = document.getElementById("mapViewport");
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    vp.addEventListener("pointerdown", (e) => {
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = this.state.panX; oy = this.state.panY;
      vp.style.cursor = "grabbing"; vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - sx) > 3 || Math.abs(e.clientY - sy) > 3) moved = true;
      this.state.panX = ox + (e.clientX - sx);
      this.state.panY = oy + (e.clientY - sy);
      this.applyTransform();
    });
    vp.addEventListener("pointerup", (e) => {
      dragging = false; vp.style.cursor = "grab"; vp.releasePointerCapture(e.pointerId);
      if (moved) this._justPanned = true;
    });
    vp.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const oldZ = this.state.zoom;
      const z = Math.min(8, Math.max(0.08, oldZ * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.state.panX = mx - (mx - this.state.panX) * (z / oldZ);
      this.state.panY = my - (my - this.state.panY) * (z / oldZ);
      this.state.zoom = z;
      this.applyTransform();
      if (onZoom) onZoom();
    }, { passive: false });
  },

  applyTransform() {
    const stage = document.getElementById("mapStage");
    if (stage) stage.style.transform = `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.zoom})`;
  },

  fitToViewport(wPx, hPx) {
    const vp = document.getElementById("mapViewport");
    const fit = Math.min(vp.clientWidth / wPx, vp.clientHeight / hPx);
    this.state.zoom = fit;
    this.state.panX = (vp.clientWidth - wPx * fit) / 2;
    this.state.panY = (vp.clientHeight - hPx * fit) / 2;
    this.applyTransform();
  },

  _redrawSidePanel() {
    if (this._sidePanelRenderer) this._sidePanelRenderer();
  },

  // Chest pins for the single-area Field Map view. The export contains
  // NO chest coordinates (verified when chests were first joined to
  // areas), so these pins are explicitly APPROXIMATE: every chest in
  // the area is fanned out in a ring around the area's own gate marker
  // (the join key that attached it here in the first place), or the
  // area's center when the gate has no coordinate. Each pin is
  // clickable -> highlights that chest's resolved contents in the side
  // panel. Honest-labeling rule applies: the tooltip and side panel
  // both say the position is approximate, and the ring placement is
  // visually distinct from real coordinate pins (dashed halo).
  drawChestMarkers(stage, area, bounds, tpp) {
    stage.querySelectorAll(".map-chest-marker").forEach((m) => m.remove());
    if (!this.state.layers.treasureChest) return;
    const chests = Array.isArray(area.chests)
      ? area.chests
      : (area.chestIds || []).map((cid) => ({ chestId: cid, contents: null }));
    if (!chests.length) return;

    const anchorMarker = (area.markers || []).find((m) => m.id === area.gateId)
      || (area.markers || [])[0];
    const ax = anchorMarker ? (anchorMarker.x - bounds.minX) / tpp : (bounds.maxX - bounds.minX) / (2 * tpp);
    const ay = anchorMarker ? (anchorMarker.y - bounds.minY) / tpp : (bounds.maxY - bounds.minY) / (2 * tpp);

    const st = this.iconVisual("treasureChest");
    // Split real-coordinate chests (placed-actor exports -- solid pin
    // at the true world position) from coordinate-less ones (dashed
    // APPROXIMATE ring near the gate). Mixed areas render both.
    const placed = chests.filter((c) => c.coordinates && c.coordinates.x != null);
    const approx = chests.filter((c) => !(c.coordinates && c.coordinates.x != null));
    placed.forEach((chest) => {
      const x = (chest.coordinates.x - bounds.minX) / tpp;
      const y = (chest.coordinates.y - bounds.minY) / tpp;
      const selected = this.state.selectedChestId === chest.chestId;
      const el = document.createElement("div");
      el.className = "map-chest-marker";
      const scale = 1 / Math.max(this.state.zoom, 0.4);
      el.style.cssText = `position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-50%) scale(${scale}); cursor:pointer; z-index:6;`
        + `border:1px solid rgba(255,213,74,${selected ? "1" : "0.7"}); border-radius:50%; padding:3px; background:rgba(0,0,0,0.35);`
        + (selected ? "filter:drop-shadow(0 0 7px #FFD54A);" : "");
      el.innerHTML = st.icon
        ? `<img src="${st.icon}" alt="Treasure Chest" style="width:22px; height:22px; object-fit:contain;"/>`
        : `<span style="color:#FFD54A; font-size:14px; text-shadow:0 0 6px rgba(0,0,0,0.9);">▣</span>`;
      el.title = `${chest.chestId} — exact placed-actor position (${chest.coordinates.sourceFile || "level export"}). Click for contents.`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.state.selectedChestId = selected ? null : chest.chestId;
        this._redrawSidePanel();
        this.drawChestMarkers(stage, area, bounds, tpp);
      });
      stage.appendChild(el);
    });

    approx.forEach((chest, i) => {
      // Ring layout: 10 pins per ring, radius stepping outward so
      // chest-heavy areas stay readable instead of stacking.
      const perRing = 10;
      const ring = Math.floor(i / perRing);
      const idxInRing = i % perRing;
      const countInRing = Math.min(perRing, approx.length - ring * perRing);
      const angle = (idxInRing / countInRing) * Math.PI * 2 - Math.PI / 2 + ring * 0.3;
      const radius = 52 + ring * 26;
      const x = ax + radius * Math.cos(angle);
      const y = ay + radius * Math.sin(angle);
      const selected = this.state.selectedChestId === chest.chestId;

      const el = document.createElement("div");
      el.className = "map-chest-marker";
      const scale = 1 / Math.max(this.state.zoom, 0.4);
      el.style.cssText = `position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-50%) scale(${scale}); cursor:pointer; z-index:5;`
        + `border:1px dashed rgba(255,213,74,${selected ? "0.95" : "0.45"}); border-radius:50%; padding:3px;`
        + (selected ? "filter:drop-shadow(0 0 7px #FFD54A);" : "");
      el.innerHTML = st.icon
        ? `<img src="${st.icon}" alt="Treasure Chest" style="width:22px; height:22px; object-fit:contain;"/>`
        : `<span style="color:#FFD54A; font-size:14px; text-shadow:0 0 6px rgba(0,0,0,0.9);">▣</span>`;
      el.title = `${chest.chestId} — position approximate (no chest coordinates exist in the export; pinned near the area gate). Click for contents.`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.state.selectedChestId = selected ? null : chest.chestId;
        this._redrawSidePanel();
        this.drawChestMarkers(stage, area, bounds, tpp);
      });
      stage.appendChild(el);
    });
  },

  markerDetailHtml(sel) {
    const gate = (DataStore.getAllGatesFlat ? DataStore.getAllGatesFlat() : []).find((g) => g.id === sel.id);
    const st = this.markerVisual(sel.kind);
    return `
      <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:4px;">${escapeHtml(st.label)}</div>
      <div style="font-size:14px; color:var(--hud-text);">${escapeHtml(gate ? DataStore.getGateDisplayName(gate) : sel.id)}</div>
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim); margin-bottom:6px;">${escapeHtml(sel.id)} · world (${Math.round(sel.x)}, ${Math.round(sel.y)})</div>
      <div style="font-size:11px; color:var(--hud-text-dim);">Coordinates from DA_InGame's terminal registry — see World › Gates for the full entry.</div>
      <hr class="guide-hr" style="margin:10px 0;"/>
    `;
  },

  // ---------- Field Map: single-area interactive view ----------
  async renderAreaView(container) {
    const area = (this.state.data.areas || []).find((a) => a.gateId === this.state.areaGateId);
    if (!area || !area.bounds) { this.state.fieldSub = "overview"; return this.renderOverview(container); }
    if (this._lastChestArea !== area.gateId) { this.state.selectedChestId = null; this._lastChestArea = area.gateId; }
    this.ensureLayers("field");
    const tpp = area.texturePerPixel;
    const gate = (DataStore.getAllGatesFlat ? DataStore.getAllGatesFlat() : []).find((g) => g.id === area.gateId);
    const { wrap, wPx, hPx } = this.renderPieceStageCommon({
      bounds: area.bounds, tpp,
      title: gate ? DataStore.getGateDisplayName(gate) : area.gateId,
      subtitle: `${area.gateId} · ${area.pieces.length} map pieces · 80 world units / pixel`,
      backLabel: "Overview",
      backFn: () => { this.state.fieldSub = "overview"; this.render(this.container); },
      seamRisk: area.seamRisk,
    });
    container.appendChild(wrap);
    await this.loadManualMarkers("field", area.gateId);
    const stage = document.getElementById("mapStage");
    const redraw = () => {
      this.drawMarkers(stage, area.markers, area.bounds, tpp);
      this.drawChestMarkers(stage, area, area.bounds, tpp);
      this.drawManualMarkers(stage, "field", area.gateId, wPx, hPx, onMarkerChange);
      this.updateMarkerPreview(stage, wPx, hPx);
    };
    // onChange after add/delete must refresh BOTH the map pins AND the
    // Add-Marker panel's own count/delete-list -- fixes a real bug
    // where the delete list never updated after adding a marker.
    const onMarkerChange = () => { redraw(); this.renderExistingMarkerList("field", area.gateId, markerOpts); };
    const markerOpts = { onChange: onMarkerChange, updatePreview: () => this.updateMarkerPreview(stage, wPx, hPx) };
    this.drawPieces(stage, area.pieces, area.bounds, tpp, area.seamRisk);
    redraw();
    this.setupLegend("field", { areaKey: area.gateId, markers: area.markers, chestCount: area.chestIds.length, onLegendChange: redraw });
    this.renderAddMarkerPanel("field", area.gateId, markerOpts);
    this._sidePanelRenderer = () => this.renderAreaSidePanel(area);
    this._sidePanelRenderer();
    this.bindPanZoom(area.bounds, tpp, wPx, hPx, redraw);
    this.bindMapClickForCoords("field", area.gateId, wPx, hPx, true, area.bounds, tpp);
    this.fitToViewport(wPx, hPx);
  },

  renderAreaSidePanel(area) {
    const el = document.getElementById("mapSidePanel");
    const sel = area.markers.find((m) => m.id === this.state.selectedMarkerId);
    let html = "";
    if (sel) html += this.markerDetailHtml(sel);
    // Backward-compatible: area.chests (chestId + resolved contents)
    // is the current shape, but falls back to the older area.chestIds
    // (bare id strings, no contents) if this instance's WorldMap.json
    // predates that field -- a real regression found and fixed here:
    // the section used to check area.chestIds.length, so it always
    // showed SOMETHING even on stale data; switching to area.chests
    // with no fallback made the whole section silently vanish on any
    // build that hadn't re-run world_map yet, which read as "the
    // chest list disappeared" rather than "needs a rebuild".
    const hasRichChests = Array.isArray(area.chests);
    const chestCount = hasRichChests ? area.chests.length : (area.chestIds || []).length;
    if (this.state.layers.treasureChest && chestCount) {
      // Selected-on-map chest floats to the top with a highlight so a
      // pin click always lands the eye on the right contents.
      const orderedChests = hasRichChests
        ? [...area.chests].sort((a, b) =>
            (b.chestId === this.state.selectedChestId) - (a.chestId === this.state.selectedChestId))
        : null;
      html += `
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:#FFD54A; margin-bottom:4px;">Treasure Chests here (${chestCount})</div>
        <div style="font-size:10.5px; color:var(--hud-text-dim); margin-bottom:6px;">Pinned on the map in a dashed ring near the area gate — positions are APPROXIMATE (no chest coordinates exist in the export; the location join is the only placement data there is). Click a pin to highlight its contents. Full item stats in Items › Chests.</div>
        ${!hasRichChests ? `<div style="font-size:10px; color:var(--hud-sp); margin-bottom:6px;">Contents unavailable — this instance's World Map data predates chest-contents support. Re-run the World focus build to see items here.</div>` : ""}
        <div style="max-height:280px; overflow-y:auto;">
          ${hasRichChests
            ? orderedChests.map((c) => this.renderChestContentsHtml(c, c.chestId === this.state.selectedChestId)).join("")
            : area.chestIds.map((cid) => `<div style="font-family:var(--font-mono); font-size:11px; line-height:1.8; color:var(--hud-text);">▣ ${escapeHtml(cid)}</div>`).join("")}
        </div>
      `;
    }
    el.innerHTML = html || '<div style="font-size:12px; color:var(--hud-text-dim);">Click a marker for details.</div>';
  },

  // Shows each chest's actual RESOLVED contents (item icon + name +
  // weight-derived share), not just the bare chest ID -- the ID alone
  // required a trip to Items > Chests to find out what's actually
  // inside, which defeated the point of surfacing chests on the map
  // in the first place.
  renderChestContentsHtml(chest, highlighted = false) {
    const contents = chest.contents || [];
    return `
      <div style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid rgba(135,200,210,0.1);${highlighted ? " background:rgba(255,213,74,0.07); border:1px dashed rgba(255,213,74,0.55); border-radius:4px; padding:6px;" : ""}">
        <div style="font-family:var(--font-mono); font-size:10.5px; color:${highlighted ? "#FFD54A" : "var(--db-cyan-bright)"}; margin-bottom:3px;">▣ ${escapeHtml(chest.chestId)}${highlighted ? " · selected on map" : ""}</div>
        ${contents.length ? contents.map((slot) => {
          const name = DataStore.getChestItemName ? DataStore.getChestItemName(slot.itemKey) : slot.itemKey;
          const icon = DataStore.getItemIconPath ? DataStore.getItemIconPath(slot.itemKey) : null;
          return `
            <div style="display:flex; align-items:center; gap:6px; padding:1px 0 1px 10px; font-size:11px; color:var(--hud-text);">
              ${icon ? `<img src="${icon}" alt="" style="width:16px; height:16px; object-fit:contain; flex-shrink:0;"/>` : '<span style="width:16px; flex-shrink:0;"></span>'}
              <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}${slot.num > 1 ? ` ×${slot.num}` : ""}</span>
              ${slot.sharePct != null ? `<span style="font-size:9.5px; color:var(--hud-text-dim); flex-shrink:0;">${slot.sharePct}%</span>` : ""}
            </div>
          `;
        }).join("") : '<div style="font-size:10.5px; color:var(--hud-text-dim); padding-left:10px;">No resolved contents.</div>'}
      </div>
    `;
  },

  // ---------- World View: all textured areas composited on one canvas ----------
  async renderWorldView(container) {
    const composites = this.state.data.worldComposites || {};
    const codes = Object.keys(composites);
    if (!codes.length) {
      container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No world composite available yet — needs at least one area with exported map textures.</p></div></div>`;
      return;
    }
    this.ensureLayers("world");
    if (!this.state.worldCode || !composites[this.state.worldCode]) this.state.worldCode = codes[0];
    const wc = composites[this.state.worldCode];
    const { wrap, wPx, hPx } = this.renderPieceStageCommon({
      bounds: wc.bounds, tpp: wc.texturePerPixel,
      title: `World View — ${wc.world}`,
      subtitle: `${wc.areaCount} areas · ${wc.pieces.length} pieces plotted at real world coordinates, one shared canvas`,
      backFn: null,
      seamRisk: "none",
    });
    if (codes.length > 1) {
      const selectorHtml = `<select id="worldViewSelect" class="filter-select" style="margin-left:8px;">${codes.map((c) => `<option value="${c}" ${c === this.state.worldCode ? "selected" : ""}>${c}</option>`).join("")}</select>`;
      wrap.querySelector(".toolbar").insertAdjacentHTML("beforeend", selectorHtml);
    }
    container.appendChild(wrap);
    if (codes.length > 1) {
      document.getElementById("worldViewSelect").addEventListener("change", (e) => {
        this.state.worldCode = e.target.value;
        this.renderModeBody();
      });
    }
    await this.loadManualMarkers("world", wc.world);
    const stage = document.getElementById("mapStage");
    const redraw = () => {
      this.drawMarkers(stage, wc.markers, wc.bounds, wc.texturePerPixel);
      this.drawManualMarkers(stage, "world", wc.world, wPx, hPx, onMarkerChange);
      this.updateMarkerPreview(stage, wPx, hPx);
    };
    const onMarkerChange = () => { redraw(); this.renderExistingMarkerList("world", wc.world, markerOpts); };
    const markerOpts = { onChange: onMarkerChange, updatePreview: () => this.updateMarkerPreview(stage, wPx, hPx) };
    this.drawPieces(stage, wc.pieces, wc.bounds, wc.texturePerPixel, "low");
    redraw();
    this.setupLegend("world", { areaKey: wc.world, markers: wc.markers, chestCount: 0, onLegendChange: redraw });
    this.renderAddMarkerPanel("world", wc.world, markerOpts);
    this._sidePanelRenderer = () => {
      const el = document.getElementById("mapSidePanel");
      const sel = wc.markers.find((m) => m.id === this.state.selectedMarkerId);
      el.innerHTML = sel ? this.markerDetailHtml(sel) : `
        <div style="font-size:12px; color:var(--hud-text-dim);">
          All ${wc.areaCount} exported areas of ${wc.world}, plotted on one canvas using their real,
          absolute world coordinates — no new data, just wider bounds than any single area's own.
          Click a marker for details.
        </div>`;
    };
    this._sidePanelRenderer();
    this.bindPanZoom(wc.bounds, wc.texturePerPixel, wPx, hPx, redraw);
    this.bindMapClickForCoords("world", wc.world, wPx, hPx, true, wc.bounds, wc.texturePerPixel);
    this.fitToViewport(wPx, hPx);
  },

  // ---------- Shared: an interactive image-overlay stage for Towns/Dungeons
  // (plain images, no pan/zoom needed -- just normalized-coordinate
  // markers directly over the <img>, since these have no world-space
  // piece math to speak of). ----------
  renderImageMarkerStage(imageUrl, mapType, areaKey, altText) {
    return `
      <div class="equip-layout side-right" style="--side-col: 300px;">
        <div class="hud-panel" style="padding:8px; text-align:center;">
          <div id="imgMarkerStage" style="position:relative; display:inline-block; max-width:100%; cursor:crosshair;">
            <img id="imgMarkerImg" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}" style="max-width:100%; display:block; border:1px solid var(--hud-border); border-radius:8px;"/>
          </div>
          <div style="font-size:10.5px; color:var(--hud-text-dim); margin-top:6px;">Click the image to set marker X/Y, then use the form to add it.</div>
        </div>
        <div>
          <div class="hud-panel" style="padding:12px 14px;">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">Legend — click to toggle</div>
            <div id="mapLegend"></div>
          </div>
          <div class="hud-panel" style="padding:12px 14px; margin-top:12px;" id="mapAddMarkerPanel"></div>
        </div>
      </div>
    `;
  },

  drawTownGimmicks(town, variant) {
    const stageEl = document.getElementById("imgMarkerStage");
    const imgEl = document.getElementById("imgMarkerImg");
    if (!stageEl || !imgEl) return;
    const markers = (town.markers || []).filter((m) => m.normalized && m.normalized[variant]);
    if (!markers.length) return;

    const draw = () => {
      stageEl.querySelectorAll(".map-gimmick-marker").forEach((m) => m.remove());
      const w = imgEl.clientWidth, h = imgEl.clientHeight;
      if (!w || !h) return;
      for (const m of markers) {
        const v = this.gimmickVisual(m.kind);
        if (v.layerKey && this.state.layers[v.layerKey] === false) continue;
        const n = m.normalized[variant];
        const el = document.createElement("div");
        el.className = "map-gimmick-marker";
        el.style.cssText = `position:absolute; left:${n.x * w}px; top:${n.y * h}px; transform:translate(-50%,-100%); z-index:6; pointer-events:auto;`;
        el.innerHTML = v.icon
          ? `<img src="${v.icon}" alt="${escapeHtml(v.label)}" style="width:24px; height:24px; object-fit:contain;"/>`
          : `<span style="color:#FFD54A; font-size:17px; text-shadow:0 0 6px rgba(0,0,0,0.9);">${v.fallback}</span>`;
        el.title = `${v.label} — ${m.id}${m.chunk ? ` (${m.chunk})` : ""} · captured at runtime`;
        stageEl.appendChild(el);
      }
    };
    if (imgEl.complete && imgEl.clientWidth) draw();
    else imgEl.addEventListener("load", draw, { once: true });
    // The image is responsive, so pin positions must follow it.
    if (!this._townResizeBound) {
      window.addEventListener("resize", () => {
        const t = this.state.currentTown;
        if (t) this.drawTownGimmicks(t.town, t.variant);
      });
      this._townResizeBound = true;
    }
    this.state.currentTown = { town, variant };
  },

  async setupImageMarkerStage(mapType, areaKey) {
    this.ensureLayers(mapType);
    await this.loadManualMarkers(mapType, areaKey);
    const stageEl = document.getElementById("imgMarkerStage");
    const imgEl = document.getElementById("imgMarkerImg");

    const redraw = () => {
      stageEl.querySelectorAll(".map-manual-marker").forEach((m) => m.remove());
      const manual = this.getManualMarkers(mapType, areaKey);
      const w = imgEl.clientWidth, h = imgEl.clientHeight;
      for (const entry of manual.entries) {
        if (!this.state.layers[entry.iconKey]) continue;
        const st = this.iconVisual(entry.iconKey);
        const el = document.createElement("div");
        el.className = "map-manual-marker";
        el.style.cssText = `position:absolute; left:${entry.x * w}px; top:${entry.y * h}px; transform:translate(-50%,-100%); cursor:pointer; z-index:6;`;
        el.innerHTML = st.icon
          ? `<img src="${st.icon}" alt="${escapeHtml(st.label)}" style="width:26px; height:26px; object-fit:contain;"/>`
          : `<span style="color:#FFD54A; font-size:18px; text-shadow:0 0 6px rgba(0,0,0,0.9);">${st.fallback}</span>`;
        el.title = `${st.label}${entry.label ? ": " + entry.label : ""} (click to remove)`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (confirm(`Remove this "${st.label}" marker${entry.label ? ` (${entry.label})` : ""}?`)) {
            this.deleteManualMarker(mapType, areaKey, entry.id, onMarkerChange);
          }
        });
        stageEl.appendChild(el);
      }
    };

    const updatePreview = () => this.updateMarkerPreview(stageEl, imgEl.clientWidth, imgEl.clientHeight);
    const onMarkerChange = () => { redraw(); updatePreview(); this.renderExistingMarkerList(mapType, areaKey, markerOpts); };
    const markerOpts = { onChange: onMarkerChange, updatePreview };

    const onImgReady = () => {
      redraw();
      this.setupLegend(mapType, { areaKey, markers: [], chestCount: 0, onLegendChange: redraw });
      this.renderAddMarkerPanel(mapType, areaKey, markerOpts);
      stageEl.addEventListener("click", (ev) => {
        if (ev.target.closest(".map-manual-marker")) return;
        const rect = imgEl.getBoundingClientRect();
        const nx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const ny = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
        this.state.addForm.x = nx.toFixed(3);
        this.state.addForm.y = ny.toFixed(3);
        const xInput = document.getElementById("markerXInput");
        const yInput = document.getElementById("markerYInput");
        if (xInput) xInput.value = this.state.addForm.x;
        if (yInput) yInput.value = this.state.addForm.y;
        updatePreview();
      });
    };
    if (imgEl.complete) onImgReady(); else imgEl.addEventListener("load", onImgReady);
  },

  // ---------- Towns: single reference image + manual marker overlay ----------
  renderTownsView(container) {
    const towns = this.state.staticMaps.towns || [];
    if (!this.state.townCode && towns.length) this.state.townCode = towns[0].townCode;
    const town = towns.find((t) => t.townCode === this.state.townCode);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${towns.length}</b> town(s) with an exported map image</span>
        <span style="margin-left:auto; opacity:0.6;" title="No coordinate data anywhere in this export is confirmed to be scaled to a town map image's own local space — markers here are entirely manual, added via the form to the right.">manual markers only</span>
      </div>
      <div class="toolbar" id="townSelectToolbar"></div>
      <div id="townBody"></div>
    `;
    container.appendChild(wrap);
    const toolbar = document.getElementById("townSelectToolbar");
    toolbar.innerHTML = towns.map((t) =>
      `<button class="toggle-btn${t.townCode === this.state.townCode ? " active" : ""}" data-town="${escapeHtml(t.townCode)}">${escapeHtml(t.townCode)}</button>`
    ).join("");
    toolbar.querySelectorAll("[data-town]").forEach((btn) => {
      btn.addEventListener("click", () => { this.state.townCode = btn.dataset.town; this.renderModeBody(); });
    });
    const body = document.getElementById("townBody");
    if (!town) {
      body.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No town maps exported yet.</p></div></div>`;
      return;
    }
    const mainImage = town.images.find((im) => im.variant === "full") || town.images[0];
    body.innerHTML = this.renderImageMarkerStage(mainImage.image, "town", town.townCode, `${town.townCode} map`);
    this.setupImageMarkerStage("town", town.townCode);
    // Runtime-captured town gimmicks (town chests, lore tips, the
    // Smithy/Item Seller, quest terminals). Town_XXX.json's MiniMapInfo
    // gives a real world->texture transform, so the pipeline converts each
    // to a normalized position for THIS image variant -- they're drawn on
    // the same image stage the manual markers use.
    this.drawTownGimmicks(town, mainImage.variant || "full");
  },

  // ---------- Dungeons: single reference image per floor + manual marker overlay ----------
  renderDungeonsView(container) {
    const floors = this.state.staticMaps.dungeonFloors || [];
    // Post-release: per-family minimap BUILDING BLOCKS (Widget/
    // Dungeonmap/{FAMILY}/T_Minimap_*) -- the tiles the game assembles
    // procedurally at runtime. No assembled layout exists in the
    // export (confirmed), so families render as a tile catalog, never
    // a stitched fake floor plan.
    const modFamilies = this.state.staticMaps.dungeonMinimapModules || [];
    if (!this.state.dungeonSuffix && floors.length) this.state.dungeonSuffix = floors[0].suffix;
    const floor = floors.find((f) => f.suffix === this.state.dungeonSuffix);
    const family = modFamilies.find((f) => `fam:${f.family}` === this.state.dungeonSuffix);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${floors.length}</b> dungeon floor image(s) exported</span>
        ${modFamilies.length ? `<span><b>${modFamilies.length}</b> minimap module families (<b>${modFamilies.reduce((n, f) => n + f.tileCount, 0)}</b> tiles)</span>` : ""}
        <span style="margin-left:auto; opacity:0.6;" title="Floor suffixes (e.g. HTE1, NTR2) are NOT confirmed to map 1:1 onto a specific named dungeon in World > Dungeons — several dungeons share the same 3-letter prefix, so each floor is labeled honestly by its raw exported name rather than guessed. Markers here are entirely manual. Minimap modules are the game's procedural building blocks; no assembled layout exists in the export.">dungeon name attribution unconfirmed</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 220px;">
        <div id="dungeonListPane"></div>
        <div id="dungeonBody"></div>
      </div>
    `;
    container.appendChild(wrap);
    const listPane = document.getElementById("dungeonListPane");
    listPane.innerHTML = floors.map((f) => `
      <div class="weapon-list-row${f.suffix === this.state.dungeonSuffix ? " selected" : ""}" data-floor="${escapeHtml(f.suffix)}">
        <div style="flex:1; min-width:0;"><div class="wl-name">${escapeHtml(f.suffix)}</div><div class="wl-id">${escapeHtml(f.prefix)} · floor ${f.floorNumber}${f.isWayGraphic ? " · route graphic" : ""}</div></div>
      </div>
    `).join("") + (modFamilies.length ? `
      <div style="font-family:var(--font-display); font-size:10px; font-weight:600; color:var(--hud-text-dim); letter-spacing:0.08em; margin:10px 4px 4px;">MINIMAP MODULES</div>
    ` + modFamilies.map((f) => `
      <div class="weapon-list-row${`fam:${f.family}` === this.state.dungeonSuffix ? " selected" : ""}" data-floor="fam:${escapeHtml(f.family)}">
        <div style="flex:1; min-width:0;"><div class="wl-name">${escapeHtml(f.family)}</div><div class="wl-id">${f.tileCount} tiles · procedural building blocks</div></div>
      </div>
    `).join("") : "");
    listPane.querySelectorAll("[data-floor]").forEach((row) => {
      row.addEventListener("click", () => { this.state.dungeonSuffix = row.dataset.floor; this.renderModeBody(); });
    });
    const body = document.getElementById("dungeonBody");
    if (family) {
      const groups = { background: [], chamber: [], module: [], other: [] };
      family.tiles.forEach((t) => (groups[t.kind] || groups.other).push(t));
      const section = (label, tiles, big) => tiles.length ? `
        <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--db-cyan-bright); margin:12px 0 6px;">${label} (${tiles.length})</div>
        <div style="display:flex; flex-wrap:wrap; gap:10px;">
          ${tiles.map((t) => `
            <a href="${t.image}" target="_blank" title="${escapeHtml(t.file)}" style="text-decoration:none; text-align:center;">
              <img src="${t.image}" alt="${escapeHtml(t.file)}" loading="lazy"
                   style="width:${big ? 220 : 96}px; height:${big ? 220 : 96}px; object-fit:contain; background:rgba(64,207,216,0.05); border:1px solid rgba(64,207,216,0.18); border-radius:4px; image-rendering:pixelated;"/>
              <div style="font-family:var(--font-mono); font-size:8.5px; color:var(--hud-text-dim); max-width:${big ? 220 : 96}px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(t.file.replace(/^T_Minimap_/, "").replace(/\.png$/, ""))}</div>
            </a>`).join("")}
        </div>` : "";
      body.innerHTML = `
        <div class="hud-panel" style="padding:14px;">
          <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--hud-text);">${escapeHtml(family.family)} minimap modules</div>
          <div style="font-size:11px; color:var(--hud-text-dim); margin:4px 0 2px;">The game's own building blocks for this dungeon family's procedurally-assembled minimap — background, chamber tiles (boss/mid-boss rooms), and corridor/junction modules. No assembled layout exists in the export, so no floor plan is faked here.</div>
          ${section("Background", groups.background, true)}
          ${section("Chambers", groups.chamber, false)}
          ${section("Corridor / junction modules", groups.module, false)}
          ${section("Other tiles", groups.other, false)}
        </div>`;
      return;
    }
    if (!floor) {
      body.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No dungeon floor maps exported yet.</p></div></div>`;
      return;
    }
    body.innerHTML = this.renderImageMarkerStage(floor.image, "dungeon", floor.suffix, floor.suffix);
    this.setupImageMarkerStage("dungeon", floor.suffix);
  },
};
