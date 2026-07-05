// ============================================================
// towns-browser.js
// Browser for World > Towns -- 10 towns from DT_TownList.json,
// cross-referenced with Town_001-006.json detail files (only the
// 6 named Floor 1-2 towns have a detail file; Floor 3 towns 007-010
// are unnamed placeholders with no detail file confirmed before this
// was built). Primary display value: the WorldName (UE map asset path,
// the literal string that loads this town's level instance) and
// MainTerminalID (the teleport gate/terminal identifier) -- these are
// the "level/instance loading" identifiers the user specifically asked
// for. Source attribution follows the Unique MOD/Recipe convention.
// ============================================================

const TownsBrowserView = {
  state: {
    selectedID: null,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="townQuickCoverage"></div>
      <div class="equip-layout two-col" style="--list-col: 320px;">
        <div id="townListPane"></div>
        <div id="townDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    const all = DataStore.getAllTownsFlat();
    const named = all.filter((t) => DataStore.isTownNameVerified(t)).length;
    document.getElementById("townQuickCoverage").innerHTML = `
      <span><b>${all.length}</b> towns loaded</span>
      <span><b>${named}</b>/${all.length} names resolved</span>
      <span style="margin-left:auto; opacity:0.6;">Floors 1–2 fully sourced — Floor 3 entries are placeholders with no name in this export</span>
    `;

    if (!this.state.selectedID) {
      this.state.selectedID = all[0] ? all[0].id : null;
    }

    this.renderList();
    this.renderDetail();
  },

  renderList() {
    const pane = document.getElementById("townListPane");
    const all = DataStore.getAllTownsFlat();

    const list = document.createElement("div");
    all.forEach((town) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (town.id === this.state.selectedID ? " selected" : "");
      const verified = DataStore.isTownNameVerified(town);
      const name = DataStore.getTownDisplayName(town);
      row.innerHTML = `
        <span class="wl-icon" style="width:56px; height:40px; flex-shrink:0;">
          <img src="${town.textures.thumbnail}" alt="" loading="lazy" style="width:56px; height:40px; object-fit:cover; border-radius:4px;" />
        </span>
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(name)}</div>
          <div class="wl-id">Floor ${town.floor} &middot; ID ${town.id}</div>
        </div>
        ${!verified ? '<span class="pill unverified">unnamed</span>' : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedID = town.id;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);
  },

  renderDetail() {
    const pane = document.getElementById("townDetailPane");
    const town = DataStore.townByID[this.state.selectedID];

    if (!town) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a town</p></div></div>`;
      return;
    }

    const verified = DataStore.isTownNameVerified(town);
    const name = DataStore.getTownDisplayName(town);
    const hasDetail = town.hasDetailFile;

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Town Preview</h3>
        <div class="preview-img-wrap zoomable-icon" id="townPreviewImgWrap" title="Click to zoom" style="width:200px; height:120px; margin:0 auto 12px; border-radius:6px; overflow:hidden; cursor:pointer;">
          <img src="${town.textures.thumbnail}" alt="" style="width:100%; height:100%; object-fit:cover;" />
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(name)}</div>
        <div class="preview-itemkey">${escapeHtml(town.nameKey)} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified</span>'}</div>

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.9;">
          <div>Floor: <b style="color:var(--hud-text);">${town.floor}</b></div>
          <div>Town ID: <b style="color:var(--hud-text);">${town.id}</b></div>
        </div>

        ${hasDetail ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:8px;">Level / Instance Loading</div>
            <div style="font-size:11px; line-height:1.8; color:var(--hud-text-dim);">
              <div><b style="color:var(--hud-text);">World Map Path</b></div>
              <div style="font-family:var(--font-mono); color:var(--db-cyan-bright); word-break:break-all;">${escapeHtml(town.worldName || "—")}</div>
            </div>
            <div style="font-size:11px; line-height:1.8; color:var(--hud-text-dim); margin-top:8px;">
              <div><b style="color:var(--hud-text);">Terminal ID</b></div>
              <div style="font-family:var(--font-mono); color:var(--db-cyan-bright);">${escapeHtml(town.terminalID || "—")}</div>
            </div>
            ${town.bgmStateName ? `
              <div style="font-size:11px; line-height:1.8; color:var(--hud-text-dim); margin-top:8px;">
                <div><b style="color:var(--hud-text);">BGM State</b></div>
                <div style="font-family:var(--font-mono);">${escapeHtml(town.bgmStateName)}</div>
              </div>
            ` : ""}
          </div>

          <div class="source-footnote" style="width:100%;">
            Name: ${escapeHtml(town.sources.nameKey)}<br/>
            ${town.sources.worldName ? `World path: ${escapeHtml(town.sources.worldName)}<br/>` : ""}
            ${town.sources.terminalID ? `Terminal ID: ${escapeHtml(town.sources.terminalID)}` : ""}
          </div>
        ` : `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No detail file in this export</div>
            <div class="mod-effect-line">
              This Floor 3 town entry exists in DT_TownList.json but has no corresponding
              Town_${town.id}.json detail file — no WorldName, terminal ID, or level-loading
              path is available. The town also has no name in any of the 13 language files
              in this export. Shown for completeness; all data fields above are confirmed absent,
              not silently omitted.
            </div>
          </div>
        `}
      </div>
    `;

    const previewImgWrap = document.getElementById("townPreviewImgWrap");
    if (previewImgWrap) {
      previewImgWrap.addEventListener("click", () => {
        openIconZoom({
          itemKey: town.nameKey,
          rank: null,
          textures: { icon: town.textures.thumbnail, categoryPlaceholderRender: town.textures.thumbnail },
        }, name);
      });
    }
  },
};
