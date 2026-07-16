// ============================================================
// shops-browser.js
// Browser for Items > Shops -- the six shops of
// DT_ShopItemList.json's single "Shop" row.
//
// The load-bearing confirmed discovery: SHOPS SELL RECIPES. Every
// stock entry is a Cost-category recipe purchase token, and all 59
// entries across the six shops resolve 1:1 to a recipe's real
// ItemKey (0 duplicates, 0 misses). This view joins those keys
// against the SAME loaded Recipes data the Items > Recipes tab
// renders (names, Col costs, materials, produced items) -- one
// source, can't disagree.
//
// HONESTLY UNCONFIRMED: which shop is in which town. Six shops / six
// towns is a suggestive count match (the same 001-006 numbering
// DT_NPC uses), but NO field links a shop key to a town -- shops are
// shown as "Shop 1".."Shop 6" with that caveat visible.
// ============================================================

const ShopsBrowserView = {
  state: { selectedShopId: null, tab: "shoplist" },

  render(container) {
    // Clear first. This view used to rely on the ROUTER having emptied
    // the container -- true on a route change, but NOT when the view
    // re-renders itself (which the new tabs do). Every tab click was
    // appending a second, third, fourth copy of the whole view below
    // the first: the "weird sections at the bottom", and the reason the
    // tabs looked frozen (getElementById kept finding the STALE first
    // copy's panes and updating those, off-screen above).
    container.innerHTML = "";
    this._container = container;
    const idx = DataStore.shopIndex || {};
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${idx.count || 0}</b> shops</span>
        <span><b>${idx.stockTotal || 0}</b> stock entries</span>
        <span><b>${idx.recipeResolved || 0}</b>/${idx.stockTotal || 0} resolve to recipes</span>
        <span style="margin-left:auto; opacity:0.6;" title="Six shops and six towns is a suggestive count match, but no field in DT_ShopItemList links a shop key to a town — deliberately not assigned.">shop→town mapping unconfirmed</span>
      </div>
      <div class="sub-tabs" id="shopTabs" style="margin-bottom:12px;">
        ${this.TABS.map((t) => `<button class="toggle-btn${this.state.tab === t.key ? " active" : ""}" data-shoptab="${t.key}" title="${escapeHtml(t.role)}">${escapeHtml(t.label)}</button>`).join("")}
      </div>
      <div id="shopTabBody"></div>
    `;
    container.appendChild(wrap);
    // Swap only the tab body + the active pill, rather than re-rendering
    // the whole view: cheaper, and it cannot re-introduce the stacking
    // bug above even if this view is ever mounted twice.
    wrap.querySelectorAll("[data-shoptab]").forEach((b) => b.addEventListener("click", () => {
      this.state.tab = b.dataset.shoptab;
      wrap.querySelectorAll("[data-shoptab]").forEach((x) =>
        x.classList.toggle("active", x.dataset.shoptab === this.state.tab));
      this.renderTabBody(wrap);
    }));
    this.renderTabBody(wrap);
  },

  // The four lists carried by DT_ShopItemList's single "Shop" row.
  // In-game roles are the PLAYER'S OWN observation (stated as such --
  // no field in the export links a list to an NPC), except YellCoin,
  // which nothing has identified yet and is therefore left open rather
  // than assigned a plausible-sounding guess.
  TABS: [
    { key: "shoplist", label: "Shop List", role: "The town Item Seller's stock (player-confirmed)." },
    { key: "merchant", label: "Merchant Create List", role: "Also the Item Seller — what each merchant RANK can create (player-confirmed)." },
    { key: "blacksmith", label: "Blacksmith Create List", role: "The town Smithy — what each blacksmith RANK can forge, per equipment kind (player-confirmed)." },
    { key: "yellcoin", label: "Yell Coin Shop", role: "Consumer unknown — no export field names it. Likely a later-unlock shop, but that is NOT confirmed." },
  ],

  renderTabBody(wrap) {
    const root = wrap || this._container || document;
    const body = root.querySelector("#shopTabBody");
    if (!body) return;
    const tab = this.TABS.find((t) => t.key === this.state.tab) || this.TABS[0];
    body.innerHTML = `
      <div class="mod-callout" style="margin:0 0 12px;">
        <div class="mod-name">${escapeHtml(tab.label)}</div>
        <div class="mod-effect-line">${escapeHtml(tab.role)}</div>
      </div>
      <div id="shopTabContent"></div>
    `;
    const content = document.getElementById("shopTabContent");
    if (this.state.tab === "shoplist") {
      content.innerHTML = `
        <div class="equip-layout two-col" style="--list-col: 240px;">
          <div id="shopListPane"></div>
          <div id="shopDetailPane"></div>
        </div>`;
      this.renderList();
      this.renderDetail();
    } else if (this.state.tab === "merchant") {
      content.innerHTML = this.renderMerchantHtml();
    } else if (this.state.tab === "blacksmith") {
      content.innerHTML = this.renderBlacksmithHtml();
    } else {
      content.innerHTML = this.renderYellCoinHtml();
    }
  },

  renderList() {
    const pane = document.getElementById("shopListPane");
    const el = document.createElement("div");
    (DataStore.shopList || []).forEach((s) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (s.shopId === this.state.selectedShopId ? " selected" : "");
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">Shop ${escapeHtml(s.shopId)}</div>
          <div class="wl-id">${s.entries.length} recipe${s.entries.length === 1 ? "" : "s"} in stock</div>
        </div>
      `;
      row.addEventListener("click", () => {
        this.state.selectedShopId = s.shopId;
        this.renderList();
        this.renderDetail();
      });
      el.appendChild(row);
    });
    pane.innerHTML = "";
    pane.appendChild(el);
    if (!this.state.selectedShopId && (DataStore.shopList || []).length) {
      this.state.selectedShopId = DataStore.shopList[0].shopId;
      this.renderDetail();
    }
  },

  renderDetail() {
    const pane = document.getElementById("shopDetailPane");
    const shop = (DataStore.shopList || []).find((s) => s.shopId === this.state.selectedShopId);
    if (!shop) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a shop</p></div></div>`;
      return;
    }
    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Shop</h3>
        <div class="preview-name">Shop ${escapeHtml(shop.shopId)}</div>
        <div class="preview-itemkey">DT_ShopItemList.json → ShopList["${escapeHtml(shop.shopId)}"]
          <span class="pill unverified" title="No field links this shop to a town — six shops / six towns is a count match only, deliberately not assigned">town unconfirmed</span>
        </div>
        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(64,207,216,0.06); border:1px solid rgba(64,207,216,0.2);">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:2px;">Stock — Recipes for Sale (${shop.entries.length})</div>
          <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:8px;">
            Every entry is a Cost-category recipe purchase token, resolved to the recipe's real
            ItemKey from the data. Prices and materials come from the same Recipes data the
            Items &gt; Recipes tab shows.
          </div>
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="border-bottom:1px solid var(--hud-border);">
              <th style="padding:5px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Recipe</th>
              <th style="padding:5px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);" title="Raw ItemId in DT_ShopItemList — the value RODSchema patches reference">ItemID</th>
              <th style="padding:5px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Category</th>
              <th style="padding:5px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);" title="The recipe's Col cost from ItemDataAsset — see Items &gt; Recipes">Col</th>
            </tr></thead>
            <tbody>
              ${shop.entries.map((e) => {
                const recipe = e.recipeItemKey ? DataStore.getRecipeByItemKey(e.recipeItemKey) : null;
                return `<tr style="border-bottom:1px solid rgba(135,200,210,0.08);">
                  <td style="padding:5px 10px; font-size:13px;">${recipe
                    ? `${escapeHtml(DataStore.getRecipeDisplayName(recipe.itemKey))} <span style="opacity:0.55; font-size:11px;">(see Items › Recipes)</span>`
                    : `<span style="color:var(--hud-text-dim);" title="This Cost id resolves to no recipe in ItemDataAsset — shown raw, not faked">${escapeHtml(e.category)} #${e.itemId}</span>`}</td>
                  <td style="padding:5px 10px; text-align:right; font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright);">${e.itemId}</td>
                  <td style="padding:5px 10px; font-size:12px; color:var(--hud-text-dim);">${escapeHtml(recipe ? recipe.categoryLabel : "—")}</td>
                  <td style="padding:5px 10px; text-align:right; font-family:var(--font-mono); font-size:13px;">${recipe ? recipe.colCost : "—"}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /**
   * The other three lists carried by the SAME "Shop" row (confirmed
   * fields of it, not separate tables): the Yell-coin vendor stock,
   * and the Merchant/Blacksmith per-RANK craft lists. Rendered once
   * under whichever shop is selected since they're row-global, with
   * raw ItemIDs shown everywhere (the values RODSchema patches use).
   */
  recipeCell(r) {
    const recipe = r.recipeItemKey ? DataStore.getRecipeByItemKey(r.recipeItemKey) : null;
    return `<span style="font-family:var(--font-mono); color:var(--db-cyan-bright);">#${r.itemId}</span> ${recipe
      ? escapeHtml(DataStore.getRecipeDisplayName(recipe.itemKey))
      : `<span style="color:var(--hud-text-dim);" title="Nothing in ItemDataAsset claims this id under this kind — shown raw, not guessed">unresolved</span>`}`;
  },

  renderMerchantHtml() {
    const list = (DataStore.shopExtras || {}).merchantCreateList || [];
    if (!list.length) return `<div class="empty-state"><p>No MerchantCreateList in this build.</p></div>`;
    return list.map((m) => `
      <div class="hud-panel" style="padding:12px 14px; margin-bottom:10px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text);">Rank ${escapeHtml(String(m.rank))} <span style="opacity:0.6; font-weight:400;">— ${m.recipes.length} recipe${m.recipes.length === 1 ? "" : "s"}</span></div>
        <div style="font-size:11.5px; line-height:1.9; margin-top:4px;">${m.recipes.map((r) => this.recipeCell(r)).join(" · ")}</div>
      </div>`).join("") +
      `<div style="font-size:10px; color:var(--hud-text-dim);">IDs here are <b>Cost tokens</b> (the purchasable-recipe item ids) — the same space DT_ShopItemList stock uses.</div>`;
  },

  renderBlacksmithHtml() {
    const list = (DataStore.shopExtras || {}).blacksmithCreateList || [];
    if (!list.length) return `<div class="empty-state"><p>No BlacksmithCreateList in this build.</p></div>`;
    return list.map((b) => `
      <div class="hud-panel" style="padding:12px 14px; margin-bottom:10px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text);">Rank ${escapeHtml(String(b.rank))}${b.kinds.length ? "" : ' <span style="opacity:0.55; font-weight:400;">— empty in the export (the game\'s own data)</span>'}</div>
        ${b.kinds.map((k) => `
          <div style="font-size:11.5px; line-height:1.9; margin-top:3px;">
            <b style="color:var(--db-cyan-bright);">${escapeHtml(k.kind)}</b>: ${k.recipes.map((r) => this.recipeCell(r)).join(" · ")}
          </div>`).join("")}
      </div>`).join("") +
      `<div style="font-size:10px; color:var(--hud-text-dim);">IDs here are <b>recipe-map keys scoped by ERecipeKind</b> — a different id space from the shop's Cost tokens (Upper #5001 means UpperRecipeDataAsMap["5001"], and the same number under a different kind is a different recipe).</div>`;
  },

  renderYellCoinHtml() {
    const items = (DataStore.shopExtras || {}).yellCoinShopItems || [];
    if (!items.length) return `<div class="empty-state"><p>YellCoinShopItems is empty in this build.</p></div>`;
    return `
      <div class="hud-panel" style="padding:12px 14px;">
        ${items.map((i) => `<div style="font-size:12px; line-height:1.9;"><span style="font-family:var(--font-mono); color:var(--db-cyan-bright);">#${i.itemId}</span> <span style="color:var(--hud-text-dim);">${escapeHtml(i.category)}</span></div>`).join("")}
      </div>
      <div style="font-size:10px; color:var(--hud-text-dim); margin-top:6px;">Direct items (not recipe tokens). Which in-game vendor consumes this list is <b>not stated by any field in the export</b> — left unassigned rather than guessed.</div>`;
  },};
