// ============================================================
// animation-assets-browser.js
// Asset Inspector > Animations -- the ANM/ tree catalog (5,418
// animation assets: AnimSequences, AnimMontages, BlendSpaces,
// AnimComposites, kind classified by the verified filename prefixes
// A_/AM_/BS_/AC_/AS_), plus the costume-side sequences living in CHR/.
//
// DOWNLOADS: psa / ueanim sidecar binaries with the same stem get
// download buttons through the existing /api/pipeline/download-file
// endpoint. Most animations have no exported sidecar yet (18 psa + 18
// ueanim across 5,418 assets in the current export) -- the "with
// downloads" filter finds the ones that do. The 3 sidecars with NO
// same-stem JSON sibling are listed in the index as orphans, not
// hidden.
//
// Data is lazy-loaded on first tab open (a 5,418-entry catalog does
// not belong in the startup fetch), and the list renders capped with
// a narrowing hint, same as the Skeletons tab.
// ============================================================

const AnimationAssetsBrowserView = {
  state: {
    loaded: false,
    entries: [],
    selectedPath: null,
    search: "",
    kind: "all",
    downloadsOnly: false,
  },

  async render(container) {
    if (!this.state.loaded) {
      container.innerHTML = `<div class="hud-panel"><p style="color:var(--hud-text-dim);">Loading animation catalog…</p></div>`;
      try {
        this.state.entries = await fetchJSON(`${CONTENT_ROOT}/DataAssets/_AssetInspector/Animations.json`);
        this.state.loaded = true;
      } catch (e) {
        container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Couldn't load Animations.json — run the Inspectors focus build.</p></div></div>`;
        return;
      }
      container.innerHTML = "";
    }
    const idx = (DataStore.assetInspectorIndex && DataStore.assetInspectorIndex.animations) || {};
    const sc = idx.sidecarCounts || {};
    const kinds = idx.byKind || {};
    const orphans = (idx.orphanSidecars || []).length;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${this.state.entries.length}</b> animation assets</span>
        <span>${Object.entries(kinds).map(([k, c]) => `<b>${c}</b> ${escapeHtml(k)}`).join(" · ")}</span>
        <span>downloads: <b>${sc.psa || 0}</b> psa · <b>${sc.ueanim || 0}</b> ueanim</span>
        ${orphans ? `<span class="pill unverified" title="Sidecar binaries with no same-stem JSON sibling — listed in the index, not hidden: ${escapeHtml((idx.orphanSidecars || []).join(", "))}">${orphans} orphan sidecars</span>` : ""}
        <span style="margin-left:auto; opacity:0.6;" title="Most animations have only their metadata JSON exported so far — sidecar binaries appear automatically when uploaded next to the JSONs.">sidecars appear when uploaded</span>
      </div>
      <div class="toolbar" id="animToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 380px;">
        <div id="animListPane" class="list-pane-self-managed"></div>
        <div id="animDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderToolbar();
    this.renderList();
    this.renderDetail();
  },

  renderToolbar() {
    const el = document.getElementById("animToolbar");
    const kinds = [...new Set(this.state.entries.map((e) => e.kind))].sort();
    el.innerHTML = `
      <input type="text" class="search-input" id="animSearch" placeholder="Search by animation name or folder…" value="${escapeHtml(this.state.search)}" />
      <select class="filter-select" id="animKind">
        <option value="all">All kinds</option>
        ${kinds.map((k) => `<option value="${escapeHtml(k)}" ${this.state.kind === k ? "selected" : ""}>${escapeHtml(k)}</option>`).join("")}
      </select>
      <button class="toggle-btn${this.state.downloadsOnly ? " active" : ""}" id="animDlOnly" title="Only animations with downloadable psa/ueanim sidecars">⬇ With downloads</button>
    `;
    document.getElementById("animSearch").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderList();
    });
    document.getElementById("animKind").addEventListener("change", (e) => {
      this.state.kind = e.target.value;
      this.renderList();
    });
    document.getElementById("animDlOnly").addEventListener("click", () => {
      this.state.downloadsOnly = !this.state.downloadsOnly;
      this.renderToolbar();
      this.renderList();
    });
  },

  getFiltered() {
    let list = this.state.entries;
    if (this.state.kind !== "all") list = list.filter((e) => e.kind === this.state.kind);
    if (this.state.downloadsOnly) list = list.filter((e) => Object.keys(e.sidecars).length);
    const q = this.state.search.trim().toLowerCase();
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q));
    return list;
  },

  renderList() {
    const pane = document.getElementById("animListPane");
    const list = this.getFiltered();
    const el = document.createElement("div");
    el.className = "hud-panel";
    el.style.cssText = "max-height:calc(100vh - 320px); overflow-y:auto; padding:6px;";
    if (!list.length) {
      el.innerHTML = `<div class="empty-state" style="padding:24px 10px;"><div class="empty-icon">🎞</div><h4>No animations match</h4></div>`;
    }
    list.slice(0, 400).forEach((e) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (e.jsonPath === this.state.selectedPath ? " selected" : "");
      const dl = Object.keys(e.sidecars).length;
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name" style="word-break:break-all;">${escapeHtml(e.name)}</div>
          <div class="wl-id">${escapeHtml(e.kind)}</div>
        </div>
        ${dl ? `<span class="pill verified" title="Downloadable: ${Object.keys(e.sidecars).join(", ")}">⬇ ${dl}</span>` : ""}
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
      more.textContent = `Showing 400 of ${list.length} — narrow the search or filters.`;
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
    const pane = document.getElementById("animDetailPane");
    const e = this.state.entries.find((x) => x.jsonPath === this.state.selectedPath);
    if (!e) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an animation</p></div></div>`;
      return;
    }
    const sidecarBtns = Object.entries(e.sidecars)
      .map(([ext, p]) => this.dlButton(p, `${e.name}.${ext}`, "Binary animation sidecar")).join("");

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">${escapeHtml(e.kind)}</h3>
        <div class="preview-name" style="word-break:break-all; font-size:18px;">${escapeHtml(e.name)}</div>
        <div class="preview-itemkey" style="word-break:break-all;">${escapeHtml(e.folder)}</div>

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:4px;">Downloads</div>
          <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:8px;">
            The JSON is animation <b>metadata</b>; psa / ueanim sidecars are the animation
            data itself, and appear here automatically once exported next to the JSON.
          </div>
          <div>${this.dlButton(e.jsonPath, `${e.name}.json`, "Animation metadata JSON")}${sidecarBtns}</div>
          ${!sidecarBtns ? '<div style="font-size:11px; color:var(--hud-text-dim); margin-top:4px;">No binary sidecar exported for this animation yet — only the metadata JSON.</div>' : ""}
        </div>

        <div style="width:100%; text-align:left; font-size:11px; color:var(--hud-text-dim); margin-top:10px;">
          Source: <code>raw-export/Content/ROD/${escapeHtml(e.folder)}/</code> — streams the raw
          exported files directly (the ANM tree is deliberately NOT mirrored into Content/ROD).
        </div>
      </div>
    `;
  },
};
