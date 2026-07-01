// ============================================================
// items-browser.js
// Database browser for items (Consumables/Materials/Key Items),
// built from DT_ItemDatabase.json (the in-game Database menu's OWN
// list, confirmed against the user's 3 reference screenshots) cross-
// referenced with ItemDataAsset.json for per-item stats.
//
// Closer to weapons/armor than monsters: items DO have real per-item
// icons (both a small in-world icon and a larger Database-menu
// thumbnail, confirmed as two genuinely separate texture families,
// not one icon at two sizes) and a rank/rarity badge (RarelityID,
// same D/C/B/A/S concept as weapon/armor rank under a different
// field name -- confirmed B/A/C only, no D/S seen). Coverage is much
// higher than monsters too: 148/148 named.
//
// Two things make this section's data shape genuinely different from
// every other category built so far:
//   1. TWO description paragraphs per item, not one -- a general
//      mechanical "description" (ItemDescription_*, same table
//      weapons/armor use) shown for nearly every item, plus an
//      OPTIONAL Database-menu-only "flavorText" (DatabaseText_*, same
//      table monsters use) shown only for the 60/148 items that have
//      one. Confirmed against all 3 of the user's screenshots: Healing
//      Potion has both paragraphs, Emerald and Teleport Crystal have
//      only the first.
//   2. A small number of items are confirmed-real exceptions to the
//      normal data flow: "Hand Mirror" exists in the inventory system
//      but isn't registered in the Database menu at all (shown anyway,
//      flagged isDatabaseException); 5 Key Items (including Teleport
//      Crystal, directly from the user's own screenshot) are the
//      OPPOSITE -- registered in the Database menu but have no stats
//      record anywhere in this export (shown with rank/stack/buy-sell
//      all blank, flagged missingFromItemDataAsset, rather than either
//      silently dropped or shown with fabricated placeholder stats).
// ============================================================

