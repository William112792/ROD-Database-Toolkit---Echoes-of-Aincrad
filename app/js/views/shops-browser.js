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
  state: { selectedShopId: null },

  render(container) {
    const idx = DataStore.shopIndex || {};
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${idx.count || 0}</b> shops</span>
        <span><b>${idx.stockTotal || 0}</b> stock entries</span>
        <span><b>${idx.recipeResolved || 0}</b>/${idx.stockTotal || 0} resolve to recipes</span>
        <span style="margin-left:auto; opacity:0.6;" title="Six shops and six towns is a suggestive count match, but no field in DT_ShopItemList links a shop key to a town — deliberately not assigned.">shop→town mapping unconfirmed</span>
      </div>
      <div class="equip-layout two-col" style="--list-col: 240px;">
        <div id="shopListPane"></div>
        <div id="shopDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderList();
    this.renderDetail();
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
};
