// ============================================================
// quests-browser.js
// Browser for World > Quests -- 5 Main quests from
// QST_Main_0001-0005.json. Only the Main category has real data files
// in this export (Sub/Town quest type icons exist but no quest data
// files -- confirmed before this was written). Source attribution
// follows the Unique MOD/Recipe/Town convention throughout.
// ============================================================

const QuestsBrowserView = {
  state: {
    selectedID: null,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="questQuickCoverage"></div>
      <div class="equip-layout" style="grid-template-columns: 320px 1fr;">
        <div id="questListPane"></div>
        <div id="questDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    const all = DataStore.getAllQuestsFlat();
    const named = all.filter((q) => DataStore.isQuestNameVerified(q)).length;
    document.getElementById("questQuickCoverage").innerHTML = `
      <span><b>${all.length}</b> quests loaded</span>
      <span><b>${named}</b>/${all.length} names resolved</span>
      <span style="margin-left:auto; opacity:0.6;">Main category only — Sub/Town quest icons exist but no data files in this export</span>
    `;

    if (!this.state.selectedID) {
      this.state.selectedID = all[0] ? all[0].questId : null;
    }

    this.renderList();
    this.renderDetail();
  },

  renderList() {
    const pane = document.getElementById("questListPane");
    const all = DataStore.getAllQuestsFlat();

    const list = document.createElement("div");
    all.forEach((quest) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (quest.questId === this.state.selectedID ? " selected" : "");
      const name = DataStore.getQuestDisplayName(quest);
      row.innerHTML = `
        <span class="wl-icon" style="width:32px; height:32px; flex-shrink:0;">
          <img src="${quest.textures.categoryIcon}" alt="Main" loading="lazy" style="width:28px; height:28px; object-fit:contain;" />
        </span>
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(name)}</div>
          <div class="wl-id">${escapeHtml(quest.category)} &middot; ${quest.questId}</div>
        </div>
        ${quest.isDungeon ? '<span class="pill verified" style="font-size:9px;">Dungeon</span>' : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedID = quest.questId;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);
  },

  renderDetail() {
    const pane = document.getElementById("questDetailPane");
    const quest = DataStore.questByID[this.state.selectedID];

    if (!quest) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a quest</p></div></div>`;
      return;
    }

    const name = DataStore.getQuestDisplayName(quest);
    const description = DataStore.getQuestDescription(quest);
    const dungeonName = DataStore.getQuestDungeonName(quest);
    const verified = DataStore.isQuestNameVerified(quest);

    // Partner resolution -- use existing Character getters
    const partnerNames = (quest.forcePartners || []).map((code) => {
      const partner = DataStore.characterList
        ? DataStore.characterList.find((c) => c.code === code)
        : null;
      return partner ? DataStore.getCharacterDisplayName(partner) : code;
    });

    // Clear condition label
    const clearLabel = quest.clearConditionSummary || "—";

    // Time zone display
    const tzLabels = { Night: "🌙 Night", Noon: "☀ Noon", Evening: "🌆 Evening" };
    const timeLabel = tzLabels[quest.timeZone] || quest.timeZone || "—";

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <div style="display:flex; align-items:center; gap:12px; align-self:stretch; margin-bottom:10px;">
          <img src="${quest.textures.categoryIcon}" alt="${quest.category}" style="width:36px; height:36px; object-fit:contain; flex-shrink:0;" />
          <div>
            <div class="preview-name" style="margin:0 0 2px;">${escapeHtml(name)}</div>
            <div class="preview-itemkey">${escapeHtml(quest.nameKey || "")} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified</span>'}</div>
          </div>
        </div>

        ${description ? `<div class="item-description">${escapeHtml(description)}</div>` : ""}

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.9;">
          <div>Category: <b style="color:var(--hud-text);">${escapeHtml(quest.category)}</b></div>
          <div>Time of day: <b style="color:var(--hud-text);">${timeLabel}</b></div>
          ${quest.isDungeon ? `<div>Dungeon quest: <b style="color:var(--hud-text);">${dungeonName || "Unnamed dungeon"}</b></div>` : ""}
          <div>Partners: <b style="color:var(--hud-text);">${partnerNames.length > 0 ? escapeHtml(partnerNames.join(", ")) : "None"}</b>${quest.bNoPartner && partnerNames.length > 0 ? ' <span style="opacity:0.6; font-size:10px;">(tutorial — bNoPartner=true)</span>' : ""}</div>
          <div>Clear condition: <b style="color:var(--hud-text);">${escapeHtml(clearLabel)}</b></div>
        </div>
      </div>

      <div class="hud-panel" style="margin-top:14px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:10px;">Level / Instance Loading</div>

        <div style="font-size:12px; line-height:1.8; color:var(--hud-text-dim);">
          <div><b style="color:var(--hud-text);">Start Gate ID</b> — the in-game terminal/gate this quest starts at</div>
          <div style="font-family:var(--font-mono); color:var(--db-cyan-bright);">${escapeHtml(quest.startGateID || "—")}</div>
        </div>

        <div style="font-size:12px; line-height:1.8; color:var(--hud-text-dim); margin-top:10px;">
          <div><b style="color:var(--hud-text);">Quest Asset Path</b> — full UE asset path for this quest</div>
          <div style="font-family:var(--font-mono); font-size:10px; color:var(--db-cyan-bright); word-break:break-all;">${escapeHtml(quest.questAssetPath || "—")}</div>
        </div>

        <div class="source-footnote">
          Name/desc: ${escapeHtml(quest.sources.name)}<br/>
          Level/instance: ${escapeHtml(quest.sources.levelInstance)}
        </div>
      </div>
    `;
  },
};
