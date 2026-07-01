// ============================================================
// characters-browser.js
// Database browser for Characters (DT_CharacterDatabase.json, 22
// total), with two further sub-views nested under it:
//   - Partners: the 7 of those 22 with a dedicated DT_Partner_{code}.json
//     200-level stat growth table -- shown with an interactive level
//     slider, modeled directly on the Weapons section's enhancement
//     slider (live in-place DOM patching on `input`, never a full
//     re-render, so dragging stays smooth).
//   - Customization: AvatarCustomizeDataAsset.json's parts/colors/
//     voices/presets. Genuinely different from every other category:
//     NO name field exists anywhere for any of this data (pure visual
//     swatches, selected by appearance, not by reading a label).
//
// No Skills or weapon-type data exists anywhere in this export for any
// partner -- confirmed by checking DT_Partner_*.json (8 stat fields
// only), PartnerData.json (the skill-sounding fields there are shared/
// generic across all 7 partners, not character-specific), and
// PartnerStatusParameters.json (also shared, not per-character) before
// concluding this, not assumed from absence at a glance.
// ============================================================

const CharactersBrowserView = {
  state: {
    activeTab: "characters", // "characters" | "partners" | "customization" | "player"
    selectedTitleKey: null,
    selectedPartnerCode: null,
    partnerLevel: 1,
    customizeCategory: "HeadGearPartsDataAsMap",
    player: {
      name: "Player",
      level: 1,
      allocated: { STR: 1, DEX: 1, AGI: 1, INT: 1, VIT: 1, END: 1, MND: 1 },
      weaponCategory: null,
      weaponItemKey: null,
      weaponEnhancementTier: 0,
      armor: { Upper: null, Lower: null, Glove: null, Shield: null },
      weaponProficiencyLevel: 0,
      openPicker: null, // null | "weapon" | "Upper" | "Lower" | "Glove" | "Shield"
      gearSearch: "",
    },
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="toolbar" id="characterTabBar" style="margin-bottom:14px;"></div>
      <div id="characterTabContent"></div>
    `;
    container.appendChild(wrap);
    this.renderTabBar();
    this.renderActiveTab();
  },

  renderTabBar() {
    const el = document.getElementById("characterTabBar");
    const tabs = [
      ["characters", "Characters"],
      ["partners", "Partners"],
      ["customization", "Customization"],
      ["player", "Player"],
    ];
    el.innerHTML = tabs.map(([key, label]) =>
      `<button class="toggle-btn${this.state.activeTab === key ? " active" : ""}" data-tab="${key}">${label}</button>`
    ).join("");
    el.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.activeTab = btn.dataset.tab;
        this.renderTabBar();
        this.renderActiveTab();
      });
    });
  },

  renderActiveTab() {
    const container = document.getElementById("characterTabContent");
    container.innerHTML = "";
    if (this.state.activeTab === "characters") {
      this.renderCharactersTab(container);
    } else if (this.state.activeTab === "partners") {
      this.renderPartnersTab(container);
    } else if (this.state.activeTab === "player") {
      this.renderPlayerTab(container);
    } else {
      this.renderCustomizationTab(container);
    }
    // Re-trigger the fade-in animation -- see asset-inspector.js's
    // renderActiveMainTab() for why the remove/reflow/re-add sequence
    // is needed rather than just adding the class once.
    container.classList.remove("tab-content-fade-in");
    void container.offsetWidth;
    container.classList.add("tab-content-fade-in");
  },

  // ============================================================
  // Characters tab: full 22-entry roster
  // ============================================================

  renderCharactersTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="charQuickCoverage"></div>
      <div class="toolbar" id="charToolbar"></div>
      <div class="equip-layout" style="grid-template-columns: 360px 1fr;">
        <div id="charListPane"></div>
        <div id="charDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    const all = DataStore.getAllCharactersFlat();
    const namedCount = all.filter((c) => DataStore.isCharacterNameVerified(c)).length;
    document.getElementById("charQuickCoverage").innerHTML = `
      <span><b>${all.length}</b> characters loaded</span>
      <span><b>${namedCount}</b>/${all.length} names verified</span>
      <span style="margin-left:auto; opacity:0.6;">All entries unlock via story progress, none via simple pickup — see Data Coverage</span>
    `;

    document.getElementById("charToolbar").innerHTML = `
      <input type="text" class="search-input" id="charSearchInput" placeholder="Search by name or code..." />
    `;
    document.getElementById("charSearchInput").addEventListener("input", (e) => {
      this.state.charSearch = e.target.value;
      this.renderCharList();
    });

    this.renderCharList();
    this.renderCharDetail();
  },

  getFilteredCharacters() {
    let items = DataStore.getAllCharactersFlat();
    const q = (this.state.charSearch || "").trim().toLowerCase();
    if (q) {
      items = items.filter((c) =>
        DataStore.getCharacterDisplayName(c).toLowerCase().includes(q) ||
        (c.code || "").toLowerCase().includes(q)
      );
    }
    return items;
  },

  renderCharList() {
    const pane = document.getElementById("charListPane");
    const items = this.getFilteredCharacters();
    if (items.length === 0) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No characters match.</p></div></div>`;
      return;
    }
    const list = document.createElement("div");
    items.forEach((c) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (c.titleKey === this.state.selectedTitleKey ? " selected" : "");
      const verified = DataStore.isCharacterNameVerified(c);
      row.innerHTML = `
        <span class="wl-name">${escapeHtml(DataStore.getCharacterDisplayName(c))}</span>
        ${c.isPartner ? '<span class="pill verified" title="Has a 200-level Partner stat table">Partner</span>' : ""}
        ${!verified ? '<span class="pill unverified">unnamed</span>' : ""}
        <span class="wl-id">${escapeHtml(c.code || "")}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedTitleKey = c.titleKey;
        this.renderCharList();
        this.renderCharDetail();
      });
      list.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedTitleKey || !items.find((c) => c.titleKey === this.state.selectedTitleKey)) {
      this.state.selectedTitleKey = items[0].titleKey;
      this.renderCharDetail();
    }
  },

  renderCharDetail() {
    const detailPane = document.getElementById("charDetailPane");
    const character = DataStore.characterByTitleKey[this.state.selectedTitleKey];
    if (!character) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a character</p></div></div>`;
      return;
    }
    const verified = DataStore.isCharacterNameVerified(character);
    const displayName = DataStore.getCharacterDisplayName(character);
    const description = DataStore.getCharacterDescription(character);
    const descVerified = DataStore.isCharacterDescriptionVerified(character);

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Character Preview</h3>
        <div class="empty-state" style="padding:30px 10px 16px;">
          <div class="empty-icon">🎮</div>
          <p style="font-size:12px;">
            Shown in-game as a live rotating 3D model, the same presentation as Monsters — no
            static image exists for any of the 22 characters in this export.
          </p>
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${escapeHtml(character.titleKey)} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified — no localization found</span>'}</div>

        ${description ? `
          <div class="item-description${descVerified ? "" : " unverified-desc"}">${escapeHtml(description)}</div>
        ` : ""}

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.7;">
          <div>Code: ${escapeHtml(character.code || "—")}</div>
          <div title="Every Character database entry unlocks via story progress (SubProgress/MainProgress), never a simple pickup — the numeric value is an internal quest/progress ID with no further context in this export to decode.">
            Unlock condition: ${escapeHtml(character.unlockCondition || "—")}
            ${character.unlockConditionValue != null ? `(ID ${character.unlockConditionValue})` : ""}
          </div>
        </div>

        ${character.isPartner ? `
          <div class="mod-callout" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Also a Partner</div>
            <div class="mod-effect-line">
              Has a 200-level stat growth table — see the Partners tab for the interactive level
              slider.
            </div>
          </div>
        ` : ""}
        ${!verified ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No name found</div>
            <div class="mod-effect-line">
              This row exists in the database (code "${escapeHtml(character.code || "")}") but has no
              matching name string in any of the 13 language files in this export.
            </div>
          </div>
        ` : ""}
      </div>
    `;
  },

  // ============================================================
  // Partners tab: the 7 with a stat table + interactive level slider
  // ============================================================

  renderPartnersTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="partnerQuickCoverage"></div>
      <div class="equip-layout" style="grid-template-columns: 280px 1fr;">
        <div id="partnerListPane"></div>
        <div id="partnerDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    const partners = DataStore.getPartnersFlat();
    document.getElementById("partnerQuickCoverage").innerHTML = `
      <span><b>${partners.length}</b> partners loaded</span>
      <span><b>200</b> levels each, full stat table confirmed</span>
      <span style="margin-left:auto; opacity:0.6;">No Skills or weapon-type data exists for any partner in this export — see Data Coverage</span>
    `;

    if (!this.state.selectedPartnerCode || !partners.find((p) => p.code === this.state.selectedPartnerCode)) {
      this.state.selectedPartnerCode = partners[0] ? partners[0].code : null;
    }

    this.renderPartnerList();
    this.renderPartnerDetail();
  },

  /**
   * Only rebuilds the list pane (to update the .selected highlight) --
   * never the toolbar/coverage banner, and never relies on guessing at
   * a parent container the way an earlier version of this function
   * did. Selecting a different partner calls this + renderPartnerDetail()
   * directly, the same split every other browser view in this app uses
   * between its list pane and detail pane.
   */
  renderPartnerList() {
    const listPane = document.getElementById("partnerListPane");
    const partners = DataStore.getPartnersFlat();
    const list = document.createElement("div");
    partners.forEach((p) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (p.code === this.state.selectedPartnerCode ? " selected" : "");
      row.innerHTML = `
        ${p.hasPartnerThumbnail
          ? `<span class="wl-icon"><img src="${p.textures.partnerThumbnail}" alt="" loading="lazy" /></span>`
          : ""}
        <span class="wl-name">${escapeHtml(DataStore.getCharacterDisplayName(p))}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedPartnerCode = p.code;
        this.state.partnerLevel = 1;
        this.renderPartnerList();
        this.renderPartnerDetail();
      });
      list.appendChild(row);
    });
    listPane.innerHTML = "";
    listPane.appendChild(list);
  },

  renderPartnerDetail() {
    const detailPane = document.getElementById("partnerDetailPane");
    const code = this.state.selectedPartnerCode;
    const partner = DataStore.getPartnersFlat().find((p) => p.code === code);
    if (!partner) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a partner</p></div></div>`;
      return;
    }

    const displayName = DataStore.getCharacterDisplayName(partner);
    const description = DataStore.getCharacterDescription(partner);
    const level = this.state.partnerLevel;
    const stats = DataStore.getPartnerStatsAtLevel(code, level) || {};
    const statKeys = ["Defence", "Vitality", "Mind", "Endurance", "Strength", "Dexterity", "Agility", "Intelligence"];

    const weaponName = DataStore.getPartnerWeaponName(partner);
    const weaponLabel = partner.weapon ? partner.weapon.weaponCategoryLabel : null;
    const combo = DataStore.getPartnerSkillInfo(partner, "combo");
    const support = DataStore.getPartnerSkillInfo(partner, "support");

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">${escapeHtml(displayName)}</h3>
        ${partner.hasPartnerThumbnail ? `
          <div class="preview-img-wrap" style="width:96px; height:96px; margin:0 auto 12px;">
            <img src="${partner.textures.partnerThumbnail}" alt="" />
          </div>
        ` : ""}
        ${description ? `<div class="item-description">${escapeHtml(description)}</div>` : ""}

        ${weaponName ? `
          <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.7;">
            <div>Weapon: <b style="color:var(--hud-text);">${escapeHtml(weaponName)}</b> (${escapeHtml(weaponLabel || "")})</div>
          </div>
        ` : ""}

        <div class="enhancement-slider-wrap" style="width:100%; margin-top:16px;">
          <div class="slider-label">
            <span>Level</span>
            <span class="plus-val" id="partnerLevelVal">${level}</span>
          </div>
          <input type="range" min="1" max="200" step="1" value="${level}" id="partnerLevelSlider" />
        </div>
      </div>

      ${(combo || support) ? `
        <div class="hud-panel" style="margin-top:14px;">
          <h3>Combat Skills</h3>
          ${combo ? `
            <div class="mod-callout${combo.verified ? "" : " unresolved"}" style="width:100%; text-align:left;">
              <div class="mod-name">Combination Slash: ${escapeHtml(combo.name)}${!combo.verified ? ' <span class="pill unverified">unverified name</span>' : ""}</div>
              ${combo.description ? `<div class="mod-description">${escapeHtml(combo.description)}</div>` : ""}
              <div class="mod-effect-line">Cost: ${combo.pointCost} CoS Points</div>
            </div>
          ` : ""}
          ${support ? `
            <div class="mod-callout${support.verified ? "" : " unresolved"}" style="width:100%; text-align:left; margin-top:${combo ? "10px" : "0"};">
              <div class="mod-name">Support Skill: ${escapeHtml(support.name)}${!support.verified ? ' <span class="pill unverified">unverified name</span>' : ""}</div>
              ${support.description ? `<div class="mod-description">${escapeHtml(support.description)}</div>` : ""}
              <div class="mod-effect-line">Cost: ${support.pointCost} Support SP — up to ${support.maxStack} stack${support.maxStack === 1 ? "" : "s"}</div>
            </div>
          ` : ""}
        </div>
      ` : `
        <div class="hud-panel" style="margin-top:14px;">
          <div class="empty-state" style="padding:16px 10px;">
            <p style="font-size:12px;">No Combination Slash or Support Skill exists for this partner anywhere in this export — confirmed by checking the relevant tables directly, not assumed from absence at a glance.</p>
          </div>
        </div>
      `}

      <div class="hud-panel" style="margin-top:14px;">
        <h3>Stats at Level <span id="partnerLevelTableLabel">${level}</span></h3>
        <table class="acv-table">
          <thead><tr><th>Stat</th><th>Value</th></tr></thead>
          <tbody id="partnerStatsBody">
            ${statKeys.map((k) => `
              <tr>
                <td>${k}</td>
                <td class="contrib" id="partnerStat-${k}">${stats[k] ?? "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    const slider = document.getElementById("partnerLevelSlider");
    if (slider) {
      slider.addEventListener("input", (e) => {
        this.state.partnerLevel = parseInt(e.target.value, 10);
        this.updatePartnerLevelDisplay(code);
      });
    }
  },

  /**
   * Patches only the level number and stat table cells -- never
   * touches innerHTML of the slider itself, mirroring
   * WeaponsBrowserView.updateLiveValues() exactly, so dragging the
   * level slider stays smooth and never steals focus.
   */
  updatePartnerLevelDisplay(code) {
    const level = this.state.partnerLevel;
    const stats = DataStore.getPartnerStatsAtLevel(code, level) || {};

    const levelVal = document.getElementById("partnerLevelVal");
    if (levelVal) levelVal.textContent = level;
    const tableLabel = document.getElementById("partnerLevelTableLabel");
    if (tableLabel) tableLabel.textContent = level;

    for (const k of ["Defence", "Vitality", "Mind", "Endurance", "Strength", "Dexterity", "Agility", "Intelligence"]) {
      const cell = document.getElementById(`partnerStat-${k}`);
      if (cell) cell.textContent = stats[k] ?? "—";
    }
  },

  // ============================================================
  // Customization tab: avatar parts/colors/voices/presets
  // ============================================================

  renderCustomizationTab(container) {
    const data = DataStore.avatarCustomize;
    if (!data) {
      container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No customization data loaded.</p></div></div>`;
      return;
    }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${Object.values(data.parts).reduce((s, p) => s + p.count, 0)}</b> part swatches</span>
        <span><b>${Object.values(data.colorPalettes).reduce((s, p) => s + p.count, 0)}</b> color swatches</span>
        <span><b>${data.voices.length}</b> voices</span>
        <span><b>${data.presets.length}</b> presets</span>
        <span style="margin-left:auto; opacity:0.6;">No name field exists anywhere in this data — selected visually, not by label</span>
      </div>
      <div class="toolbar" id="customizeCategoryBar" style="margin:12px 0;"></div>
      <div id="customizeContent"></div>
    `;
    container.appendChild(wrap);

    const categories = [
      ...Object.entries(data.parts).map(([key, p]) => [key, p.label, "parts"]),
      ...Object.entries(data.colorPalettes).map(([key, p]) => [key, p.label + " Colors", "colors"]),
      ["voices", "Voices", "voices"],
      ["presets", "Presets", "presets"],
    ];

    const bar = document.getElementById("customizeCategoryBar");
    bar.innerHTML = categories.map(([key, label]) =>
      `<button class="toggle-btn${this.state.customizeCategory === key ? " active" : ""}" data-cat="${key}">${escapeHtml(label)}</button>`
    ).join("");
    bar.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.customizeCategory = btn.dataset.cat;
        this.renderActiveTab();
      });
    });

    this.renderCustomizeContent(data);
  },

  renderCustomizeContent(data) {
    const el = document.getElementById("customizeContent");
    const cat = this.state.customizeCategory;

    if (data.parts[cat]) {
      const part = data.parts[cat];
      el.innerHTML = `
        <div class="hud-panel">
          <h3>${escapeHtml(part.label)} (${part.count})</h3>
          <div class="weapon-grid">
            ${part.items.map((item, i) => `
              <div class="weapon-tile scan-frame-sm" style="cursor:${item.textures.thumbnail ? "pointer" : "default"};" data-part-index="${i}">
                ${item.textures.thumbnail
                  ? `<img src="${item.textures.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none';" />`
                  : `<div class="empty-state" style="padding:8px;"><p style="font-size:10px;">#${item.id}</p></div>`}
              </div>
            `).join("")}
          </div>
        </div>
      `;
      el.querySelectorAll("[data-part-index]").forEach((tile) => {
        const item = part.items[Number(tile.dataset.partIndex)];
        if (!item.textures.thumbnail) return; // nothing to zoom into for an item with no thumbnail at all
        tile.addEventListener("click", () => {
          openIconZoom({
            itemKey: `${part.label} #${item.id}`,
            rank: null,
            textures: { icon: item.textures.thumbnail, categoryPlaceholderRender: item.textures.thumbnail },
          }, `${part.label} #${item.id}`);
        });
      });
      return;
    }

    if (data.colorPalettes[cat]) {
      const pal = data.colorPalettes[cat];
      el.innerHTML = `
        <div class="hud-panel">
          <h3>${escapeHtml(pal.label)} Colors (${pal.count})</h3>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${pal.items.map((c) => `
              <div title="#${escapeHtml(c.mainColorHex || "")}" style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                <div style="width:36px; height:36px; border-radius:50%; border:2px solid rgba(255,255,255,0.2); background:#${escapeHtml(c.mainColorHex || "888")};"></div>
                <span style="font-size:9px; opacity:0.6; font-family:var(--font-mono);">${c.id}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
      return;
    }

    if (cat === "voices") {
      el.innerHTML = `
        <div class="hud-panel">
          <h3>Voices (${data.voices.length})</h3>
          <p style="font-size:12px; color:var(--hud-text-dim); margin-top:0;">
            No voice name resolves anywhere in this export (the LocalizeKey field is present but
            doesn't match a string in any of the 13 language files) — shown by raw ID and the
            internal switch name instead.
          </p>
          <table class="acv-table">
            <thead><tr><th>ID</th><th>Switch Name</th></tr></thead>
            <tbody>
              ${data.voices.map((v) => `<tr><td>${v.id}</td><td>${escapeHtml(v.switchName || "—")}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      `;
      return;
    }

    if (cat === "presets") {
      el.innerHTML = `
        <div class="hud-panel">
          <h3>Presets (${data.presets.length})</h3>
          <div class="weapon-grid">
            ${data.presets.map((p, i) => `
              <div class="weapon-tile scan-frame-sm" style="cursor:${p.textures.thumbnail ? "pointer" : "default"};" title="${escapeHtml(p.bodyType || "")}" data-preset-index="${i}">
                ${p.textures.thumbnail
                  ? `<img src="${p.textures.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none';" />`
                  : `<div class="empty-state" style="padding:8px;"><p style="font-size:10px;">#${p.presetId}</p></div>`}
              </div>
            `).join("")}
          </div>
        </div>
      `;
      el.querySelectorAll("[data-preset-index]").forEach((tile) => {
        const p = data.presets[Number(tile.dataset.presetIndex)];
        if (!p.textures.thumbnail) return;
        tile.addEventListener("click", () => {
          openIconZoom({
            itemKey: `Preset #${p.presetId}${p.bodyType ? ` (${p.bodyType})` : ""}`,
            rank: null,
            textures: { icon: p.textures.thumbnail, categoryPlaceholderRender: p.textures.thumbnail },
          }, `Preset #${p.presetId}`);
        });
      });
    }
  },

  // ============================================================
  // Player tab: a build simulator, not a save-file viewer -- level,
  // stat allocation, and equipped gear are all freely chosen by the
  // user (there is no player save data anywhere in this export), the
  // same way the Weapons section's enhancement slider lets you try
  // any tier rather than reading one from a save. Reuses the existing,
  // already-verified ACV/ATK engine (acv-engine.js) directly rather
  // than inventing a parallel formula -- Total ATK here is computed by
  // the exact same simulateTotalATK() the Weapons section's own
  // calculator uses, just fed the player's own allocated STR/DEX/AGI/
  // INT instead of the Weapons page's free-standing test inputs.
  //
  // Visual layout is deliberately NOT a literal recreation of the
  // in-game circular/radial character sheet -- it's restructured into
  // this project's existing flat HUD-panel idiom (the same one every
  // other detail pane already uses), while preserving the SAME grouped
  // information architecture the reference screenshot shows: a cream
  // name+level header, HP/Stamina/SP bars, ATK/DEF flanking the 7
  // allocatable stats, and a Growth Points summary. See DESIGN.md for
  // the full reasoning.
  //
  // Two confidence tiers are deliberately visible side by side here,
  // not blended into one undifferentiated number:
  //   - ATK/DEF: fully confirmed (the same ACV/ATK system validated
  //     against 3 screenshots months ago, plus this user's own
  //     screenshot -- DEX=37 + Annealed Blade +4 + EX-MOD ATK+35 ->
  //     292 -- is the EXACT case already in acv-engine.js's own
  //     docstring).
  //   - HP/Stamina/SP: confirmed AT FLOOR STATS ONLY (this user's
  //     screenshot independently matches all three simultaneously at
  //     VIT/END/MND=1), but the curve's behavior at higher stat values
  //     is an extrapolation, not independently screenshot-verified --
  //     labeled as such in the UI, not presented with equal confidence
  //     to ATK/DEF.
  // ============================================================

  PLAYER_ALLOCATABLE_STATS: ["STR", "DEX", "AGI", "INT", "VIT", "END", "MND"],
  PLAYER_VITAL_CURVE_KEY: { VIT: "MaxHealth", END: "MaxStamina", MND: "MaxSoul" },
  PLAYER_ARMOR_SLOTS: ["Upper", "Lower", "Glove", "Shield"],

  /**
   * Linear interpolation across a sparse {time,value} keyframe array,
   * matching UE's own RCIM_Linear interpolation mode (confirmed as the
   * InterpMode on every curve PlayerConfig.json carries) -- clamped to
   * the first/last keyframe's value outside the defined range, the
   * same RCCE_Constant extrapolation the raw curve data itself
   * specifies, not a guessed clamp behavior.
   */
  interpolateCurve(keys, x) {
    if (!keys || keys.length === 0) return 0;
    if (x <= keys[0].time) return keys[0].value;
    if (x >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (x >= a.time && x <= b.time) {
        const t = (x - a.time) / (b.time - a.time);
        return a.value + (b.value - a.value) * t;
      }
    }
    return keys[keys.length - 1].value;
  },

  getPlayerGrowPointsTotal() {
    const cfg = DataStore.playerConfig;
    if (!cfg) return 0;
    const level = this.state.player.level;
    return cfg.growPointsCumulativeByLevel[level] ?? cfg.growPointsCumulativeByLevel[cfg.growPointsCumulativeByLevel.length - 1];
  },

  getPlayerGrowPointsSpent() {
    const alloc = this.state.player.allocated;
    return this.PLAYER_ALLOCATABLE_STATS.reduce((sum, stat) => sum + (alloc[stat] - 1), 0);
  },

  getPlayerGrowPointsRemaining() {
    return this.getPlayerGrowPointsTotal() - this.getPlayerGrowPointsSpent();
  },

  computePlayerVitals() {
    const cfg = DataStore.playerConfig;
    const alloc = this.state.player.allocated;
    const result = {};
    for (const [stat, curveKey] of Object.entries(this.PLAYER_VITAL_CURVE_KEY)) {
      const curve = cfg?.growthParamCurves?.[stat] || [];
      result[curveKey] = Math.round(this.interpolateCurve(curve, alloc[stat]));
    }
    return result; // { MaxHealth, MaxStamina, MaxSoul }
  },

  computePlayerCombat() {
    const player = this.state.player;
    const weapon = player.weaponItemKey ? DataStore.weaponsByItemKey[player.weaponItemKey] : null;
    let atkResult = { total: 0, baseATK: 0, acv: 0, acvBreakdown: null };
    if (weapon && App.abilityMultiplierTable) {
      const tier = Math.min(player.weaponEnhancementTier, (weapon.enhancement.baseWeaponATK.length || 1) - 1);
      atkResult = simulateTotalATK({
        weapon,
        enhancementTier: tier,
        abilities: { STR: player.allocated.STR, DEX: player.allocated.DEX, AGI: player.allocated.AGI, INT: player.allocated.INT },
        multiplierTable: App.abilityMultiplierTable,
      });
    }

    let defTotal = 0;
    let hasNullDefPiece = false;
    let equippedCount = 0;
    for (const slot of this.PLAYER_ARMOR_SLOTS) {
      const key = player.armor[slot];
      if (!key) continue;
      equippedCount++;
      const armor = DataStore.armorByItemKey[key];
      if (!armor) continue;
      if (armor.def == null) hasNullDefPiece = true;
      else defTotal += armor.def;
    }

    return { weapon, atkResult, defTotal, hasNullDefPiece, equippedCount };
  },

  renderPlayerTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="playerQuickCoverage"></div>
      <div class="equip-layout" style="grid-template-columns: 1fr 380px;">
        <div id="playerStatsPane"></div>
        <div id="playerGearPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    document.getElementById("playerQuickCoverage").innerHTML = `
      <span>A build simulator — level, stats, and gear are freely chosen, not read from a save file (none exists in this export)</span>
      <span style="margin-left:auto; opacity:0.6;">ATK/DEF reuse the same verified engine as Weapons/Armor — see Data Coverage for HP/Stamina/SP confidence</span>
    `;

    this.renderPlayerStatsPane();
    this.renderPlayerGearPane();
  },

  renderPlayerStatsPane() {
    const pane = document.getElementById("playerStatsPane");
    if (!pane) return;
    const cfg = DataStore.playerConfig;
    const player = this.state.player;
    const maxLevel = cfg ? cfg.maxLevel : 200;
    const vitals = this.computePlayerVitals();
    const remaining = this.getPlayerGrowPointsRemaining();

    pane.innerHTML = `
      <div class="hud-panel weapon-preview" style="align-items:stretch;">
        <div class="player-header-bar">
          <input type="text" class="player-name-input" id="playerNameInput" value="${escapeHtml(player.name)}" maxlength="20" />
          <span class="player-level-badge">Lv. <span id="playerLevelVal">${player.level}</span></span>
        </div>

        <div class="player-vital-row hp">
          <img src="Content/ROD/Widget/Console/Gauge/GaugeTexture/T_Mainmenu_Hero_HPicon.png" alt="" onerror="this.style.visibility='hidden';" />
          <span class="player-vital-label">HP</span>
          <span class="player-vital-bar-wrap"><span class="player-vital-bar-fill" style="width:100%;"></span></span>
          <span class="player-vital-value" id="playerHpVal">${vitals.MaxHealth}/${vitals.MaxHealth}</span>
        </div>
        <div class="player-vital-row stamina">
          <img src="Content/ROD/Widget/Console/Gauge/GaugeTexture/T_Mainmenu_Hero_Staminaicon.png" alt="" onerror="this.style.visibility='hidden';" />
          <span class="player-vital-label">Stamina</span>
          <span class="player-vital-bar-wrap"><span class="player-vital-bar-fill" style="width:100%;"></span></span>
          <span class="player-vital-value" id="playerStaminaVal">${vitals.MaxStamina}/${vitals.MaxStamina}</span>
        </div>
        <div class="player-vital-row sp">
          <img src="Content/ROD/Widget/Console/Gauge/GaugeTexture/T_Mainmenu_Hero_Soulicon.png" alt="" onerror="this.style.visibility='hidden';" />
          <span class="player-vital-label">SP</span>
          <span class="player-vital-bar-wrap"><span class="player-vital-bar-fill" style="width:100%;"></span></span>
          <span class="player-vital-value" id="playerSpVal">${vitals.MaxSoul}/${vitals.MaxSoul}</span>
        </div>
        <div style="font-size:10px; color:var(--hud-text-dim); margin:-4px 0 6px;">
          HP/Stamina/SP confirmed at floor stats against your screenshot — values away from floor are a data-grounded extrapolation, not independently verified. See Data Coverage.
        </div>

        <div class="player-atk-def-row">
          <div class="atk-block">
            <img src="Content/ROD/Widget/Console/Texture/T_Mainmenu_Hero_ATK.png" alt="" style="width:20px;height:20px;" onerror="this.style.display='none';" />
            <div class="val" id="playerAtkVal">0</div>
            <div class="lbl">ATK</div>
          </div>
          <div class="def-block">
            <img src="Content/ROD/Widget/Console/Texture/T_Mainmenu_Hero_DEF.png" alt="" style="width:20px;height:20px;" onerror="this.style.display='none';" />
            <div class="val" id="playerDefVal">0</div>
            <div class="lbl">DEF</div>
          </div>
        </div>
        <div style="font-size:10px; color:var(--hud-text-dim); margin:-10px 0 6px; text-align:center;" id="playerDefNote"></div>

        <div class="player-gp-banner">
          <img src="Content/ROD/Widget/Console/MainMenu/Texture/T_ItemCategoryIcon_GrowthPoint.png" alt="" onerror="this.style.display='none';" />
          <span>Growth Points</span>
          <span class="gp-remaining ${remaining > 0 ? "positive" : "zero"}" id="playerGpRemaining">${remaining}/${this.getPlayerGrowPointsTotal()} unspent</span>
        </div>

        <div class="player-stat-grid">
          ${this.PLAYER_ALLOCATABLE_STATS.map((stat) => `
            <div class="player-stat-row">
              <span class="player-stat-name">${stat}</span>
              <div class="player-stat-controls">
                <button class="gp-stat-btn" data-stat="${stat}" data-delta="-1" ${player.allocated[stat] <= 1 ? "disabled" : ""}>−</button>
                <span class="player-stat-value" id="playerStatVal-${stat}">${player.allocated[stat]}</span>
                <button class="gp-stat-btn" data-stat="${stat}" data-delta="1" ${remaining <= 0 ? "disabled" : ""}>+</button>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="enhancement-slider-wrap" style="width:100%;">
          <div class="slider-label">
            <span>Level</span>
            <span class="plus-val" id="playerLevelSliderVal">${player.level}</span>
          </div>
          <input type="range" min="1" max="${maxLevel}" step="1" value="${player.level}" id="playerLevelSlider" />
        </div>

        <div class="enhancement-slider-wrap" style="width:100%;" title="Real curve data exists for this, but nothing in this export confirms what earns these points or that they affect ATK/DEF — informational only, not wired into any total.">
          <div class="slider-label">
            <span>Weapon Proficiency <span style="opacity:0.55; font-weight:400;">(informational — not wired into ATK, see Data Coverage)</span></span>
            <span class="plus-val" id="playerProficiencyVal">${player.weaponProficiencyLevel}</span>
          </div>
          <input type="range" min="0" max="${(cfg?.weaponProficiencyThresholds?.length || 1) - 1}" step="1" value="${player.weaponProficiencyLevel}" id="playerProficiencySlider" />
        </div>
      </div>
    `;

    document.getElementById("playerNameInput").addEventListener("input", (e) => {
      this.state.player.name = e.target.value || "Player";
    });
    document.getElementById("playerLevelSlider").addEventListener("input", (e) => {
      this.state.player.level = parseInt(e.target.value, 10);
      this.updatePlayerLiveValues();
    });
    document.getElementById("playerProficiencySlider").addEventListener("input", (e) => {
      this.state.player.weaponProficiencyLevel = parseInt(e.target.value, 10);
      const val = document.getElementById("playerProficiencyVal");
      if (val) val.textContent = this.state.player.weaponProficiencyLevel;
    });
    pane.querySelectorAll(".gp-stat-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.adjustPlayerStat(btn.dataset.stat, parseInt(btn.dataset.delta, 10));
      });
    });

    this.updatePlayerLiveValues();
  },

  /**
   * Patches only the numbers/disabled-states that depend on level,
   * allocated stats, and equipped gear -- mirrors
   * WeaponsBrowserView.updateLiveValues() and the Partner level
   * slider's updatePartnerLevelDisplay() exactly, so dragging the
   * level slider or clicking a stat button never re-runs innerHTML on
   * the whole pane (which would lose focus / feel jumpy).
   */
  updatePlayerLiveValues() {
    const player = this.state.player;
    const levelVal = document.getElementById("playerLevelVal");
    if (levelVal) levelVal.textContent = player.level;
    const levelSliderVal = document.getElementById("playerLevelSliderVal");
    if (levelSliderVal) levelSliderVal.textContent = player.level;

    const vitals = this.computePlayerVitals();
    const hpVal = document.getElementById("playerHpVal");
    if (hpVal) hpVal.textContent = `${vitals.MaxHealth}/${vitals.MaxHealth}`;
    const staminaVal = document.getElementById("playerStaminaVal");
    if (staminaVal) staminaVal.textContent = `${vitals.MaxStamina}/${vitals.MaxStamina}`;
    const spVal = document.getElementById("playerSpVal");
    if (spVal) spVal.textContent = `${vitals.MaxSoul}/${vitals.MaxSoul}`;

    const combat = this.computePlayerCombat();
    const atkVal = document.getElementById("playerAtkVal");
    if (atkVal) atkVal.textContent = combat.atkResult.total;
    const defVal = document.getElementById("playerDefVal");
    if (defVal) defVal.textContent = combat.defTotal;
    const defNote = document.getElementById("playerDefNote");
    if (defNote) {
      if (combat.hasNullDefPiece) {
        defNote.textContent = "An equipped Shield has no flat Def value in this export (real — only its Unique MOD effects, not shown here)";
      } else if (combat.equippedCount === 0) {
        defNote.textContent = "No armor equipped";
      } else {
        defNote.textContent = "";
      }
    }

    for (const stat of this.PLAYER_ALLOCATABLE_STATS) {
      const cell = document.getElementById(`playerStatVal-${stat}`);
      if (cell) cell.textContent = player.allocated[stat];
    }
    const remaining = this.getPlayerGrowPointsRemaining();
    const total = this.getPlayerGrowPointsTotal();
    const gpEl = document.getElementById("playerGpRemaining");
    if (gpEl) {
      gpEl.textContent = `${remaining}/${total} unspent`;
      gpEl.className = `gp-remaining ${remaining > 0 ? "positive" : "zero"}`;
    }
    // Disabled-state on +/- buttons needs a real re-render of just
    // those buttons' attributes, not just text -- cheap, since it's
    // only 14 small buttons, not the whole pane.
    document.querySelectorAll(".gp-stat-btn").forEach((btn) => {
      const stat = btn.dataset.stat;
      const delta = parseInt(btn.dataset.delta, 10);
      if (delta < 0) btn.disabled = player.allocated[stat] <= 1;
      else btn.disabled = remaining <= 0;
    });
  },

  adjustPlayerStat(stat, delta) {
    const player = this.state.player;
    if (delta > 0 && this.getPlayerGrowPointsRemaining() <= 0) return;
    if (delta < 0 && player.allocated[stat] <= 1) return;
    player.allocated[stat] = Math.max(1, player.allocated[stat] + delta);
    this.updatePlayerLiveValues();
  },

  renderPlayerGearPane() {
    const pane = document.getElementById("playerGearPane");
    if (!pane) return;
    const player = this.state.player;
    const weapon = player.weaponItemKey ? DataStore.weaponsByItemKey[player.weaponItemKey] : null;

    const weaponSlotHtml = `
      <div class="player-gear-slot ${player.openPicker === "weapon" ? "active" : ""}" data-slot="weapon">
        <div class="gear-slot-icon">
          ${weapon ? `<img src="${weapon.textures.iconSmall}" alt="" onerror="this.style.display='none';" />` : ""}
        </div>
        <div class="gear-slot-info">
          <div class="gear-slot-label">Weapon</div>
          <div class="gear-slot-name ${weapon ? "" : "empty"}">${weapon ? escapeHtml(DataStore.getDisplayName(weapon.itemKey)) : "Select a weapon..."}</div>
        </div>
      </div>
      ${player.openPicker === "weapon" ? this.renderGearPickerHtml("weapon") : ""}
      ${weapon ? `
        <div class="enhancement-slider-wrap" style="width:100%; margin-top:-2px;">
          <div class="slider-label">
            <span>Enhancement</span>
            <span class="plus-val" id="playerEnhVal">+${player.weaponEnhancementTier}</span>
          </div>
          <input type="range" min="0" max="${(weapon.enhancement.baseWeaponATK.length || 1) - 1}" step="1" value="${player.weaponEnhancementTier}" id="playerEnhSlider" />
        </div>
      ` : ""}
    `;

    const armorSlotsHtml = this.PLAYER_ARMOR_SLOTS.map((slot) => {
      const key = player.armor[slot];
      const armor = key ? DataStore.armorByItemKey[key] : null;
      return `
        <div class="player-gear-slot ${player.openPicker === slot ? "active" : ""}" data-slot="${slot}">
          <div class="gear-slot-icon">
            ${armor ? `<img src="${armor.textures.icon || armor.textures.iconMale || ""}" alt="" onerror="this.style.display='none';" />` : ""}
          </div>
          <div class="gear-slot-info">
            <div class="gear-slot-label">${slot}${slot === "Shield" ? "" : " Armor"}</div>
            <div class="gear-slot-name ${armor ? "" : "empty"}">${armor ? escapeHtml(DataStore.getDisplayName(armor.itemKey)) : "None equipped"}</div>
          </div>
        </div>
        ${player.openPicker === slot ? this.renderGearPickerHtml(slot) : ""}
      `;
    }).join("");

    pane.innerHTML = `
      <div class="hud-panel">
        <h3>Equipped Gear</h3>
        ${weaponSlotHtml}
        ${armorSlotsHtml}
      </div>
    `;

    pane.querySelectorAll(".player-gear-slot").forEach((row) => {
      row.addEventListener("click", () => {
        const slot = row.dataset.slot;
        player.openPicker = player.openPicker === slot ? null : slot;
        player.gearSearch = "";
        this.renderPlayerGearPane();
      });
    });
    const enhSlider = document.getElementById("playerEnhSlider");
    if (enhSlider) {
      enhSlider.addEventListener("click", (e) => e.stopPropagation());
      enhSlider.addEventListener("input", (e) => {
        player.weaponEnhancementTier = parseInt(e.target.value, 10);
        const v = document.getElementById("playerEnhVal");
        if (v) v.textContent = `+${player.weaponEnhancementTier}`;
        this.updatePlayerLiveValues();
      });
    }
    this.bindGearPickerEvents();
  },

  /**
   * Builds the inline search+list picker for a single slot. Weapon
   * search spans every category at once via getAllWeaponsFlat()
   * (matching how the Weapons section itself lets you browse across
   * categories); each armor slot only searches its own category's
   * list, since Upper gear can't go in the Lower slot.
   */
  renderGearPickerHtml(slot) {
    const player = this.state.player;
    let items;
    if (slot === "weapon") {
      items = DataStore.getAllWeaponsFlat();
    } else {
      items = DataStore.armorByCategory[slot] || [];
    }
    const q = (player.gearSearch || "").trim().toLowerCase();
    if (q) {
      items = items.filter((it) => DataStore.getDisplayName(it.itemKey).toLowerCase().includes(q) || it.itemKey.toLowerCase().includes(q));
    }
    const selectedKey = slot === "weapon" ? player.weaponItemKey : player.armor[slot];

    return `
      <div class="gear-picker-panel" data-picker-slot="${slot}">
        <input type="text" class="search-input" id="gearPickerSearch" placeholder="Search by name or key..." value="${escapeHtml(player.gearSearch)}" style="width:100%;" />
        <div class="gear-picker-list">
          ${slot !== "weapon" ? `
            <div class="gear-picker-row ${!selectedKey ? "selected" : ""}" data-clear="1">
              <span style="width:26px; text-align:center; opacity:0.5;">—</span>
              <span style="font-style:italic; opacity:0.7;">None equipped</span>
            </div>
          ` : ""}
          ${items.length === 0 ? `<div style="padding:10px; font-size:11px; opacity:0.6;">No matches.</div>` : items.map((it) => `
            <div class="gear-picker-row ${it.itemKey === selectedKey ? "selected" : ""}" data-item-key="${escapeHtml(it.itemKey)}">
              <img src="${it.textures.iconSmall || it.textures.icon || it.textures.iconMale || ""}" alt="" onerror="this.style.visibility='hidden';" />
              <span>${escapeHtml(DataStore.getDisplayName(it.itemKey))}</span>
              ${!DataStore.isVerifiedName(it.itemKey) ? '<span class="pill unverified" style="margin-left:auto;">unverified</span>' : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  },

  bindGearPickerEvents() {
    const search = document.getElementById("gearPickerSearch");
    if (search) {
      search.addEventListener("click", (e) => e.stopPropagation());
      search.addEventListener("input", (e) => {
        this.state.player.gearSearch = e.target.value;
        const panel = document.querySelector("[data-picker-slot]");
        const slot = panel?.dataset.pickerSlot;
        if (panel && slot) {
          panel.outerHTML = this.renderGearPickerHtml(slot);
          this.bindGearPickerEvents();
        }
      });
    }
    document.querySelectorAll(".gear-picker-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const panel = row.closest("[data-picker-slot]");
        const slot = panel.dataset.pickerSlot;
        if (row.dataset.clear) {
          this.state.player.armor[slot] = null;
        } else {
          const key = row.dataset.itemKey;
          if (slot === "weapon") this.state.player.weaponItemKey = key;
          else this.state.player.armor[slot] = key;
        }
        this.state.player.openPicker = null;
        this.state.player.gearSearch = "";
        this.renderPlayerGearPane();
        this.updatePlayerLiveValues();
      });
    });
  },
};
