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
// CRITICAL BUG FOUND AND FIXED: MapPieceDataDetails' array order does
// NOT match alphabetical piece-letter order (one area's array is
// [c, a, b], not [a, b, c]; ALL 7 currently-textured areas had
// non-alphabetical order). The pipeline used to construct each
// piece's filename from its ARRAY INDEX, silently pairing every
// position with the WRONG texture. Fixed in build_pipeline.py to read
// the real filename from each entry's own PieceTexture field.
//
// ICONS: the game's own map icon sprites (Widget/3DMapCapture/MapIcon/
// IconImages) are unrecolored red/green MASK layers, not final art --
// verified by direct pixel sampling. build_pipeline.py's
// build_map_icons() recolors them (green -> soft drop shadow, red ->
// flat fill) into Content/ROD/DataAssets/_MapIcons/*.png using
// explicit user-confirmed colors where given, and WHITE (stated as
// unconfirmed, not guessed) otherwise. This view only ever renders
// those pre-recolored PNGs.
//
// FOUR modes, switched by the top tab bar:
//   - Field Map: the original per-area interactive composite (pan/
//     zoom, click-to-toggle legend, real markers, mask blending).
//   - World View: ALL textured areas' pieces plotted on ONE shared
//     canvas at the same real-world scale -- possible with zero new
//     data, since every piece already carries absolute world
//     coordinates; answers "chunks lined up together like the big
//     map" without needing anything Field Map's per-area view
//     doesn't already have.
//   - Towns / Dungeons: single pre-composited reference images (no
//     per-piece math needed) with an explicit, unhidden limitation:
//     no coordinate data exists anywhere in this export scaled to
//     THESE image spaces, so they browse as reference images, not
//     interactive marker maps.
//
// Waypoints (the user's requested "drag a pin from the legend"
// interaction): dragging the Waypoints legend icon onto the map drops
// a pin at that point. This is IN-MEMORY, per-session scratch data --
// no backend exists to persist user-placed pins, and that's stated in
// the UI rather than silently losing them on refresh without saying so.
// ============================================================

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
    layers: {
      safeArea: true, warpTerminal: true, treasureChest: true, waypoint: true,
      ark: true, seal: true, magicalSeal: true, sideQuestTrinket: true,
      boss: false, monsterSpawn: false, material: false, missionObjective: false,
    },
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedMarkerId: null,
    waypoints: {},      // { "field:<gateId>" | "world:<code>": [{id,x,y}] }
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
          this.state.staticMaps = { towns: [], dungeonFloors: [] };
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
    if (this.state.mode === "world") return this.renderWorldView(body);
    if (this.state.mode === "towns") return this.renderTownsView(body);
    if (this.state.mode === "dungeons") return this.renderDungeonsView(body);
    if (this.state.fieldSub === "area" && this.state.areaGateId) return this.renderAreaView(body);
    return this.renderOverview(body);
  },

  // ---------- Field Map: overview ----------
  renderOverview(container) {
    const floor = this.state.data.floor;
    const areas = this.state.data.areas || [];
    const withTex = areas.filter((a) => a.hasTextures);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${areas.length}</b> areas in the map-piece registry</span>
        <span><b>${withTex.length}</b> with exported map textures</span>
        <span><b>${(this.state.data.floor && this.state.data.floor.overlays.length) || 0}</b> floor overlays (game's own layout)</span>
        <span style="margin-left:auto; opacity:0.6;" title="Only some area families have their map textures exported so far — more appear here automatically as exports land, same as the asset sidecars.">textures appear as exported</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 300px;">
        <div id="mapAreaListPane" style="max-height:70vh; overflow-y:auto;"></div>
        <div class="hud-panel" style="padding:14px; text-align:center;">
          <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">1st Floor — WL01 Overview</div>
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

    const stage = document.getElementById("mapFloorStage");
    if (floor) {
      const scale = 0.62;
      const sz = floor.size * scale;
      stage.style.width = `${sz}px`;
      stage.style.height = `${sz}px`;
      stage.innerHTML = `<img src="${escapeHtml(floor.image)}" alt="Floor map" style="width:100%; height:100%; display:block; border:1px solid var(--hud-border); border-radius:8px;"/>`;
      for (const ov of floor.overlays) {
        const left = (floor.size / 2 + ov.left) * scale;
        const top = (floor.size / 2 + ov.top) * scale;
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

  waypointKey() {
    return this.state.mode === "world" ? `world:${this.state.worldCode}` : `field:${this.state.areaGateId}`;
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
        <span style="margin-left:auto; font-size:11px; color:var(--hud-text-dim);">drag to pan · wheel to zoom · drag a legend icon onto the map to drop a pin</span>
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
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">Legend — click to toggle, drag Waypoints to pin</div>
            <div id="mapLegend"></div>
            <div style="font-size:10.5px; color:var(--hud-text-dim); margin-top:10px; line-height:1.6;">
              Disabled layers have no coordinates anywhere in the export — they'd join this map
              automatically if positional data ever lands. Waypoint pins are session-only (no
              backend to save them) and clear on refresh.
            </div>
          </div>
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

  markerVisual(kind) {
    const icons = this.icons();
    if (kind === "WT") return { icon: icons.warpTerminal, fallback: "◆", color: "#fff", label: "Warp Terminal" };
    if (kind === "SA") return { icon: icons.safeArea, fallback: "▲", color: "#fff", label: "Safe Area" };
    return { icon: null, fallback: "●", color: "var(--hud-text-dim)", label: "Marker" };
  },

  drawMarkers(stage, markers, bounds, tpp) {
    stage.querySelectorAll(".map-marker").forEach((m) => m.remove());
    for (const m of markers) {
      if (!this.state.layers[m.kind === "SA" ? "safeArea" : m.kind === "WT" ? "warpTerminal" : m.kind]) continue;
      const x = (m.x - bounds.minX) / tpp;
      const y = (m.y - bounds.minY) / tpp;
      const st = this.markerVisual(m.kind);
      const el = document.createElement("div");
      el.className = "map-marker";
      const scale = 1 / Math.max(this.state.zoom, 0.4);
      el.style.cssText = `position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-50%) scale(${scale}); cursor:pointer; z-index:5;`
        + (m.id === this.state.selectedMarkerId ? "filter:drop-shadow(0 0 6px #fff);" : "");
      el.innerHTML = st.icon
        ? `<img src="${st.icon}" alt="${escapeHtml(st.label)}" style="width:28px; height:28px;"/>`
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
    this.drawWaypointPins(stage, bounds, tpp);
  },

  drawWaypointPins(stage, bounds, tpp) {
    stage.querySelectorAll(".map-waypoint-pin").forEach((m) => m.remove());
    if (!this.state.layers.waypoint) return;
    const key = this.waypointKey();
    const pins = this.state.waypoints[key] || [];
    const icons = this.icons();
    for (const pin of pins) {
      const x = (pin.x - bounds.minX) / tpp;
      const y = (pin.y - bounds.minY) / tpp;
      const el = document.createElement("div");
      el.className = "map-waypoint-pin";
      const scale = 1 / Math.max(this.state.zoom, 0.4);
      el.style.cssText = `position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-100%) scale(${scale}); cursor:pointer; z-index:6;`;
      el.innerHTML = icons.waypoint
        ? `<img src="${icons.waypoint}" alt="Waypoint" style="width:26px; height:26px;"/>`
        : `<span style="color:#FFD54A; font-size:18px;">📍</span>`;
      el.title = "Waypoint pin (click to remove) — session-only, not saved";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.state.waypoints[key] = pins.filter((p) => p.id !== pin.id);
        el.remove();
      });
      stage.appendChild(el);
    }
  },

  legendRows(markers, chestCount) {
    const icons = this.icons();
    const count = (kind) => markers.filter((m) => m.kind === kind).length;
    return [
      { key: "safeArea", label: `Safe Areas (${count("SA")})`, icon: icons.safeArea, fallback: "▲", color: "#fff", enabled: true, draggable: false },
      { key: "warpTerminal", label: `Warp Terminals (${count("WT")})`, icon: icons.warpTerminal, fallback: "◆", color: "#fff", enabled: true, draggable: false },
      { key: "treasureChest", label: `Treasure Chests (${chestCount})`, icon: icons.treasureChest, fallback: "▣", color: "#FFD54A", enabled: true, draggable: false,
        note: "No chest coordinates exist in the export — listed per area (right), not pinned." },
      { key: "waypoint", label: "Waypoints (drag to pin)", icon: icons.waypoint, fallback: "📍", color: "#FFD54A", enabled: true, draggable: true,
        note: "Drag this icon onto the map to drop a pin. Session-only — not saved." },
      { key: "ark", label: "Arks", icon: icons.ark, fallback: "◆", color: "#B47CE5", enabled: false,
        note: "No Ark coordinates in the export." },
      { key: "seal", label: "Seals", icon: icons.seal, fallback: "◆", color: "#E5484D", enabled: false,
        note: "No Seal coordinates in the export." },
      { key: "magicalSeal", label: "Magical Seals", icon: icons.magicalSeal, fallback: "◆", color: "#FF7AC6", enabled: false,
        note: "No Magical Seal coordinates in the export." },
      { key: "sideQuestTrinket", label: "Side Quest Trinkets", icon: icons.sideQuestTrinket, fallback: "◆", color: "#FFD54A", enabled: false,
        note: "No Side Quest Trinket coordinates in the export." },
      { key: "boss", label: "Bosses", icon: icons.boss, fallback: "☠", color: "#fff", enabled: false,
        note: "No boss coordinates in the export — spawn locators live in unexported level actors." },
      { key: "monsterSpawn", label: "Monster Spawns", icon: icons.monsterSpawn, fallback: "✦", color: "#fff", enabled: false,
        note: "Socket tables carry spawn logic but no positions (checked DT_SocketPopTable directly)." },
      { key: "material", label: "Materials", icon: icons.material, fallback: "✿", color: "#fff", enabled: false,
        note: "Gathering tables (DT_NatureItemGroupDataTable) carry loot logic but no positions." },
      { key: "missionObjective", label: "Mission Objectives", icon: icons.missionObjective, fallback: "◈", color: "#fff", enabled: false,
        note: "Quest files carry map display params but no exported objective coordinates." },
    ];
  },

  legendIconHtml(iconUrl, fallback, color) {
    return iconUrl
      ? `<img src="${iconUrl}" alt="" style="width:18px; height:18px; object-fit:contain;"/>`
      : `<span style="color:${color}; font-size:15px;">${fallback}</span>`;
  },

  setupLegend(ctx) {
    const el = document.getElementById("mapLegend");
    const rows = this.legendRows(ctx.markers, ctx.chestCount);
    el.innerHTML = rows.map((r) => `
      <div class="map-legend-row${r.enabled ? "" : " disabled"}${r.enabled && this.state.layers[r.key] ? " on" : ""}"
           data-layer="${r.key}" ${r.draggable ? 'draggable="true"' : ""} ${r.note ? `title="${escapeHtml(r.note)}"` : ""}
           style="display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:5px; margin-bottom:2px;
                  ${r.enabled ? "cursor:pointer;" : "opacity:0.45; cursor:not-allowed;"}
                  ${r.enabled && this.state.layers[r.key] ? "background:rgba(64,207,216,0.1); border:1px solid rgba(64,207,216,0.25);" : "border:1px solid transparent;"}">
        <span style="width:18px; text-align:center; display:inline-flex; align-items:center; justify-content:center;">${this.legendIconHtml(r.icon, r.fallback, r.color)}</span>
        <span style="font-size:12px; color:var(--hud-text); flex:1;">${escapeHtml(r.label)}</span>
        ${r.enabled ? `<span style="font-size:10px; color:var(--hud-text-dim);">${this.state.layers[r.key] ? "shown" : "hidden"}</span>` : '<span style="font-size:10px; color:var(--hud-text-dim);">no coords</span>'}
      </div>
    `).join("");
    el.querySelectorAll(".map-legend-row:not(.disabled)").forEach((row) => {
      row.addEventListener("click", () => {
        const k = row.dataset.layer;
        this.state.layers[k] = !this.state.layers[k];
        this.setupLegend(ctx);
        this.drawMarkers(ctx.stage, ctx.markers, ctx.bounds, ctx.tpp);
        if (ctx.onLegendChange) ctx.onLegendChange();
      });
    });
    const waypointRow = el.querySelector('[data-layer="waypoint"]');
    if (waypointRow) {
      waypointRow.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", "waypoint");
      });
    }
    const vp = document.getElementById("mapViewport");
    if (vp) {
      vp.addEventListener("dragover", (ev) => ev.preventDefault());
      vp.addEventListener("drop", (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer.getData("text/plain") !== "waypoint") return;
        const stageEl = document.getElementById("mapStage");
        const rect = stageEl.getBoundingClientRect();
        const localX = (ev.clientX - rect.left) / this.state.zoom;
        const localY = (ev.clientY - rect.top) / this.state.zoom;
        const worldX = ctx.bounds.minX + localX * ctx.tpp;
        const worldY = ctx.bounds.minY + localY * ctx.tpp;
        const key = this.waypointKey();
        if (!this.state.waypoints[key]) this.state.waypoints[key] = [];
        this.state.waypoints[key].push({ id: `wp_${Date.now()}`, x: worldX, y: worldY });
        this.drawWaypointPins(ctx.stage, ctx.bounds, ctx.tpp);
      });
    }
  },

  bindPanZoom(bounds, tpp, wPx, hPx, onZoom) {
    const vp = document.getElementById("mapViewport");
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    vp.addEventListener("pointerdown", (e) => {
      dragging = true; sx = e.clientX; sy = e.clientY; ox = this.state.panX; oy = this.state.panY;
      vp.style.cursor = "grabbing"; vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.state.panX = ox + (e.clientX - sx);
      this.state.panY = oy + (e.clientY - sy);
      this.applyTransform();
    });
    vp.addEventListener("pointerup", (e) => { dragging = false; vp.style.cursor = "grab"; vp.releasePointerCapture(e.pointerId); });
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

  // ---------- Field Map: single-area interactive view ----------
  renderAreaView(container) {
    const area = (this.state.data.areas || []).find((a) => a.gateId === this.state.areaGateId);
    if (!area || !area.bounds) { this.state.fieldSub = "overview"; return this.renderOverview(container); }
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
    const stage = document.getElementById("mapStage");
    this.drawPieces(stage, area.pieces, area.bounds, tpp, area.seamRisk);
    this.drawMarkers(stage, area.markers, area.bounds, tpp);
    this.setupLegend({ stage, markers: area.markers, bounds: area.bounds, tpp, chestCount: area.chestIds.length });
    this._sidePanelRenderer = () => this.renderAreaSidePanel(area);
    this._sidePanelRenderer();
    this.bindPanZoom(area.bounds, tpp, wPx, hPx, () => this.drawMarkers(stage, area.markers, area.bounds, tpp));
    this.fitToViewport(wPx, hPx);
  },

  renderAreaSidePanel(area) {
    const el = document.getElementById("mapSidePanel");
    const sel = area.markers.find((m) => m.id === this.state.selectedMarkerId);
    let html = "";
    if (sel) html += this.markerDetailHtml(sel);
    if (this.state.layers.treasureChest && area.chestIds.length) {
      html += `
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:#FFD54A; margin-bottom:4px;">Treasure Chests here (${area.chestIds.length})</div>
        <div style="font-size:10.5px; color:var(--hud-text-dim); margin-bottom:6px;">Attached by the location join — no chest coordinates exist in the export, so these are a list, not pins. Contents in Items › Chests.</div>
        <div style="max-height:170px; overflow-y:auto;">
          ${area.chestIds.map((c) => `<div style="font-family:var(--font-mono); font-size:11px; line-height:1.8; color:var(--hud-text);">▣ ${escapeHtml(c)}</div>`).join("")}
        </div>
      `;
    }
    el.innerHTML = html || '<div style="font-size:12px; color:var(--hud-text-dim);">Click a marker for details.</div>';
  },

  markerDetailHtml(sel) {
    const gate = (DataStore.getAllGatesFlat ? DataStore.getAllGatesFlat() : []).find((g) => g.id === sel.id);
    const st = this.markerVisual(sel.kind);
    return `
      <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:${st.color === "#fff" ? "var(--hud-text)" : st.color}; margin-bottom:4px;">${escapeHtml(st.label)}</div>
      <div style="font-size:14px; color:var(--hud-text);">${escapeHtml(gate ? DataStore.getGateDisplayName(gate) : sel.id)}</div>
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim); margin-bottom:6px;">${escapeHtml(sel.id)} · world (${Math.round(sel.x)}, ${Math.round(sel.y)})</div>
      <div style="font-size:11px; color:var(--hud-text-dim);">Coordinates from DA_InGame's terminal registry — see World › Gates for the full entry.</div>
      <hr class="guide-hr" style="margin:10px 0;"/>
    `;
  },

  _redrawSidePanel() {
    if (this._sidePanelRenderer) this._sidePanelRenderer();
  },

  fitToViewport(wPx, hPx) {
    const vp = document.getElementById("mapViewport");
    const fit = Math.min(vp.clientWidth / wPx, vp.clientHeight / hPx);
    this.state.zoom = fit;
    this.state.panX = (vp.clientWidth - wPx * fit) / 2;
    this.state.panY = (vp.clientHeight - hPx * fit) / 2;
    this.applyTransform();
  },

  // ---------- World View: all textured areas composited on one canvas ----------
  renderWorldView(container) {
    const composites = this.state.data.worldComposites || {};
    const codes = Object.keys(composites);
    if (!codes.length) {
      container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No world composite available yet — needs at least one area with exported map textures.</p></div></div>`;
      return;
    }
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
    const stage = document.getElementById("mapStage");
    this.drawPieces(stage, wc.pieces, wc.bounds, wc.texturePerPixel, "low");
    this.drawMarkers(stage, wc.markers, wc.bounds, wc.texturePerPixel);
    this.setupLegend({ stage, markers: wc.markers, bounds: wc.bounds, tpp: wc.texturePerPixel, chestCount: 0 });
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
    this.bindPanZoom(wc.bounds, wc.texturePerPixel, wPx, hPx, () => this.drawMarkers(stage, wc.markers, wc.bounds, wc.texturePerPixel));
    this.fitToViewport(wPx, hPx);
  },

  // ---------- Towns: single reference images ----------
  renderTownsView(container) {
    const towns = this.state.staticMaps.towns || [];
    if (!this.state.townCode && towns.length) this.state.townCode = towns[0].townCode;
    const town = towns.find((t) => t.townCode === this.state.townCode);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${towns.length}</b> town(s) with an exported map image</span>
        <span style="margin-left:auto; opacity:0.6;" title="No coordinate data anywhere in this export is confirmed to be scaled to a town map image's own local space — these browse as reference images, not interactive marker maps.">reference image — no marker overlay</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 220px;">
        <div id="townListPane"></div>
        <div class="hud-panel" style="padding:14px; text-align:center;" id="townImagePane"></div>
      </div>
    `;
    container.appendChild(wrap);
    const listPane = document.getElementById("townListPane");
    listPane.innerHTML = towns.map((t) => `
      <div class="weapon-list-row${t.townCode === this.state.townCode ? " selected" : ""}" data-town="${escapeHtml(t.townCode)}">
        <div style="flex:1; min-width:0;"><div class="wl-name">${escapeHtml(t.townCode)}</div><div class="wl-id">${t.images.length} image(s)</div></div>
      </div>
    `).join("");
    listPane.querySelectorAll("[data-town]").forEach((row) => {
      row.addEventListener("click", () => { this.state.townCode = row.dataset.town; this.renderModeBody(); });
    });
    const imgPane = document.getElementById("townImagePane");
    if (town) {
      imgPane.innerHTML = `
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:10px;">${escapeHtml(town.townCode)}</div>
        ${town.images.map((im) => `
          <div style="margin-bottom:14px;">
            <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:4px;">${escapeHtml(im.variant)}</div>
            <img src="${escapeHtml(im.image)}" alt="${escapeHtml(town.townCode)} ${escapeHtml(im.variant)}" style="max-width:100%; border:1px solid var(--hud-border); border-radius:8px;"/>
          </div>
        `).join("")}
      `;
    } else {
      imgPane.innerHTML = `<div class="empty-state"><p>No town maps exported yet.</p></div>`;
    }
  },

  // ---------- Dungeons: single reference images per floor ----------
  renderDungeonsView(container) {
    const floors = this.state.staticMaps.dungeonFloors || [];
    if (!this.state.dungeonSuffix && floors.length) this.state.dungeonSuffix = floors[0].suffix;
    const floor = floors.find((f) => f.suffix === this.state.dungeonSuffix);
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${floors.length}</b> dungeon floor image(s) exported</span>
        <span style="margin-left:auto; opacity:0.6;" title="Floor suffixes (e.g. HTE1, NTR2) are NOT confirmed to map 1:1 onto a specific named dungeon in World > Dungeons — several dungeons share the same 3-letter prefix, so each floor is labeled honestly by its raw exported name rather than guessed.">dungeon name attribution unconfirmed</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 220px;">
        <div id="dungeonListPane"></div>
        <div class="hud-panel" style="padding:14px; text-align:center;" id="dungeonImagePane"></div>
      </div>
    `;
    container.appendChild(wrap);
    const listPane = document.getElementById("dungeonListPane");
    listPane.innerHTML = floors.map((f) => `
      <div class="weapon-list-row${f.suffix === this.state.dungeonSuffix ? " selected" : ""}" data-floor="${escapeHtml(f.suffix)}">
        <div style="flex:1; min-width:0;"><div class="wl-name">${escapeHtml(f.suffix)}</div><div class="wl-id">${escapeHtml(f.prefix)} · floor ${f.floorNumber}${f.isWayGraphic ? " · route graphic" : ""}</div></div>
      </div>
    `).join("");
    listPane.querySelectorAll("[data-floor]").forEach((row) => {
      row.addEventListener("click", () => { this.state.dungeonSuffix = row.dataset.floor; this.renderModeBody(); });
    });
    const imgPane = document.getElementById("dungeonImagePane");
    if (floor) {
      imgPane.innerHTML = `
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:10px;">${escapeHtml(floor.suffix)}</div>
        <img src="${escapeHtml(floor.image)}" alt="${escapeHtml(floor.suffix)}" style="max-width:100%; border:1px solid var(--hud-border); border-radius:8px; background:rgba(0,0,0,0.3);"/>
        <div style="font-size:11px; color:var(--hud-text-dim); margin-top:10px;">
          Prefix "${escapeHtml(floor.prefix)}" matches several dungeons in World › Dungeons that share
          this 3-letter code — which specific one this floor belongs to is not confirmed by any field
          in the export, so it's labeled by its raw exported name only.
        </div>
      `;
    } else {
      imgPane.innerHTML = `<div class="empty-state"><p>No dungeon floor maps exported yet.</p></div>`;
    }
  },
};
