// ============================================================
// ailments-browser.js
// Browser for Characters > Ailments -- the nine officially named
// status effects, built from the game's own tutorial localization
// pairs (TutorialTitle_<code> + TutorialDetailwindow_<code>_01,
// verified present in all 13 languages), plus the state-icon
// inventory under Widget/Common/IconImage/StateIconImages/.
//
// CONFIRMED before building: NO status-effect data table or enum
// exists anywhere in DataAssets (the only *State* enum in the export
// is EVoiceState) -- ailment MECHANICS (durations, tick rates,
// resistances) live in unexported Blueprints, the same honest
// situation as monster HP. And while there are exactly NINE bad-state
// icons for exactly NINE named ailments, NO data maps icon numbers to
// ailment codes -- the icons are shown as an inventory strip,
// deliberately NOT paired to specific ailments.
// ============================================================

const AilmentsBrowserView = {
  state: { selectedCode: null },

  render(container) {
    const idx = DataStore.ailmentIndex || {};
    const inv = idx.iconInventory || { bad: [], good: [], generic: [], other: [] };
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${(DataStore.ailmentList || []).length}</b> named status effects</span>
        <span><b>13</b>/13 languages (names + descriptions)</span>
        <span><b>${inv.bad.length}</b> bad / <b>${inv.good.length}</b> good state icons</span>
        <span style="margin-left:auto; opacity:0.6;" title="No status-effect data table or enum exists in DataAssets — mechanics live in unexported Blueprints (searched, not assumed)">mechanics not in this export</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 320px;">
        <div id="ailmentListPane"></div>
        <div id="ailmentDetailPane"></div>
      </div>
      <div class="hud-panel" style="margin-top:14px; padding:12px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:4px;">State Icon Inventory</div>
        <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:8px;">
          ${inv.bad.length} bad-state icons for ${(DataStore.ailmentList || []).length} named ailments is a
          suggestive count match — but no data maps icon numbers to ailment codes, so they're
          shown here as an inventory, deliberately not paired. Good-state (buff) icons have no
          name registry anywhere in the export at all.
        </div>
        ${["bad", "good", "generic", "other"].map((fam) => inv[fam].length ? `
          <div style="display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap;">
            <span style="font-size:11px; color:var(--hud-text-dim); min-width:56px;">${fam}</span>
            ${inv[fam].map((f) => `
              <span style="text-align:center;">
                <img src="${escapeHtml((idx.iconDir || "") + "/" + f)}" alt="" style="width:30px; height:30px; object-fit:contain;" loading="lazy" title="${escapeHtml(f)}"/>
              </span>
            `).join("")}
          </div>
        ` : "").join("")}
      </div>
    `;
    container.appendChild(wrap);
    this.renderList();
    this.renderDetail();
  },

  renderList() {
    const pane = document.getElementById("ailmentListPane");
    const list = DataStore.ailmentList || [];
    const el = document.createElement("div");
    list.forEach((a) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (a.code === this.state.selectedCode ? " selected" : "");
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(DataStore.getAilmentName(a.code))}</div>
          <div class="wl-id">${escapeHtml(a.code)}</div>
        </div>
        <span class="pill verified">verified</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedCode = a.code;
        this.renderList();
        this.renderDetail();
      });
      el.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(el);
    if (!this.state.selectedCode && list.length) {
      this.state.selectedCode = list[0].code;
      this.renderDetail();
    }
  },

  renderDetail() {
    const pane = document.getElementById("ailmentDetailPane");
    const ailment = (DataStore.ailmentList || []).find((a) => a.code === this.state.selectedCode);
    if (!ailment) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a status effect</p></div></div>`;
      return;
    }
    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Status Effect</h3>
        <div class="preview-name">${escapeHtml(DataStore.getAilmentName(ailment.code))}</div>
        <div class="preview-itemkey">${escapeHtml(ailment.code)} <span class="pill verified">verified</span></div>
        <div class="mod-sources" style="align-self:stretch; text-align:right; margin-top:4px;">
          <span class="mod-source-tag">Name: ST_GeneralLocalizeList["${escapeHtml(ailment.titleKey)}"]</span>
          <span class="mod-source-tag">Effect: ST_GeneralLocalizeList["${escapeHtml(ailment.detailKey)}"]</span>
        </div>
        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
          <div style="font-size:13px; line-height:1.7; color:var(--hud-text);">${escapeHtml(DataStore.getAilmentDescription(ailment.code))}</div>
        </div>
        <div style="width:100%; text-align:left; font-size:11px; color:var(--hud-text-dim); margin-top:12px;">
          The official in-game tutorial text above is the ONLY ailment data in this export —
          durations, tick rates, buildup thresholds, and resistances live in unexported
          Blueprints (searched; the general "Status Effects" tutorial is shown in Data Coverage).
          Which of the nine bad-state icons belongs to this ailment is likewise unconfirmed.
        </div>
      </div>
    `;
  },
};
