// ============================================================
// quests-browser.js
// Browser for World > Quests. Post-release the export carries THREE
// quest folder categories -- Main (34), Sub (61), Free (94, generated
// repeatables that reference a parent quest and have no localization
// keys in any language) -- so the list gets a category filter and IDs
// are category-qualified (Main_0001 and Sub_0001 both exist). Source
// attribution follows the Unique MOD/Recipe/Town convention.
// ============================================================

const QuestsBrowserView = {
  state: {
    selectedID: null,   // category-qualified key from DataStore.getQuestKey()
    categoryFilter: "All",
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="questQuickCoverage"></div>
      <div class="equip-layout two-col" style="--list-col: 320px;">
        <div id="questListPane"></div>
        <div id="questDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    const all = DataStore.getAllQuestsFlat();
    const named = all.filter((q) => DataStore.isQuestNameVerified(q)).length;
    const perCat = (DataStore.questIndex && DataStore.questIndex.perCategory) || {};
    const catSummary = Object.keys(perCat).length
      ? Object.entries(perCat).map(([c, n]) => `${c}: ${n}`).join(" · ")
      : "Main category only (pre-release data — rebuild the World focus group after uploading the new Quests export)";
    document.getElementById("questQuickCoverage").innerHTML = `
      <span><b>${all.length}</b> quests loaded</span>
      <span><b>${named}</b>/${all.length} names resolved</span>
      <span style="margin-left:auto; opacity:0.6;">${catSummary}</span>
    `;

    if (!this.state.selectedID) {
      this.state.selectedID = all[0] ? DataStore.getQuestKey(all[0]) : null;
    }

    this.renderList();
    this.renderDetail();
  },

  renderList() {
    const pane = document.getElementById("questListPane");
    let all = DataStore.getAllQuestsFlat();
    const cats = ["All", ...new Set(all.map((q) => q.folderCategory || "Main"))];
    if (this.state.categoryFilter !== "All") {
      all = all.filter((q) => (q.folderCategory || "Main") === this.state.categoryFilter);
    }

    const list = document.createElement("div");
    if (cats.length > 2) {
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;";
      cats.forEach((c) => {
        const b = document.createElement("button");
        b.className = "toggle-btn" + (this.state.categoryFilter === c ? " active" : "");
        b.style.fontSize = "11px";
        b.textContent = c;
        b.addEventListener("click", () => { this.state.categoryFilter = c; this.renderList(); });
        bar.appendChild(b);
      });
      list.appendChild(bar);
    }
    all.forEach((quest) => {
      const qKey = DataStore.getQuestKey(quest);
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (qKey === this.state.selectedID ? " selected" : "");
      const name = DataStore.getQuestDisplayName(quest);
      row.innerHTML = `
        <span class="wl-icon" style="width:32px; height:32px; flex-shrink:0;">
          <img src="${quest.textures.categoryIcon}" alt="${escapeHtml(quest.folderCategory || "Main")}" loading="lazy" style="width:28px; height:28px; object-fit:contain;" />
        </span>
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(name)}</div>
          <div class="wl-id">${escapeHtml(quest.folderCategory || quest.category)} &middot; ${quest.questId}</div>
        </div>
        ${quest.isDungeon ? '<span class="pill verified" style="font-size:9px;">Dungeon</span>' : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedID = qKey;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);
  },

  /**
   * One reward line: resolved name FIRST, raw {Category, ItemId}
   * reference kept alongside (the values RODSchema patches use) --
   * "Recovery Potion Recipe ×5 (raw: Cost #33)". Col rewards are the
   * amount itself. itemKey null = nothing in ItemDataAsset claims that
   * (category, id): shown raw, never guessed.
   */
  /**
   * A quest's TERMINALS -- corrected after checking the game's SDK
   * rather than trusting the name of the field.
   *
   * QuestTerminalList is `TArray<FName>` on `FQuestData`: a list of
   * terminal IDs the quest ACTIVATES (safe areas + warp terminals),
   * handed to the server as `ServerDecideQuest(..., QuestTerminalIDs,
   * FloorTerminalIDs, ...)` alongside `ClientActivateTerminal` /
   * `ServerDecideStartTerminal`. It is the quest's checkpoint and
   * fast-travel set.
   *
   * It is NOT the level-streaming mechanism. Streaming is driven by
   * `ARODLevelStreamingVolume` actors placed in the world -- overlap
   * volumes carrying a `LevelReferenceList` of level names, loaded on
   * player overlap -- plus World Partition cells. Those actors live in
   * `Content/__ExternalActors__/`, which is NOT in this export, so the
   * true per-quest set of streamed level chunks cannot be listed yet,
   * and this panel does not pretend to.
   *
   * What the terminals DO tell you (verified across all 189 quests):
   *  - The quest's footprint: which map areas it makes reachable, and
   *    always within ONE world -- not a single quest spans WL01+WL02.
   *  - Dungeon quests activate dungeon gates and typically no field
   *    areas at all.
   * The SA_ ids double as the Field Map's own area keys (DA_MapPiece is
   * keyed by them), which is why they resolve to areas cleanly.
   */
  areasHtml(quest) {
    const refs = quest.terminalRefs || [];
    if (!refs.length) {
      // Free quests genuinely carry no terminal list -- say so instead
      // of rendering an empty box.
      return quest.folderCategory === "Free"
        ? `<div style="opacity:0.7;">Areas: <span style="color:var(--hud-text-dim);">no terminal list — Free quests declare none (all 94 checked)</span></div>`
        : "";
    }
    const field = refs.filter((r) => r.kind === "fieldArea" || r.kind === "warpTerminal");
    const dungeons = refs.filter((r) => r.kind === "dungeonGate");
    const towns = refs.filter((r) => r.kind === "townWarp");
    const unresolved = refs.filter((r) => r.kind === "unresolved");
    const worlds = quest.areaWorlds || [];

    const dungeonNames = [...new Set(dungeons.map((d) => d.dungeonKey))];
    return `
      <div class="hud-panel" style="width:100%; text-align:left; margin-top:12px; padding:12px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:3px;">
          QUEST TERMINALS — ${refs.length} activated
          ${worlds.length ? `<span style="opacity:0.7; font-weight:400;">· ${worlds.map(escapeHtml).join(" + ")}</span>` : ""}
        </div>
        <div style="font-size:10px; color:var(--hud-text-dim); margin-bottom:7px;">
          <b>Source:</b> <code>DataAssets/Quests/${escapeHtml(quest.folderCategory || "")}/QST_*.json</code> →
          <code>QuestData.QuestTerminalList</code> (<code>TArray&lt;FName&gt;</code> on <code>FQuestData</code>, per the game's SDK).
          These are the safe areas and warp terminals the quest <b>activates</b> — its checkpoint/fast-travel set, passed to
          <code>ServerDecideQuest(…, QuestTerminalIDs, …)</code>.
          ${quest.startGateId ? `Starts at <b style="font-family:var(--font-mono);">${escapeHtml(quest.startGateId)}</b>.` : ""}
          ${quest.worldName ? ` World: <b style="font-family:var(--font-mono);">${escapeHtml(quest.worldName)}</b>.` : ""}
        </div>
        <div style="font-size:10px; color:var(--hud-sp); margin-bottom:7px;">
          <b>Not the same as level streaming.</b> Actual chunk loading is driven by <code>ARODLevelStreamingVolume</code>
          actors (overlap volumes with a <code>LevelReferenceList</code>) plus World Partition cells — those actors live in
          <code>Content/__ExternalActors__/</code>, which isn't in this export, so the exact streamed-level set per quest
          can't be listed yet. The terminals below are the quest's <i>reachable footprint</i>, which is the closest thing
          the exported data actually defines.
        </div>

        ${field.length ? `
          <div style="font-size:11px; color:var(--hud-text); margin-bottom:3px;"><b>Field-map areas (${field.length})</b> <span style="opacity:0.6; font-weight:400;">— SA_ ids double as the Field Map's own area keys (DA_MapPiece is keyed by them)</span></div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:7px;">
            ${field.map((r) => `
              <a href="#" class="quest-area-link pill" data-gate="${escapeHtml(r.gateId)}"
                 style="font-size:9.5px; text-decoration:none; cursor:pointer;"
                 title="Open ${escapeHtml(r.gateId)} on the Field Map${r.world ? " (" + escapeHtml(r.world) + ")" : ""}">📍 ${escapeHtml(r.location || r.gateId)}</a>`).join("")}
          </div>` : ""}

        ${dungeons.length ? `
          <div style="font-size:11px; color:var(--hud-text); margin-bottom:3px;"><b>Dungeon gates (${dungeons.length})</b> — ${dungeonNames.length} dungeon${dungeonNames.length === 1 ? "" : "s"}</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:7px;">
            ${dungeonNames.map((d) => `<span class="pill" style="font-size:9.5px;">${escapeHtml(DataStore.getDungeonDisplayName({ dungeonKey: d }) || d)}</span>`).join("")}
          </div>` : ""}

        ${towns.length ? `
          <div style="font-size:11px; color:var(--hud-text); margin-bottom:3px;"><b>Town warps (${towns.length})</b></div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:7px;">
            ${towns.map((r) => `<span class="pill" style="font-size:9.5px;" title="${escapeHtml(r.id)}">${escapeHtml(r.id.replace(/^WT_/, ""))}</span>`).join("")}
          </div>` : ""}

        ${unresolved.length ? `
          <div style="font-size:10.5px; color:var(--hud-sp);">
            <b>${unresolved.length} gate${unresolved.length === 1 ? "" : "s"} unresolved:</b>
            <span style="font-family:var(--font-mono);">${unresolved.map((r) => escapeHtml(r.id)).join(", ")}</span> —
            no area, dungeon or town in this export claims ${unresolved.length === 1 ? "it" : "them"}. The quest references
            content the dungeon table doesn't contain (e.g. ERU_Deep, NTR_Und); shown rather than force-fitted.
          </div>` : ""}
      </div>`;
  },

  rewardRow(label, reward) {
    if (!reward) return "";
    let display;
    if (reward.itemKey === "Col") {
      display = `<b style="color:var(--hud-text);">${reward.num} Col</b>`;
    } else if (reward.itemKey) {
      display = `<b style="color:var(--hud-text);">${escapeHtml(DataStore.getItemDisplayName(reward.itemKey))}</b>${reward.num > 1 ? ` ×${reward.num}` : ""} <span style="opacity:0.55; font-size:10px; font-family:var(--font-mono);">(raw: ${escapeHtml(reward.category)} #${reward.itemId})</span>`;
    } else {
      display = `<span style="color:var(--hud-text-dim);" title="No entry in ItemDataAsset claims this (category, id) — shown raw, not guessed">${escapeHtml(reward.category)} item #${reward.itemId}${reward.num > 1 ? ` ×${reward.num}` : ""}</span>`;
    }
    return `<div>${escapeHtml(label)}: ${display}</div>`;
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
          ${this.rewardRow("Base completion reward", quest.baseReward)}
          ${this.rewardRow(quest.accomplishReward && quest.accomplishReward.rewardType ? `Completion reward (${quest.accomplishReward.rewardType})` : "Completion reward", quest.accomplishReward)}
          ${this.areasHtml(quest)}
          ${(quest.itemLotTableKeys || []).length ? `<div>Loot-table rewards: <b style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text);">${quest.itemLotTableKeys.map(escapeHtml).join(", ")}</b> <span style="opacity:0.6; font-size:10px;">(DT_ItemLotTable pools — same system chests use)</span></div>` : ""}
          ${quest.worldName ? `<div>World level: <b style="color:var(--hud-text); font-family:var(--font-mono); font-size:11px;">${escapeHtml(quest.worldName.split("/").pop())}</b></div>` : ""}
          ${quest.parentQuestAsset ? `<div>Repeatable variant of: <b style="color:var(--hud-text); font-family:var(--font-mono); font-size:11px;">${escapeHtml(quest.parentQuestAsset.replace(/^.*?'/, "").replace(/'$/, ""))}</b> <span style="opacity:0.6; font-size:10px;">(Free quests have no localization keys in any language — raw keys shown by the missing-name rule)</span></div>` : ""}
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

// "Open on map" from a quest's Areas Loaded panel. One delegated
// listener at document level -- quest detail re-renders on every
// selection, and per-render wiring would leak handlers.
document.addEventListener("click", (ev) => {
  const a = ev.target.closest && ev.target.closest(".quest-area-link");
  if (!a) return;
  ev.preventDefault();
  // const App doesn't attach to window -- reference the lexical global.
  if (typeof App !== "undefined" && typeof App.openMapArea === "function") {
    App.openMapArea(a.dataset.gate, null);
  }
});
