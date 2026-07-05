// ============================================================
// skeleton-assets-browser.js
// Asset Inspector > Skeletons -- the CHR/ and ITM/ mesh catalog (494
// assets: 477 SK_ skeletal meshes + 17 SM_ static meshes), each
// grouped with its same-folder companions by the verified naming
// conventions: {stem}_Skeleton (bone skeleton), PHYS_{rest} OR
// {stem}_PhysicsAsset (both conventions are real in this export),
// {stem}_MorphData.
//
// DOWNLOADS: the JSONs are mesh METADATA and references, never
// geometry (UE doesn't export geometry to JSON). The sidecar binaries
// ARE the geometry -- psk / pskx / uemodel today, blend when uploaded
// (the extension is supported; files just don't exist yet) -- and
// every one gets a download button through the EXISTING
// /api/pipeline/download-file endpoint (raw-export paths, traversal-
// guarded; zero server changes were needed). Sidecars are detected on
// the mesh stem AND the _Skeleton companion stem -- 11 of the current
// export's 33 pskx files live on skeleton stems, found when the first
// catalog pass didn't match the census count.
//
// Data is lazy-loaded on first tab open (the 494-entry catalog does
// not belong in the startup fetch).
// ============================================================

const SkeletonAssetsBrowserView = {
  state: {
    loaded: false,
    entries: [],
    selectedPath: null,
    search: "",
    family: "all",
    kind: "all",
  },

  async render(container) {
    if (!this.state.loaded) {
      container.innerHTML = `<div class="hud-panel"><p style="color:var(--hud-text-dim);">Loading skeleton catalog…</p></div>`;
      try {
        this.state.entries = await fetchJSON(`${CONTENT_ROOT}/DataAssets/_AssetInspector/Skeletons.json`);
        this.state.loaded = true;
      } catch (e) {
        container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Couldn't load Skeletons.json — run the Inspectors focus build.</p></div></div>`;
        return;
      }
      container.innerHTML = "";
    }
    const idx = (DataStore.assetInspectorIndex && DataStore.assetInspectorIndex.skeletons) || {};
    const sc = idx.sidecarCounts || {};
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${this.state.entries.length}</b> mesh assets</span>
        <span><b>${this.state.entries.filter((e) => e.kind === "SkeletalMesh").length}</b> skeletal / <b>${this.state.entries.filter((e) => e.kind === "StaticMesh").length}</b> static</span>
        <span>downloads: <b>${sc.psk || 0}</b> psk · <b>${sc.pskx || 0}</b> pskx · <b>${sc.uemodel || 0}</b> uemodel · <b>${sc.blend || 0}</b> blend</span>
        <span style="margin-left:auto; opacity:0.6;" title="The JSONs are mesh metadata and references — UE doesn't export geometry to JSON. The sidecar binaries ARE the geometry.">JSON = metadata · sidecars = geometry</span>
      </div>
      <div class="toolbar" id="skelToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 380px;">
        <div id="skelListPane" class="list-pane-self-managed"></div>
        <div id="skelDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderToolbar();
    this.renderList();
    this.renderDetail();
  },

  families() {
    return [...new Set(this.state.entries.map((e) => e.family))].sort();
  },

  renderToolbar() {
    const el = document.getElementById("skelToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="skelSearch" placeholder="Search by asset name or folder…" value="${escapeHtml(this.state.search)}" />
      <select class="filter-select" id="skelFamily">
        <option value="all">All families (${this.families().length})</option>
        ${this.families().map((f) => `<option value="${escapeHtml(f)}" ${this.state.family === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
      </select>
      <select class="filter-select" id="skelKind">
        <option value="all">All kinds</option>
        <option value="SkeletalMesh" ${this.state.kind === "SkeletalMesh" ? "selected" : ""}>Skeletal meshes (SK_)</option>
        <option value="StaticMesh" ${this.state.kind === "StaticMesh" ? "selected" : ""}>Static meshes (SM_)</option>
      </select>
    `;
    document.getElementById("skelSearch").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderList();
    });
    document.getElementById("skelFamily").addEventListener("change", (e) => {
      this.state.family = e.target.value;
      this.renderList();
    });
    document.getElementById("skelKind").addEventListener("change", (e) => {
      this.state.kind = e.target.value;
      this.renderList();
    });
  },

  getFiltered() {
    let list = this.state.entries;
    if (this.state.family !== "all") list = list.filter((e) => e.family === this.state.family);
    if (this.state.kind !== "all") list = list.filter((e) => e.kind === this.state.kind);
    const q = this.state.search.trim().toLowerCase();
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q));
    return list;
  },

  renderList() {
    const pane = document.getElementById("skelListPane");
    const list = this.getFiltered();
    const el = document.createElement("div");
    el.className = "hud-panel";
    el.style.cssText = "max-height:calc(100vh - 320px); overflow-y:auto; padding:6px;";
    if (!list.length) {
      el.innerHTML = `<div class="empty-state" style="padding:24px 10px;"><div class="empty-icon">🦴</div><h4>No assets match</h4></div>`;
    }
    list.slice(0, 400).forEach((e) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (e.jsonPath === this.state.selectedPath ? " selected" : "");
      const dl = Object.keys(e.sidecars).length + Object.keys(e.skeletonSidecars || {}).length;
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(e.name)}</div>
          <div class="wl-id">${escapeHtml(e.family)}${e.kind === "StaticMesh" ? " · static" : ""}</div>
        </div>
        ${dl ? `<span class="pill verified" title="${dl} downloadable binary sidecar${dl === 1 ? "" : "s"}">⬇ ${dl}</span>` : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedPath = e.jsonPath;
        this.renderList();
        this.renderDetail();
      });
      el.appendChild(row);
    });
    if (list.length > 400) {
      const more = document.createElement("div");
      more.style.cssText = "font-size:11px; color:var(--hud-text-dim); padding:8px; text-align:center;";
      more.textContent = `Showing 400 of ${list.length} — narrow the search or family filter.`;
      el.appendChild(more);
    }
    pane.innerHTML = "";
    pane.appendChild(el);
    if (!this.state.selectedPath || !list.find((e) => e.jsonPath === this.state.selectedPath)) {
      this.state.selectedPath = list.length ? list[0].jsonPath : null;
      this.renderDetail();
    }
  },

  dlButton(relPath, label, kindNote) {
    return `<a class="toggle-btn" style="text-decoration:none; display:inline-block; margin:2px 4px 2px 0;"
      href="/api/pipeline/download-file?path=${encodeURIComponent(relPath)}" download
      title="${escapeHtml(kindNote || relPath)}">⬇ ${escapeHtml(label)}</a>`;
  },

  renderDetail() {
    const pane = document.getElementById("skelDetailPane");
    const e = this.state.entries.find((x) => x.jsonPath === this.state.selectedPath);
    if (!e) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an asset</p></div></div>`;
      return;
    }
    const sidecarBtns = Object.entries(e.sidecars)
      .map(([ext, p]) => this.dlButton(p, `${e.name}.${ext}`, "Binary mesh geometry sidecar")).join("");
    const skelSidecarBtns = Object.entries(e.skeletonSidecars || {})
      .map(([ext, p]) => this.dlButton(p, `…_Skeleton.${ext}`, "Binary sidecar on the skeleton companion's stem")).join("");

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">${e.kind === "StaticMesh" ? "Static Mesh" : "Skeletal Mesh"}</h3>
        <div class="preview-name">${escapeHtml(e.name)}</div>
        <div class="preview-itemkey" style="word-break:break-all;">${escapeHtml(e.folder)}</div>

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:4px;">Downloads</div>
          <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:8px;">
            The JSON is mesh <b>metadata</b> (UE doesn't export geometry to JSON); the binary
            sidecars <b>are</b> the geometry. blend buttons appear here automatically once
            .blend files are uploaded next to the JSONs.
          </div>
          <div>${this.dlButton(e.jsonPath, `${e.name}.json`, "Mesh metadata JSON")}${sidecarBtns}${skelSidecarBtns}</div>
          ${!sidecarBtns && !skelSidecarBtns ? '<div style="font-size:11px; color:var(--hud-text-dim); margin-top:4px;">No binary sidecars exported for this asset yet — only the metadata JSON.</div>' : ""}
        </div>

        ${e.kind === "SkeletalMesh" ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:12px; padding:12px 14px;">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:6px;">Companions (same-folder naming conventions)</div>
            <table style="width:100%; border-collapse:collapse;"><tbody>
              <tr><td style="padding:3px 10px; font-size:11px; color:var(--hud-text-dim); white-space:nowrap;">Skeleton</td>
                <td style="padding:3px 10px; font-size:12px;">${e.skeletonJson
                  ? `${this.dlButton(e.skeletonJson, e.skeletonJson.split("/").pop(), "Bone skeleton JSON ({stem}_Skeleton convention)")}`
                  : '<span style="color:var(--hud-text-dim);">none exported (shared skeletons are common — many meshes reuse a family skeleton)</span>'}</td></tr>
              <tr><td style="padding:3px 10px; font-size:11px; color:var(--hud-text-dim);">Physics</td>
                <td style="padding:3px 10px; font-size:12px;">${e.physicsJson
                  ? `${this.dlButton(e.physicsJson, e.physicsJson.split("/").pop(), "Physics asset JSON (PHYS_ prefix or _PhysicsAsset suffix — both conventions are real)")}`
                  : '<span style="color:var(--hud-text-dim);">none exported</span>'}</td></tr>
              <tr><td style="padding:3px 10px; font-size:11px; color:var(--hud-text-dim);">Morph data</td>
                <td style="padding:3px 10px; font-size:12px;">${e.morphDataJson
                  ? `${this.dlButton(e.morphDataJson, e.morphDataJson.split("/").pop(), "Morph data JSON ({stem}_MorphData convention)")}`
                  : '<span style="color:var(--hud-text-dim);">none exported</span>'}</td></tr>
            </tbody></table>
          </div>
        ` : ""}

        <div style="width:100%; text-align:left; font-size:11px; color:var(--hud-text-dim); margin-top:10px;">
          Source: <code>raw-export/Content/ROD/${escapeHtml(e.folder)}/</code> — downloads stream
          the raw exported files directly (they are deliberately NOT mirrored into Content/ROD).
        </div>
      </div>
    `;
  },
};