const ItemsBrowserView = {
  state: {
    activeMainTab: "catalog", // "catalog" | "recipes" -- Recipes is its own top-level tab within Items, not a 4th category alongside Consumables/Materials/Key Items, since it has a genuinely different shape (11 of its own sub-categories, materials, cost, a produced-item cross-reference) rather than being one more list of plain items
    activeCategory: "Usable",
    selectedItemKey: null,
    search: "",
    rankFilter: "all",
    viewMode: "grid",
    activeRecipeCategory: "OneHandedSword",
    selectedRecipeKey: null,
    recipeSearch: "",
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="toolbar" id="itemMainTabBar" style="margin-bottom:14px;"></div>
      <div id="itemMainTabContent"></div>
    `;
    container.appendChild(wrap);
    this.renderMainTabBar();
    this.renderActiveMainTab();
  },

  renderMainTabBar() {
    const el = document.getElementById("itemMainTabBar");
    const tabs = [
      ["catalog", "Catalog"],
      ["recipes", "Recipes"],
    ];
    el.innerHTML = tabs.map(([key, label]) =>
      `<button class="toggle-btn${this.state.activeMainTab === key ? " active" : ""}" data-maintab="${key}">${label}</button>`
    ).join("");
    el.querySelectorAll("[data-maintab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.activeMainTab = btn.dataset.maintab;
        this.renderMainTabBar();
        this.renderActiveMainTab();
      });
    });
  },

  renderActiveMainTab() {
    const container = document.getElementById("itemMainTabContent");
    container.innerHTML = "";
    if (this.state.activeMainTab === "recipes") {
      this.renderRecipesTab(container);
    } else {
      this.renderCatalogTab(container);
    }
    // Re-trigger the fade-in animation -- see asset-inspector.js's
    // renderActiveMainTab() for why the remove/reflow/re-add sequence
    // is needed rather than just adding the class once.
    container.classList.remove("tab-content-fade-in");
    void container.offsetWidth;
    container.classList.add("tab-content-fade-in");
  },

  renderCatalogTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="itemQuickCoverage"></div>
      <div class="type-tabs" id="itemTypeTabs"></div>
      <div class="toolbar" id="itemToolbar"></div>
      <div class="equip-layout">
        <div id="itemListPane"></div>
        <div id="itemDetailPane"></div>
        <div id="itemStatsPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderTypeTabs();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("itemQuickCoverage");
    const all = DataStore.getAllItemsFlat();
    const verifiedNames = all.filter((i) => DataStore.isItemNameVerified(i.itemKey)).length;
    el.innerHTML = `
      <span><b>${all.length}</b> items loaded</span>
      <span><b>${verifiedNames}</b>/${all.length} names verified</span>
      <span style="margin-left:auto; opacity:0.6;">List matches the in-game Database menu exactly — see Data Coverage for exceptions</span>
    `;
  },

  renderTypeTabs() {
    const el = document.getElementById("itemTypeTabs");
    const cats = DataStore.itemCategoryIndex || {};
    el.innerHTML = "";
    Object.keys(cats).forEach((catKey) => {
      const meta = cats[catKey];
      const tab = document.createElement("button");
      tab.className = "toggle-btn" + (catKey === this.state.activeCategory ? " active" : "");
      tab.textContent = `${meta.label} (${meta.count})`;
      tab.addEventListener("click", () => {
        this.state.activeCategory = catKey;
        this.state.selectedItemKey = null;
        this.renderTypeTabs();
        this.renderToolbar();
        this.renderListPaneWithSkeleton();
        this.renderDetail();
      });
      el.appendChild(tab);
    });
  },

  renderToolbar() {
    const el = document.getElementById("itemToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="itemSearchInput" placeholder="Search by name or ItemKey..." value="${escapeHtml(this.state.search)}" />
      <select class="filter-select" id="itemRankFilter">
        <option value="all">All Ranks</option>
        <option value="RankC">Rank C</option>
        <option value="RankB">Rank B</option>
        <option value="RankA">Rank A</option>
      </select>
      <button class="toggle-btn" id="itemViewModeToggle">${this.state.viewMode === "grid" ? "☰ List view" : "▦ Grid view"}</button>
    `;
    document.getElementById("itemRankFilter").value = this.state.rankFilter;

    document.getElementById("itemSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
    document.getElementById("itemRankFilter").addEventListener("change", (e) => {
      this.state.rankFilter = e.target.value;
      this.renderListPane();
    });
    document.getElementById("itemViewModeToggle").addEventListener("click", () => {
      this.state.viewMode = this.state.viewMode === "grid" ? "list" : "grid";
      this.renderToolbar();
      this.renderListPane();
    });
  },

  getFilteredItems() {
    let items = DataStore.itemsByCategory[this.state.activeCategory] || [];
    if (this.state.rankFilter !== "all") {
      items = items.filter((i) => i.rank === this.state.rankFilter);
    }
    if (this.state.search.trim()) {
      const q = this.state.search.trim().toLowerCase();
      items = items.filter((i) => {
        const name = DataStore.getItemDisplayName(i.itemKey).toLowerCase();
        return name.includes(q) || i.itemKey.toLowerCase().includes(q);
      });
    }
    return items;
  },

  renderListPaneWithSkeleton() {
    const pane = document.getElementById("itemListPane");
    const targetCount = Math.min(this.getFilteredItems().length, 18) || 12;
    pane.innerHTML = LoadingSkeleton.grid(targetCount);
    const detailPane = document.getElementById("itemDetailPane");
    const statsPane = document.getElementById("itemStatsPane");
    if (detailPane) detailPane.innerHTML = LoadingSkeleton.detailPanel();
    if (statsPane) statsPane.innerHTML = LoadingSkeleton.statsPanel();

    requestAnimationFrame(() => {
      setTimeout(() => this.renderListPane(), 160);
    });
  },

  renderListPane() {
    const pane = document.getElementById("itemListPane");
    const items = this.getFilteredItems();

    if (items.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No items match</h4>
            <p>Try clearing the search or rank filter.</p>
          </div>
        </div>
      `;
      return;
    }

    if (this.state.viewMode === "grid") {
      const grid = document.createElement("div");
      grid.className = "weapon-grid";
      items.forEach((i) => grid.appendChild(this.buildTile(i)));
      pane.innerHTML = "";
      pane.appendChild(grid);
      AnimationSettings.applyScanFrameTiming(grid);
    } else {
      const list = document.createElement("div");
      items.forEach((i) => list.appendChild(this.buildListRow(i)));
      pane.innerHTML = "";
      pane.appendChild(list);
    }

    if (!this.state.selectedItemKey || !items.find((i) => i.itemKey === this.state.selectedItemKey)) {
      this.state.selectedItemKey = items[0].itemKey;
      this.renderDetail();
    }
  },

  buildTile(item) {
    const tile = document.createElement("div");
    tile.className = "weapon-tile scan-frame scan-frame-sm" + (item.itemKey === this.state.selectedItemKey ? " selected" : "");
    tile.style = scanFrameStyle(item.rank);
    const verified = DataStore.isItemNameVerified(item.itemKey);
    tile.innerHTML = `
      ${scanBarHtml()}
      ${item.rank ? `<span class="rank-chip" style="color:${rankColor(item.rank)}" title="Rarity: ${rankShort(item.rank)}">${rankShort(item.rank)}</span>` : ""}
      ${!verified ? '<span class="unverified-dot" title="Name not verified"></span>' : ""}
      <button class="tile-zoom-btn" title="Zoom" aria-label="Zoom icon">🔍</button>
      <img src="${item.textures.iconSmall}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='${item.textures.categoryPlaceholderRender}';" />
    `;
    tile.title = DataStore.getItemDisplayName(item.itemKey);
    tile.querySelector(".tile-zoom-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openIconZoom({ ...item, textures: { icon: item.textures.iconDatabase, categoryPlaceholderRender: item.textures.categoryPlaceholderRender } });
    });
    tile.addEventListener("click", () => {
      this.state.selectedItemKey = item.itemKey;
      this.renderListPane();
      this.renderDetail();
    });
    return tile;
  },

  buildListRow(item) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (item.itemKey === this.state.selectedItemKey ? " selected" : "");
    const verified = DataStore.isItemNameVerified(item.itemKey);
    row.innerHTML = `
      <span class="wl-icon"><img src="${item.textures.iconSmall}" alt="" loading="lazy"
            onerror="this.onerror=null;this.src='${item.textures.categoryPlaceholderRender}';" /></span>
      ${item.rank ? `<span class="rank-badge" title="Rarity">${rankBadgeImg(item.rank)}</span>` : ""}
      <span class="wl-name">${escapeHtml(DataStore.getItemDisplayName(item.itemKey))}</span>
      ${!verified ? '<span class="pill unverified">unverified</span>' : ""}
      <span class="wl-id">${item.itemKey}</span>
    `;
    row.addEventListener("click", () => {
      this.state.selectedItemKey = item.itemKey;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const detailPane = document.getElementById("itemDetailPane");
    const statsPane = document.getElementById("itemStatsPane");
    const item = DataStore.itemsByItemKey[this.state.selectedItemKey];

    if (!item) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an item</p></div></div>`;
      statsPane.innerHTML = "";
      return;
    }

    const verified = DataStore.isItemNameVerified(item.itemKey);
    const displayName = DataStore.getItemDisplayName(item.itemKey);

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Item Preview</h3>
        <div class="preview-img-wrap zoomable-icon scan-frame" id="itemPreviewImgWrap" title="Click to zoom" style="${scanFrameStyle(item.rank)}">
          ${scanBarHtml()}
          <img src="${item.textures.iconDatabase}" alt=""
               onerror="this.onerror=null;this.src='${item.textures.categoryPlaceholderRender}';" />
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${item.itemKey} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified — showing raw key</span>'}</div>

        ${this.renderItemDescriptionBlock(item.itemKey)}
        ${this.renderFlavorTextBlock(item.itemKey)}

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.7;">
          <div>Category: ${item.categoryLabel}</div>
          ${item.rank ? `<div title="RarelityID — same D/C/B/A/S concept as weapon/armor rank.">Rarity: ${rankBadgeImg(item.rank)} ${rankShort(item.rank)}</div>` : ""}
          ${!item.missingFromItemDataAsset ? `
            <div>Max stack: ${item.maxStack === -1 ? "Unlimited" : (item.maxStack ?? "—")}</div>
            <div>Buy / Sell: ${item.buyAmount >= 0 ? item.buyAmount + " Col" : "—"} / ${item.sellAmount >= 0 ? item.sellAmount + " Col" : "—"}</div>
          ` : ""}
        </div>

        ${this.renderExceptionNotice(item)}
      </div>
    `;

    statsPane.innerHTML = "";

    const previewImgWrap = document.getElementById("itemPreviewImgWrap");
    if (previewImgWrap) {
      previewImgWrap.addEventListener("click", () => {
        openIconZoom({ ...item, textures: { icon: item.textures.iconDatabase, categoryPlaceholderRender: item.textures.categoryPlaceholderRender } });
      });
    }
    AnimationSettings.applyScanFrameTiming(detailPane);
  },

  /**
   * Item description (the general, mechanical-effect paragraph --
   * e.g. "Recovers 100 HP for the user over 10 seconds."). Mirrors
   * weapons-browser.js's renderDescriptionBlock() HTML structure
   * exactly (same .item-description class, same unverified-desc
   * modifier), but uses the dedicated item getters
   * (getItemDescription/isItemDescriptionVerified) rather than the
   * shared weapon/armor ones, per the "separate localization
   * namespace per category" decision.
   */
  renderItemDescriptionBlock(itemKey) {
    const description = DataStore.getItemDescription(itemKey);
    if (!description) return "";
    const verified = DataStore.isItemDescriptionVerified(itemKey);
    return `
      <div class="item-description${verified ? "" : " unverified-desc"}">
        ${escapeHtml(description)}
      </div>
    `;
  },

  /**
   * The optional second description paragraph (Database-menu-only
   * flavor text), shown only for the ~60/148 items that have one.
   * Visually distinct from the main description block (no left
   * border accent) so it reads as a second, separate paragraph rather
   * than a continuation of the same box.
   */
  renderFlavorTextBlock(itemKey) {
    const flavorText = DataStore.getFlavorText(itemKey);
    if (!flavorText) return "";
    const verified = DataStore.isFlavorTextVerified(itemKey);
    return `
      <div class="item-description${verified ? "" : " unverified-desc"}" style="border-left:none; background:transparent; padding-left:0; font-style:normal; opacity:0.85;">
        ${escapeHtml(flavorText)}
      </div>
    `;
  },

  renderExceptionNotice(item) {
    if (item.isDatabaseException) {
      return `
        <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
          <div class="mod-name">Not in the Database menu</div>
          <div class="mod-effect-line">
            This item exists in the game's inventory-system data (full stats, real name and
            description) but isn't registered in the in-game Database menu's own item list at
            all — confirmed by a direct comparison, not assumed. Shown here anyway since it's a
            real, fully-described item; just flagged as an exception to where this section's
            list normally comes from.
          </div>
        </div>
      `;
    }
    if (item.missingFromItemDataAsset) {
      return `
        <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
          <div class="mod-name">No stats record found</div>
          <div class="mod-effect-line">
            This item is registered in the Database menu (real name, description, and database
            thumbnail) but has no matching record in the game's inventory-stats data at all — no
            rarity, stack size, or buy/sell value exists anywhere in this export for it,
            confirmed by checking every relevant source before this was built, not assumed.
            Rarity/stack/buy-sell are left blank above rather than guessed.
          </div>
        </div>
      `;
    }
    return "";
  },

  // ============================================================
  // Recipes tab: cost, materials, produced item, sourced like mods
  // ============================================================

  renderRecipesTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="recipeQuickCoverage"></div>
      <div class="type-tabs" id="recipeCategoryTabs"></div>
      <div class="toolbar" id="recipeToolbar"></div>
      <div class="equip-layout" style="grid-template-columns: 360px 1fr;">
        <div id="recipeListPane"></div>
        <div id="recipeDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    const all = DataStore.getAllRecipesFlat();
    const namedCount = all.filter((r) => DataStore.isRecipeNameVerified(r.itemKey)).length;
    document.getElementById("recipeQuickCoverage").innerHTML = `
      <span><b>${all.length}</b> recipes loaded</span>
      <span><b>${namedCount}</b>/${all.length} names resolved</span>
      <span style="margin-left:auto; opacity:0.6;">Not in any in-game Database menu — inventory-system data only, see Data Coverage</span>
    `;

    this.renderRecipeCategoryTabs();
    this.renderRecipeToolbar();
    this.renderRecipeListPane();
    this.renderRecipeDetail();
  },

  renderRecipeCategoryTabs() {
    const el = document.getElementById("recipeCategoryTabs");
    const cats = (DataStore.recipeCategoryIndex && DataStore.recipeCategoryIndex.categoryCounts) || {};
    el.innerHTML = Object.keys(cats).map((catKey) => {
      const active = catKey === this.state.activeRecipeCategory;
      return `<button class="toggle-btn${active ? " active" : ""}" data-recipecat="${escapeHtml(catKey)}" style="margin:2px;">${escapeHtml(catKey)} <span style="opacity:0.6;">(${cats[catKey]})</span></button>`;
    }).join("");
    el.querySelectorAll("[data-recipecat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.activeRecipeCategory = btn.dataset.recipecat;
        this.state.selectedRecipeKey = null;
        this.renderRecipeCategoryTabs();
        this.renderRecipeListPane();
        this.renderRecipeDetail();
      });
    });
  },

  renderRecipeToolbar() {
    const el = document.getElementById("recipeToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="recipeSearchInput" placeholder="Search by recipe name or what it produces..." value="${escapeHtml(this.state.recipeSearch)}" />
    `;
    document.getElementById("recipeSearchInput").addEventListener("input", (e) => {
      this.state.recipeSearch = e.target.value;
      this.renderRecipeListPane();
    });
  },

  getFilteredRecipes() {
    let recipes = DataStore.recipesByCategory[this.state.activeRecipeCategory] || [];
    const q = this.state.recipeSearch.trim().toLowerCase();
    if (q) {
      recipes = recipes.filter((r) => {
        const name = DataStore.getRecipeDisplayName(r.itemKey).toLowerCase();
        const produced = DataStore.getRecipeProducedItemInfo(r);
        const producedName = produced ? produced.name.toLowerCase() : "";
        return name.includes(q) || producedName.includes(q);
      });
    }
    return recipes;
  },

  renderRecipeListPane() {
    const pane = document.getElementById("recipeListPane");
    const recipes = this.getFilteredRecipes();

    if (recipes.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No recipes match</h4>
            <p>Try clearing the search or picking another category.</p>
          </div>
        </div>
      `;
      return;
    }

    const list = document.createElement("div");
    recipes.forEach((r) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (r.itemKey === this.state.selectedRecipeKey ? " selected" : "");
      const verified = DataStore.isRecipeNameVerified(r.itemKey);
      row.innerHTML = `
        <span class="wl-icon"><img src="${r.textures.icon}" alt="" loading="lazy" /></span>
        <span class="wl-name">${escapeHtml(DataStore.getRecipeDisplayName(r.itemKey))}</span>
        ${!verified ? '<span class="pill unverified">unresolved</span>' : ""}
        <span class="wl-id">${r.itemKey}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedRecipeKey = r.itemKey;
        this.renderRecipeListPane();
        this.renderRecipeDetail();
      });
      list.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedRecipeKey || !recipes.find((r) => r.itemKey === this.state.selectedRecipeKey)) {
      this.state.selectedRecipeKey = recipes[0].itemKey;
    }
  },

  renderRecipeDetail() {
    const detailPane = document.getElementById("recipeDetailPane");
    const recipe = DataStore.recipesByItemKey[this.state.selectedRecipeKey];

    if (!recipe) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a recipe</p></div></div>`;
      return;
    }

    const verified = DataStore.isRecipeNameVerified(recipe.itemKey);
    const displayName = DataStore.getRecipeDisplayName(recipe.itemKey);
    const description = DataStore.getRecipeDescription(recipe.itemKey);
    const descVerified = DataStore.isRecipeDescriptionVerified(recipe.itemKey);
    const produced = DataStore.getRecipeProducedItemInfo(recipe);
    const materials = DataStore.getRecipeMaterialsInfo(recipe);

    // Source attribution mirrors the Unique MOD callout's convention
    // conceptually (name/key up top, source reference kept separate
    // from the main content so it doesn't compete for attention) --
    // but uses its own .source-footnote class rather than
    // .mod-source-tag, since that class is scoped to require a
    // .mod-callout ancestor (display:flex header) and silently
    // wouldn't apply at all in this standalone context.
    const sourceFootnote = `
      <div class="source-footnote">
        Recipe name/desc: ItemDataAsset.json → ${escapeHtml(recipe.category)}RecipeDataAsMap["${escapeHtml(recipe.recipeKey)}"],
        template-substituted with the produced item's localized name.<br/>
        Materials + cost: same record's <code>RecipeItems</code> / <code>Col</code> fields.
      </div>
    `;

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Recipe Preview</h3>
        <div class="preview-img-wrap zoomable-icon scan-frame" style="width:96px; height:96px; margin:0 auto 12px;">
          <img src="${recipe.textures.icon}" alt="" />
        </div>
        <div class="preview-name ${verified ? "" : "unverified"}">${escapeHtml(displayName)}</div>
        <div class="preview-itemkey">${recipe.itemKey} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified — no localization found</span>'}</div>

        ${description ? `<div class="item-description${descVerified ? "" : " unverified-desc"}">${escapeHtml(description)}</div>` : ""}

        <div style="width:100%; text-align:left; font-size:12px; color:var(--hud-text-dim); margin-top:14px; line-height:1.7;">
          <div>Cost to craft: <b style="color:var(--hud-text);">${recipe.colCost != null ? recipe.colCost + " Col" : "—"}</b></div>
        </div>
        ${sourceFootnote}
      </div>

      <div class="hud-panel" style="margin-top:14px;">
        <h3>Produces</h3>
        ${produced ? `
          <div class="mod-callout${produced.verified ? "" : " unresolved"}" style="width:100%; text-align:left;">
            <div class="mod-name">${escapeHtml(produced.name)}${!produced.verified ? ' <span class="pill unverified">unverified name</span>' : ""}</div>
            <div class="mod-key">${escapeHtml(produced.itemKey)}</div>
            ${produced.description ? `<div class="mod-description">${escapeHtml(produced.description)}</div>` : ""}
          </div>
        ` : `
          <div class="empty-state" style="padding:16px 10px;">
            <p style="font-size:12px;">This recipe's own name has no localization entry anywhere in this export, so what it produces can't be determined from the template — confirmed by checking the raw source directly, not assumed.</p>
          </div>
        `}
      </div>

      <div class="hud-panel" style="margin-top:14px;">
        <h3>Materials Needed (${materials.length})</h3>
        <table class="acv-table">
          <thead><tr><th>Material</th><th>Quantity</th></tr></thead>
          <tbody>
            ${materials.map((m) => `
              <tr>
                <td style="text-align:left;">${escapeHtml(m.name)}${!m.verified ? ' <span class="pill unverified" style="font-size:9px;">unverified</span>' : ""}</td>
                <td class="contrib">×${m.quantity}</td>
              </tr>
            `).join("") || '<tr><td colspan="2">No materials listed.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  },
};

