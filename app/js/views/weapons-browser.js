// ============================================================
// weapons-browser.js
// Database browser + equip simulator for weapons, replicating
// the in-game Database screens and Equipment screen.
// ============================================================

const WeaponsBrowserView = {
  state: {
    activeCategory: "OneHandedSword",
    selectedItemKey: null,
    enhancementTier: 0,
    abilities: { STR: 1, DEX: 1, AGI: 1, INT: 1 },
    // Up to 4 EX-MOD slots, each either null (empty) or { type, tierIndex }.
    // tierIndex is relative to the FULL tiers array (not the demo-sliced
    // one) so it stays meaningful if the demo-only restriction is lifted
    // later.
    exModSlots: [null, null, null, null],
    search: "",
    rankFilter: "all",
    viewMode: "grid", // grid | list
    verifiedOnly: false,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="quickCoverage"></div>
      <div class="type-tabs" id="typeTabs"></div>
      <div class="toolbar" id="toolbar"></div>
      <div class="equip-layout">
        <div id="weaponListPane"></div>
        <div id="weaponDetailPane"></div>
        <div id="weaponStatsPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderTypeTabs();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetailAndStats();
  },

  renderQuickCoverage() {
    const el = document.getElementById("quickCoverage");
    const report = DataStore.modCoverageReport;
    const total = DataStore.totalWeaponCount();
    const verifiedNames = Object.values(DataStore.localization).filter(
      (e) => e.verified
    ).length;
    el.innerHTML = `
      <span><b>${total}</b> weapons loaded</span>
      <span><b>${verifiedNames}</b>/${total} names verified</span>
      <span><b>${report.resolved.length}</b>/${report.totalModNamesReferenced} unique mods resolved</span>
      <span style="margin-left:auto; opacity:0.6;">Formula verified against EOA-SAO-Weapons-Updated.xlsx (12/12 test points)</span>
    `;
  },

  renderTypeTabs() {
    const el = document.getElementById("typeTabs");
    const cats = DataStore.categoryIndex;
    el.innerHTML = "";
    Object.keys(cats).forEach((catKey) => {
      const meta = cats[catKey];
      const tab = document.createElement("div");
      tab.className = "type-tab" + (catKey === this.state.activeCategory ? " active" : "");
      tab.title = meta.label + " (icon mapping inferred — see Data Coverage)";
      tab.innerHTML = `<img src="${weaponCategoryIconPath(catKey)}" alt="" />`;
      tab.addEventListener("click", () => {
        this.state.activeCategory = catKey;
        this.state.selectedItemKey = null;
        this.renderTypeTabs();
        this.renderListPaneWithSkeleton();
        this.renderDetailAndStats();
      });
      el.appendChild(tab);
    });
    const countEl = document.createElement("span");
    countEl.className = "type-tab-count";
    countEl.textContent = `${cats[this.state.activeCategory].label} — ${cats[this.state.activeCategory].count} items`;
    el.appendChild(countEl);
  },

  renderToolbar() {
    const el = document.getElementById("toolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="searchInput" placeholder="Search by name or ItemKey (e.g. 'Decapitator' or 'ItemName_WTS_3')..." value="${escapeHtml(this.state.search)}" />
      <select class="filter-select" id="rankFilter">
        <option value="all">All Ranks</option>
        <option value="RankD">Rank D</option>
        <option value="RankC">Rank C</option>
        <option value="RankB">Rank B</option>
        <option value="RankA">Rank A</option>
        <option value="RankS">Rank S</option>
      </select>
      <button class="toggle-btn" id="verifiedToggle">${this.state.verifiedOnly ? "✓ " : ""}Verified names only</button>
      <button class="toggle-btn" id="viewModeToggle">${this.state.viewMode === "grid" ? "☰ List view" : "▦ Grid view"}</button>
    `;
    document.getElementById("searchInput").value = this.state.search;
    document.getElementById("rankFilter").value = this.state.rankFilter;

    document.getElementById("searchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("rankFilter").addEventListener("change", (e) => {
      this.state.rankFilter = e.target.value;
      this.renderListPane();
    });
    document.getElementById("verifiedToggle").addEventListener("click", () => {
      this.state.verifiedOnly = !this.state.verifiedOnly;
      this.renderToolbar();
      this.renderListPane();
    });
    document.getElementById("viewModeToggle").addEventListener("click", () => {
      this.state.viewMode = this.state.viewMode === "grid" ? "list" : "grid";
      this.renderToolbar();
      this.renderListPane();
    });
  },

  getFilteredWeapons() {
    let weapons = DataStore.weaponsByCategory[this.state.activeCategory] || [];

    if (this.state.rankFilter !== "all") {
      weapons = weapons.filter((w) => w.rank === this.state.rankFilter);
    }
    if (this.state.verifiedOnly) {
      weapons = weapons.filter((w) => DataStore.isVerifiedName(w.itemKey));
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      weapons = weapons.filter((w) => {
        const name = DataStore.getDisplayName(w.itemKey).toLowerCase();
        return name.includes(q) || w.itemKey.toLowerCase().includes(q);
      });
    }
    return weapons;
  },

  /**
   * Shows a brief skeleton placeholder before rendering the real grid --
   * used specifically for transitions where something meaningfully
   * changed (switching weapon category) so the UI has a visible,
   * natural-feeling beat rather than an instant content swap. Not used
   * for every keystroke/filter change, only category switches, since
   * those're the moments that most resemble "new data just arrived."
   */
  renderListPaneWithSkeleton() {
    const pane = document.getElementById("weaponListPane");
    const targetCount = Math.min(this.getFilteredWeapons().length, 18) || 12;
    pane.innerHTML = LoadingSkeleton.grid(targetCount);
    const detailPane = document.getElementById("weaponDetailPane");
    const statsPane = document.getElementById("weaponStatsPane");
    if (detailPane) detailPane.innerHTML = LoadingSkeleton.detailPanel();
    if (statsPane) statsPane.innerHTML = LoadingSkeleton.statsPanel();

    requestAnimationFrame(() => {
      setTimeout(() => this.renderListPane(), 160);
    });
  },

  renderListPane() {
    const pane = document.getElementById("weaponListPane");
    const weapons = this.getFilteredWeapons();

    if (weapons.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No weapons match</h4>
            <p>Try clearing the search or rank filter.</p>
          </div>
        </div>
      `;
      return;
    }

    if (this.state.viewMode === "grid") {
      const grid = document.createElement("div");
      grid.className = "weapon-grid";
      weapons.forEach((w) => grid.appendChild(this.buildTile(w)));
      pane.innerHTML = "";
      pane.appendChild(grid);
      AnimationSettings.applyScanFrameTiming(grid);
    } else {
      const list = document.createElement("div");
      weapons.forEach((w) => list.appendChild(this.buildListRow(w)));
      pane.innerHTML = "";
      pane.appendChild(list);
    }

    // auto-select first if nothing selected yet
    if (!this.state.selectedItemKey || !weapons.find((w) => w.itemKey === this.state.selectedItemKey)) {
      this.state.selectedItemKey = weapons[0].itemKey;
      this.renderDetailAndStats();
    }
  },

  buildTile(weapon) {
    const tile = document.createElement("div");
    tile.className = "weapon-tile scan-frame scan-frame-sm" + (weapon.itemKey === this.state.selectedItemKey ? " selected" : "");
    tile.style = scanFrameStyle(weapon.rank);
    const verified = DataStore.isVerifiedName(weapon.itemKey);
    tile.innerHTML = `
      ${scanBarHtml()}
      <span class="rank-chip" style="color:${rankColor(weapon.rank)}" title="Item grade (Class): ${rankShort(weapon.rank)} — not the ACV rank, see weapon detail panel">${rankShort(weapon.rank)}</span>
      ${!verified ? '<span class="unverified-dot" title="Name not verified"></span>' : ""}
      <button class="tile-zoom-btn" title="Zoom" aria-label="Zoom icon">🔍</button>
      <img src="${weapon.textures.icon}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='${weapon.textures.categoryPlaceholderRender}';" />
    `;
    tile.title = DataStore.getDisplayName(weapon.itemKey);
    tile.querySelector(".tile-zoom-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openIconZoom(weapon);
    });
    tile.addEventListener("click", () => {
      this.state.selectedItemKey = weapon.itemKey;
      this.renderListPane();
      this.renderDetailAndStats();
    });
    return tile;
  },

  buildListRow(weapon) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (weapon.itemKey === this.state.selectedItemKey ? " selected" : "");
    const verified = DataStore.isVerifiedName(weapon.itemKey);
    row.innerHTML = `
      <span class="wl-icon"><img src="${weapon.textures.iconSmall}" alt="" loading="lazy"
            onerror="this.onerror=null;this.src='${weapon.textures.categoryPlaceholderRender}';" /></span>
      <span class="rank-badge" title="Item grade (Class) — not ACV rank">${rankBadgeImg(weapon.rank)}</span>
      <span class="wl-name">${escapeHtml(DataStore.getDisplayName(weapon.itemKey))}</span>
      ${!verified ? '<span class="pill unverified">unverified</span>' : ""}
      <span class="wl-id">${weapon.itemKey}</span>
      ${weapon.id != null ? `<span class="id-chip" title="Numeric ItemId — the value DataTables, shops and RODSchema patches reference">#${weapon.id}</span>` : ""}
    `;
    row.addEventListener("click", () => {
      this.state.selectedItemKey = weapon.itemKey;
      this.renderListPane();
      this.renderDetailAndStats();
    });
    return row;
  },

  renderDetailAndStats() {
    const detailPane = document.getElementById("weaponDetailPane");
    const statsPane = document.getElementById("weaponStatsPane");
    const weapon = DataStore.weaponsByItemKey[this.state.selectedItemKey];

    if (!weapon) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a weapon</p></div></div>`;
      statsPane.innerHTML = "";
      return;
    }

    const maxTier = (weapon.enhancement.baseWeaponATK.length || 21) - 1;
    if (this.state.enhancementTier > maxTier) this.state.enhancementTier = maxTier;

    const verified = DataStore.isVerifiedName(weapon.itemKey);
    const displayName = DataStore.getDisplayName(weapon.itemKey);
    const acvRankAtTier = {};
    for (const stat of ["STR", "DEX", "AGI", "INT"]) {
      const arr = weapon.enhancement.abilityCorrectionRank[stat] || [];
      acvRankAtTier[stat] = arr[this.state.enhancementTier] || arr[0] || "None";
    }

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Weapon Preview</h3>
        <div class="preview-img-wrap zoomable-icon scan-frame" id="previewImgWrap" title="Click to zoom" style="${scanFrameStyle(weapon.rank)}">
          ${scanBarHtml()}
          <img src="${weapon.textures.icon}" alt=""
               onerror="this.onerror=null;this.src='${weapon.textures.categoryPlaceholderRender}';" />
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${weapon.itemKey} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified — showing raw key</span>'}</div>

        ${renderDescriptionBlock(weapon.itemKey)}

        <div class="enhancement-slider-wrap" style="width:100%;">
          <div class="slider-label">
            <span>Enhancement</span>
            <span class="plus-val" id="enhPlusVal">+${this.state.enhancementTier}</span>
          </div>
          <input type="range" min="0" max="${maxTier}" step="1"
                 value="${this.state.enhancementTier}" id="enhSlider" />
        </div>

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:6px; line-height:1.7;">
          <div>Category: ${weapon.categoryLabel}</div>
          <div title="The item's overall quality/grade tier (Class field) — used for refining & enhancement cost lookups. This is a DIFFERENT value from the ACV ranks shown on the right, which control stat scaling.">
            Item grade (Class): ${rankBadgeImg(weapon.rank)} ${rankShort(weapon.rank)}
            <span style="opacity:0.6;">— not the same as ACV rank, see ⓘ</span>
          </div>
          <div>Strike type: ${weapon.strikeType || "—"}</div>
          <div>Sell value: ${weapon.sellAmount >= 0 ? weapon.sellAmount + " Col" : "—"}</div>
        </div>

        ${this.renderModCallout(weapon)}
        ${ModelPanel.html(DataStore.getModelRef("weapon", weapon.itemKey), DataStore.getWeaponDisplayName ? DataStore.getWeaponDisplayName(weapon) : weapon.itemKey)}
        ${renderItemSourcesPanelHtml(weapon.itemKey)}
      </div>
    `;

    statsPane.innerHTML = `
      <div class="hud-panel">
        <h3>ACV — Ability Correction Value</h3>
        <table class="acv-table">
          <thead><tr><th>Stat</th><th>Value</th><th>Rank<br/><span style="font-size:9px; opacity:0.6; font-weight:400;">(at current +N)</span></th><th>Contribution</th></tr></thead>
          <tbody>
            ${["STR", "DEX", "AGI", "INT"].map((stat) => `
              <tr>
                <td>${stat}</td>
                <td><input type="number" min="1" max="356" title="356 is the real ceiling: a level-200 Player build with every Growth Point spent on one stat (see Characters &gt; Player)" value="${this.state.abilities[stat]}" data-stat="${stat}" class="ability-num-input" style="width:48px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.18);border-radius:2px;color:var(--hud-text);font-family:var(--font-mono);text-align:center;" /></td>
                <td id="rankCell-${stat}">${rankBadgeImg(acvRankAtTier[stat])} ${rankShort(acvRankAtTier[stat])}</td>
                <td class="contrib" id="contribCell-${stat}">+0</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="exmod-picker" style="margin-top:14px;">
          <div class="exmod-picker-label">
            EX-MOD slots
            <span style="font-size:11px; color:var(--hud-text-dim); font-weight:400;">(up to 4, no duplicate types — see Data Coverage for confidence)</span>
          </div>
          <div id="exModSlots"></div>
        </div>

        <div class="atk-display">
          <div>
            <div class="atk-label">TOTAL ATK</div>
            <div class="atk-total" id="atkTotalVal">0</div>
          </div>
          <div class="atk-breakdown" id="atkBreakdownVal">
            ( 0 base + <span class="acv">0</span> ACV + <span class="mod">0</span> EX-MOD )
          </div>
        </div>
      </div>
    `;

    this.renderExModSlots(weapon);

    // wire up interactivity -- these listeners only patch numbers/text in
    // place (see updateLiveValues), never re-run innerHTML, so dragging the
    // slider or typing in a number field doesn't blow away focus mid-action.
    const enhSlider = document.getElementById("enhSlider");
    if (enhSlider) {
      enhSlider.addEventListener("input", (e) => {
        this.state.enhancementTier = parseInt(e.target.value, 10);
        this.updateLiveValues(weapon);
      });
    }
    document.querySelectorAll(".ability-num-input").forEach((input) => {
      input.addEventListener("input", (e) => {
        const stat = e.target.dataset.stat;
        const raw = e.target.value;
        // Allow the field to be temporarily empty or mid-edit without
        // forcing it back to a clamped value on every keystroke -- only
        // clamp once there's a real number, and never touch e.target.value
        // here (that would reset cursor position while typing).
        if (raw === "") return;
        let v = parseInt(raw, 10);
        if (isNaN(v)) return;
        v = Math.max(1, Math.min(356, v));
        this.state.abilities[stat] = v;
        this.updateLiveValues(weapon);
      });
      input.addEventListener("blur", (e) => {
        // on losing focus, normalize the displayed value (e.g. "" -> "1")
        const stat = e.target.dataset.stat;
        e.target.value = this.state.abilities[stat];
      });
    });
    const previewImgWrap = document.getElementById("previewImgWrap");
    if (previewImgWrap) {
      previewImgWrap.addEventListener("click", () => {
        openIconZoom(weapon);
      });
    }
    AnimationSettings.applyScanFrameTiming(detailPane);

    this.updateLiveValues(weapon);
  },

  /**
   * Patches only the numbers/text that depend on enhancementTier,
   * abilities, and exModBonusATK -- never touches innerHTML of the
   * inputs themselves, so this can run on every keystroke/slider-tick
   * without stealing focus or interrupting typing/dragging.
   */
  updateLiveValues(weapon) {
    const exModBonusATK = this.getExModATKBonus();
    const sim = simulateTotalATK({
      weapon,
      enhancementTier: this.state.enhancementTier,
      abilities: this.state.abilities,
      multiplierTable: App.abilityMultiplierTable,
      exModBonusATK,
    });

    const plusVal = document.getElementById("enhPlusVal");
    if (plusVal) plusVal.textContent = `+${this.state.enhancementTier}`;

    for (const stat of ["STR", "DEX", "AGI", "INT"]) {
      const rankCell = document.getElementById(`rankCell-${stat}`);
      const contribCell = document.getElementById(`contribCell-${stat}`);
      if (rankCell) rankCell.innerHTML = `${rankBadgeImg(sim.acvBreakdown[stat].rank)} ${rankShort(sim.acvBreakdown[stat].rank)}`;
      if (contribCell) contribCell.textContent = `+${sim.acvBreakdown[stat].contribution}`;
    }

    const atkTotalVal = document.getElementById("atkTotalVal");
    if (atkTotalVal) atkTotalVal.textContent = sim.total;
    const atkBreakdownVal = document.getElementById("atkBreakdownVal");
    if (atkBreakdownVal) {
      atkBreakdownVal.innerHTML = `( ${sim.baseATK} base + <span class="acv">${sim.acv}</span> ACV + <span class="mod">${sim.exModBonusATK}</span> EX-MOD )`;
    }
  },

  /**
   * Only the BonusATK type contributes to the Total ATK number -- the
   * other 25 EX-MOD types (Sprint Speed, Stamina Consumption, etc.) are
   * real effects but don't feed the ATK formula, so they're shown in the
   * slot picker for reference but intentionally don't change this value.
   */
  getExModATKBonus() {
    let total = 0;
    for (const slot of this.state.exModSlots) {
      if (slot && slot.type === "BonusATK") {
        const exMod = DataStore.getExModByType("BonusATK");
        if (exMod) total += exMod.tiers[slot.tierIndex] ?? 0;
      }
    }
    return total;
  },

  renderExModSlots(weapon) {
    const container = document.getElementById("exModSlots");
    if (!container) return;
    const pool = DataStore.getDemoExModOptions();
    const usedTypes = this.state.exModSlots.filter(Boolean).map((s) => s.type);

    container.innerHTML = this.state.exModSlots.map((slot, slotIndex) => {
      const availableForThisSlot = pool.filter(
        (m) => !usedTypes.includes(m.type) || (slot && slot.type === m.type)
      );
      const typeOptions = availableForThisSlot.map((m) => {
        const confidence = m.labelConfirmed ? "" : " ⚠";
        return `<option value="${m.type}" ${slot && slot.type === m.type ? "selected" : ""}>${escapeHtml(m.label)}${confidence}</option>`;
      }).join("");

      let tierOptions = "";
      let currentValueDisplay = "";
      if (slot) {
        const exMod = pool.find((m) => m.type === slot.type);
        if (exMod) {
          tierOptions = exMod.tiers.map((tierVal, i) => {
            const realIndex = i + exMod.tierIndexOffset;
            return `<option value="${realIndex}" ${slot.tierIndex === realIndex ? "selected" : ""}>${formatExModValue(exMod.format, tierVal)}</option>`;
          }).join("");
          const selectedTier = exMod.tiers.find((_, i) => i + exMod.tierIndexOffset === slot.tierIndex);
          currentValueDisplay = selectedTier !== undefined ? formatExModValue(exMod.format, selectedTier) : "";
        }
      }

      return `
        <div class="exmod-slot" data-slot-index="${slotIndex}">
          <span class="exmod-slot-number">${slotIndex + 1}</span>
          <select class="exmod-type-select" data-slot-index="${slotIndex}">
            <option value="">— empty —</option>
            ${typeOptions}
          </select>
          <select class="exmod-tier-select" data-slot-index="${slotIndex}" ${!slot ? "disabled" : ""}>
            ${slot ? tierOptions : '<option value="">—</option>'}
          </select>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".exmod-type-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const slotIndex = parseInt(e.target.dataset.slotIndex, 10);
        const type = e.target.value;
        if (!type) {
          this.state.exModSlots[slotIndex] = null;
        } else {
          const exMod = DataStore.getExModByType(type);
          const defaultIndex = exMod ? exMod.demoObservedMinTierIndex : 0;
          this.state.exModSlots[slotIndex] = { type, tierIndex: defaultIndex };
        }
        this.renderExModSlots(weapon);
        this.updateLiveValues(weapon);
      });
    });
    container.querySelectorAll(".exmod-tier-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const slotIndex = parseInt(e.target.dataset.slotIndex, 10);
        const tierIndex = parseInt(e.target.value, 10);
        if (this.state.exModSlots[slotIndex]) {
          this.state.exModSlots[slotIndex].tierIndex = tierIndex;
        }
        this.updateLiveValues(weapon);
      });
    });
  },

  renderModCallout(weapon) {
    if (!weapon.modNames || weapon.modNames.length === 0) return "";
    return weapon.modNames.map((modName) =>
      renderModCalloutShared(modName, { showNumericVsDescriptionNote: true })
    ).join("");
  },
};

// NOTE: WeaponTypeID -> W{n} icon mapping is INFERRED, not confirmed.
// We know WeaponTypeID 1-6 corresponds to OneHandedSword/Rapier/Dagger/
// Mace/TwoHandedSword/Axe (verified directly from the data: every weapon
// in each category file carries the same weaponTypeId). What's NOT
// confirmed is that the game's UI uses icon file W{weaponTypeId} for that
// same category -- no JSON in either game-file export wires icon
// filenames to WeaponTypeID, so this mapping is our best guess based on
// shape (W6 looks like a one-handed sword, W3 looks like an axe, etc).
// If you can confirm the real mapping in-game, update WEAPON_ICON_MAP below.
const WEAPON_ICON_MAP = {
  OneHandedSword: "W6",
  Rapier: "W4",
  Dagger: "W1",
  Mace: "W5",
  TwoHandedSword: "W2",
  Axe: "W3",
};

function weaponCategoryIconPath(catKey) {
  const code = WEAPON_ICON_MAP[catKey] || "Unknown";
  return `Content/ROD/Widget/Common/IconImage/ItemCategoryIconImage/T_ItemCategoryIcon_${code}.png`;
}

function rankShort(rank) {
  return (rank || "None").replace("Rank", "");
}

function rankColor(rank) {
  const map = {
    RankD: "var(--rank-d)",
    RankC: "var(--rank-c)",
    RankB: "var(--rank-b)",
    RankA: "var(--rank-a)",
    RankS: "var(--rank-s)",
  };
  return map[rank] || "#888";
}

/**
 * Returns an inline style string setting the --frame-rank-color and
 * --frame-rank-glow CSS vars for a .scan-frame element, sourced from
 * Content/ROD/animation-config.json's rankBorderColors (falls back to
 * the rankColor() palette above if the config hasn't loaded yet).
 */
function scanFrameStyle(rank) {
  const cfg = DataStore.animationConfig && DataStore.animationConfig.rankBorderColors;
  const color = (cfg && cfg[rank]) || (cfg && cfg.none) || rankColor(rank).replace("var(--rank-", "").replace(")", "");
  const resolved = cfg ? color : null;
  if (resolved) {
    return `--frame-rank-color:${resolved}; --frame-rank-glow:${resolved}66;`;
  }
  return "";
}

/**
 * The blue sweep overlay element, to be placed as a direct child of any
 * .scan-frame container. Timing/color/enabled state are all driven by
 * CSS custom properties set globally by AnimationSettings.applyToDocument(),
 * and per-instance animation-delay is set afterward by
 * AnimationSettings.applyScanFrameTiming() once the element exists in the DOM.
 */
function scanBarHtml() {
  return `<span class="scan-bar"></span>`;
}

function rankBadgeImg(rank) {
  const short = rankShort(rank);
  if (!"DCBAS".includes(short)) return "";
  return `<span class="rank-badge"><img src="Content/ROD/Widget/Common/IconImage/ClassIconImage/T_ClassIcon_${short}.png" alt="${short}" /></span>`;
}

function formatModType(type) {
  // EModificationType::CoefSP -> "Coef SP"
  return type
    .replace("EModificationType::", "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatModValue(type, value) {
  if (type.includes("Coef") || type.includes("Enh")) return `+${value}%`;
  return `+${value}`;
}

function formatExModValue(format, value) {
  // format is like "+{v}" or "+{v}%" or "-{v}%"
  return format.replace("{v}", value);
}

/**
 * Renders the weapon/armor flavor-text description block, sourced
 * from DataStore.getDescription(itemKey) (Items/Localization/{lang}.json,
 * ItemDescription_{key} from the official Game.json export). Returns
 * "" (renders nothing) if no description exists for this item in the
 * current language -- this is expected for the small number of items
 * with no official source at all (the *_37 IDs, etc.), and for those
 * we intentionally don't show an empty/placeholder box, matching the
 * existing "Select a weapon" empty-state convention of staying quiet
 * rather than displaying a hole where content should be.
 */
function renderDescriptionBlock(itemKey) {
  const description = DataStore.getDescription(itemKey);
  if (!description) return "";
  const verified = DataStore.isDescriptionVerified(itemKey);
  return `
    <div class="item-description${verified ? "" : " unverified-desc"}">
      ${escapeHtml(description)}
    </div>
  `;
}

/**
 * Renders one Unique MOD callout box: localized mod name + description
 * (from Parameters/Shared/Localization/{lang}.json, sourced the same
 * way as item names/descriptions) plus whatever numeric effect data
 * is resolved for it (from PeculiarModifications.json, language-
 * agnostic). Shared between weapons-browser.js and equipment-browser.js
 * so both item types render mods identically -- previously this was
 * duplicated per-file and showed only the raw mod key with no
 * description anywhere in the app.
 *
 * `showNumericVsDescriptionNote`: when true, adds a short caveat
 * directly below the numeric effects explaining that the description
 * above and the numeric data below come from separate parts of the
 * export and can disagree on what's covered (e.g. Slash Recovery's SP
 * restore is mentioned in its description but isn't one of the
 * numbers below). Only rendered when BOTH a description AND resolved
 * numeric effects are actually present -- with nothing above or below
 * to compare, the note has nothing to refer to and would be confusing
 * rather than clarifying. Weapons pass true; armor passes false since
 * this was originally a weapon-specific observation and hasn't been
 * separately confirmed to generalize to armor mods.
 */
function renderModCalloutShared(modName, { topMargin = false, showNumericVsDescriptionNote = false } = {}) {
  const def = DataStore.getModDefinition(modName);
  const displayName = DataStore.getModDisplayName(modName);
  const nameVerified = DataStore.isModNameVerified(modName);
  const nameSource = DataStore.getModNameSource(modName);
  const description = DataStore.getModDescription(modName);
  const descVerified = DataStore.isModDescriptionVerified(modName);
  const marginStyle = topMargin ? " margin-top:10px;" : "";

  const nameLine = nameVerified
    ? escapeHtml(displayName)
    : `${escapeHtml(displayName)} <span class="pill unverified" style="margin-left:6px;">unverified name</span>`;

  const descriptionHtml = description
    ? `<div class="mod-description${descVerified ? "" : " unverified-desc"}">${escapeHtml(description)}</div>`
    : "";

  // The raw key (e.g. "BasicSwordArt") is what actually appears in the
  // game's own export and localization files per language -- showing
  // it directly under the translated name (same convention as
  // .preview-itemkey for weapons/armor) means someone comparing
  // against a different language, or trying to find this mod in a
  // raw export file themselves, has the literal string to search for
  // rather than just the rendered, localized text.
  const keyLine = `<div class="mod-key">${escapeHtml(modName)}</div>`;

  // Source attribution sits in its own column to the right of the
  // name/key, deliberately out of the main left-aligned reading flow
  // (name -> key -> description -> numeric effects) -- this is meant
  // as a quick "where do I go to verify or edit this" reference, not
  // primary content, per the user's direction. Two distinct sources
  // are shown when they differ: the name/description's localization
  // source (per-language, e.g. "Official game localization
  // (Game.json)") and the numeric effects' source, which is NOT
  // localized at all -- DA_AttributeModification.json's
  // PeculiarModificationData is the same structural file regardless of
  // display language, so it's shown with the literal lookup key
  // (PeculiarModificationData["{modName}"]) rather than a generic
  // file name alone, since that's what someone would actually search
  // for in the raw export.
  const sourceLines = [];
  if (nameSource) {
    sourceLines.push(`Name/desc: ${escapeHtml(nameSource)}`);
  }
  if (def) {
    sourceLines.push(`Effects: DA_AttributeModification.json<br/>&nbsp;&nbsp;PeculiarModificationData["${escapeHtml(modName)}"]`);
  }
  const sourceBlock = sourceLines.length > 0 ? `
    <div class="mod-source-tag">
      ${sourceLines.map((l) => `<div>${l}</div>`).join("")}
    </div>
  ` : "";

  if (def && def.resolved) {
    const effectsHtml = def.effects.map((e) =>
      `<div class="mod-effect-line">${formatModType(e.type)}: <b>${formatModValue(e.type, e.value)}</b></div>`
    ).join("");
    const note = (showNumericVsDescriptionNote && description && def.effects.length > 0) ? `
      <div class="mod-effect-line" style="opacity:0.55; margin-top:6px; font-size:11px;">
        The description above and the numeric effect(s) below come from separate
        parts of the game's export — a description can mention something the
        numeric data doesn't capture (e.g. Slash Recovery's SP restore is
        described above but only its damage bonus appears as a number below).
      </div>
    ` : "";
    return `
      <div class="mod-callout" style="width:100%; text-align:left;${marginStyle}">
        <div class="mod-callout-header">
          <div class="mod-callout-main">
            <div class="mod-name">Unique MOD: ${nameLine}</div>
            ${keyLine}
          </div>
          ${sourceBlock}
        </div>
        ${descriptionHtml}
        ${effectsHtml || '<div class="mod-effect-line">No numeric effect data</div>'}
        ${note}
      </div>
    `;
  }

  return `
    <div class="mod-callout unresolved" style="width:100%; text-align:left;${marginStyle}">
      <div class="mod-callout-header">
        <div class="mod-callout-main">
          <div class="mod-name">Unique MOD: ${nameLine}</div>
          ${keyLine}
        </div>
        ${sourceBlock}
      </div>
      ${descriptionHtml}
      <div class="mod-effect-line">Referenced by this item but its numeric effect isn't resolved in the current data export — likely defined elsewhere in the game's logic, not yet captured. See Data Coverage report.</div>
    </div>
  `;
}

// ============================================================
// Icon zoom lightbox
// ============================================================

let zoomOverlayEl = null;

/**
 * `resolvedDisplayName` is optional -- when omitted, falls back to
 * DataStore.getDisplayName(item.itemKey) (the weapon/armor/legacy
 * lookup), which is correct for every call site that existed before
 * Lore did. Lore (and any future category with its OWN localization
 * namespace, per the "separate getters per category" decision) must
 * pass its already-resolved name explicitly instead -- itemKey-style
 * lookups against the wrong category's localization map would
 * silently resolve to nothing and show the raw key as the caption.
 */
function openIconZoom(item, resolvedDisplayName) {
  closeIconZoom();
  const displayName = resolvedDisplayName !== undefined ? resolvedDisplayName : DataStore.getDisplayName(item.itemKey);

  zoomOverlayEl = document.createElement("div");
  zoomOverlayEl.className = "icon-zoom-overlay";
  zoomOverlayEl.innerHTML = `
    <div class="icon-zoom-box">
      <button class="icon-zoom-close" aria-label="Close">✕</button>
      <div class="icon-zoom-frame scan-frame" style="${scanFrameStyle(item.rank)}">
        ${scanBarHtml()}
        <img src="${item.textures.icon}" alt=""
             onerror="this.onerror=null;this.src='${item.textures.categoryPlaceholderRender}';" />
      </div>
      <div class="icon-zoom-caption">${escapeHtml(displayName)}</div>
      <div class="icon-zoom-sub">${item.itemKey}</div>
    </div>
  `;
  document.body.appendChild(zoomOverlayEl);
  AnimationSettings.applyScanFrameTiming(zoomOverlayEl);

  zoomOverlayEl.addEventListener("click", (e) => {
    if (e.target === zoomOverlayEl) closeIconZoom();
  });
  zoomOverlayEl.querySelector(".icon-zoom-close").addEventListener("click", closeIconZoom);
  document.addEventListener("keydown", handleZoomEscape);
}

function closeIconZoom() {
  if (zoomOverlayEl) {
    zoomOverlayEl.remove();
    zoomOverlayEl = null;
    document.removeEventListener("keydown", handleZoomEscape);
  }
}

function handleZoomEscape(e) {
  if (e.key === "Escape") closeIconZoom();
}
