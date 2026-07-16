// ============================================================
// item-sources-panel.js
// A shared "Sources & Crafting" preview panel for Weapons, Armor, and
// Items (Consumables/Materials/Key Items) -- one render function so
// all three category browsers show this information identically
// rather than three near-duplicate implementations.
//
// Built from Content/ROD/DataAssets/Database/ItemSources/
// ItemSources.json (build_item_sources() in build_pipeline.py), a
// cross-reference already assembled server-side from Recipes,
// Chests, Monsters > Drops, and Shops -- this file only renders what
// that builder computed, it does not re-derive anything.
//
// LAYOUT: rows show a small item icon (via DataStore.getItemIconPath,
// works across weapon/armor/item categories transparently) next to
// each name -- materials, produced items, etc. -- rather than plain
// text lists. Longer lists (a material used in many recipes, an item
// dropped by many monsters) use an inline "show N more" expander
// instead of a nested scrollbar: a scroll box inside an already-
// scrollable side panel reads as cramped and easy to miss, and a
// flat expandable list keeps the whole panel's height predictable.
//
// HONESTY: every sub-section states its source plainly, and if an
// item has NO known source at all (no recipe, no chest hit, no drop
// hit), that's shown as an explicit statement rather than an empty,
// unexplained gap -- consistent with the rest of the toolkit's "state
// what's confirmed vs. absent" convention.
// ============================================================

const ITEM_SOURCES_INLINE_LIMIT = 5;

function itemSourcesIconHtml(itemKey) {
  const icon = DataStore.getItemIconPath ? DataStore.getItemIconPath(itemKey) : null;
  return icon
    ? `<img src="${icon}" alt="" style="width:18px; height:18px; object-fit:contain; border-radius:3px; background:rgba(0,0,0,0.25); flex-shrink:0;"/>`
    : `<span style="width:18px; height:18px; flex-shrink:0;"></span>`;
}

// A flat, expandable list -- shows the first ITEM_SOURCES_INLINE_LIMIT
// rows, with a "+N more" toggle that expands in place (no nested
// scroll container). `rowHtmlFn(item)` renders one row's inner HTML.
function expandableListHtml(sectionId, items, rowHtmlFn) {
  const shown = items.slice(0, ITEM_SOURCES_INLINE_LIMIT);
  const rest = items.slice(ITEM_SOURCES_INLINE_LIMIT);
  const rowsHtml = (list) => list.map((item) => `
    <div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:11.5px; color:var(--hud-text); line-height:1.5;">
      ${rowHtmlFn(item)}
    </div>
  `).join("");
  if (!rest.length) return rowsHtml(shown);
  const restId = `${sectionId}-rest`;
  return `
    ${rowsHtml(shown)}
    <div id="${restId}" style="display:none;">${rowsHtml(rest)}</div>
    <div class="item-sources-expand-toggle" data-target="${restId}" data-more-label="+${rest.length} more" data-less-label="Show less"
         style="font-size:10.5px; color:var(--db-cyan-bright); cursor:pointer; padding:2px 0; user-select:none;">+${rest.length} more</div>
  `;
}

function bindExpandToggles(container) {
  container.querySelectorAll(".item-sources-expand-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const target = document.getElementById(toggle.dataset.target);
      if (!target) return;
      const isHidden = target.style.display === "none";
      target.style.display = isHidden ? "block" : "none";
      toggle.textContent = isHidden ? toggle.dataset.lessLabel : toggle.dataset.moreLabel;
    });
  });
}

function renderItemSourcesPanelHtml(itemKey) {
  const src = DataStore.getItemSources ? DataStore.getItemSources(itemKey) : null;
  if (!DataStore.itemSourcesIndex) {
    return ""; // section not built on this instance yet -- omit silently rather than show a broken panel
  }
  if (!src) {
    return `
      <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:4px;">Sources &amp; Crafting</div>
        <div style="font-size:11px; color:var(--hud-text-dim);">No cross-reference entry for this item.</div>
      </div>
    `;
  }

  const sections = [];
  const uid = itemKey.replace(/[^A-Za-z0-9]/g, "");

  if (src.recipe) {
    const r = src.recipe;
    const materials = DataStore.getRecipeMaterialsInfo ? DataStore.getRecipeMaterialsInfo(r) : (r.materials || []);
    const recipeName = DataStore.getRecipeDisplayName ? DataStore.getRecipeDisplayName(r.itemKey) : r.itemKey;
    sections.push(`
      <div style="margin-bottom:10px;">
        <div style="font-family:var(--font-display); font-size:11.5px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:4px;">Crafted via Recipe</div>
        <div style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--hud-text); margin-bottom:2px;">
          ${itemSourcesIconHtml(r.itemKey)}
          <span>${escapeHtml(recipeName)} <span style="opacity:0.55; font-size:10.5px;">(${escapeHtml(r.categoryLabel || r.category)})</span></span>
        </div>
        <div style="font-size:11.5px; color:var(--hud-text-dim); margin-bottom:4px;">Cost: <span style="color:var(--hud-text);">${r.colCost != null ? r.colCost + " Col" : "—"}</span></div>
        ${materials.length ? `
          <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:2px;">Materials:</div>
          <div style="padding-left:4px;">
            ${materials.map((m) => `
              <div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:11.5px; color:var(--hud-text);">
                ${itemSourcesIconHtml(m.itemKey)}<span>${escapeHtml(m.name)} <span style="opacity:0.6;">×${m.quantity}</span></span>
              </div>
            `).join("")}
          </div>
        ` : ""}
        <div style="font-size:10px; color:var(--hud-text-dim); margin-top:4px;">Source: <code>DataAssets/Items/ItemDataAsset.json</code> (recipe maps) — see Items › Recipes.</div>
      </div>
    `);

    if (src.recipeAvailableInShops.length) {
      sections.push(`
        <div style="margin-bottom:10px;">
          <div style="font-family:var(--font-display); font-size:11.5px; font-weight:600; color:var(--hud-sp); margin-bottom:4px;">Recipe Sold In</div>
          ${src.recipeAvailableInShops.map((shopId) => `<div style="font-size:12px; color:var(--hud-text);">Shop ${escapeHtml(shopId)} <span style="opacity:0.55; font-size:10.5px;">(town unconfirmed — see Items › Shops)</span></div>`).join("")}
        </div>
      `);
    }
    if (src.recipeFoundInChests.length) {
      sections.push(renderLocationSection(`rfic-${uid}`, "Recipe Found In Chests", src.recipeFoundInChests, "#FFD54A"));
    }
    if (src.recipeDroppedByMonsters.length) {
      sections.push(renderDropSection(`rdbm-${uid}`, "Recipe Dropped By", src.recipeDroppedByMonsters));
    }
  }

  if (src.foundInChests.length) {
    sections.push(renderLocationSection(`fic-${uid}`, "Found Directly In Chests", src.foundInChests, "#FFD54A"));
  }
  if (src.droppedByMonsters.length) {
    sections.push(renderDropSection(`dbm-${uid}`, "Dropped Directly By", src.droppedByMonsters));
  }

  if (src.usedAsMaterialIn.length) {
    const sectionId = `uami-${uid}`;
    sections.push(`
      <div style="margin-bottom:10px;">
        <div style="font-family:var(--font-display); font-size:11.5px; font-weight:600; color:var(--hud-hp); margin-bottom:4px;">Used As a Material In (${src.usedAsMaterialIn.length})</div>
        ${expandableListHtml(sectionId, src.usedAsMaterialIn, (u) => {
          const name = DataStore.getRecipeDisplayName ? DataStore.getRecipeDisplayName(u.itemKey) : u.itemKey;
          return `${itemSourcesIconHtml(u.producedItemKey || u.itemKey)}<span>${escapeHtml(name)} <span style="opacity:0.55;">×${u.quantity}</span></span>`;
        })}
      </div>
    `);
  }

  const hasAnySource = src.recipe || src.foundInChests.length || src.droppedByMonsters.length
    || src.recipeFoundInChests.length || src.recipeDroppedByMonsters.length || src.usedAsMaterialIn.length;

  const sourceFiles = [...new Set([...(src.sourceDataTables || []), ...(src.sourceDataAssets || [])])];

  const html = `
    <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;" id="itemSourcesPanel-${uid}">
      <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">Sources &amp; Crafting</div>
      ${hasAnySource ? sections.join("") : `
        <div style="font-size:11.5px; color:var(--hud-text-dim); margin-bottom:8px;">
          No recipe, chest, or monster-drop source found in this export for this item — it may
          come from a quest reward, an unexported system, or simply isn't obtainable data this
          toolkit can see yet. Not an error; stated plainly rather than left blank.
        </div>
      `}
      ${sourceFiles.length ? `
        <div style="font-size:10px; color:var(--hud-text-dim); margin-top:6px; padding-top:6px; border-top:1px solid var(--hud-border);">
          Built from: ${sourceFiles.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}
        </div>
      ` : ""}
    </div>
  `;

  // The three preview views append this HTML synchronously into a
  // detail pane's innerHTML; bind the expand toggles right after via
  // a microtask so the elements exist in the DOM by the time this runs.
  queueMicrotask(() => {
    const panel = document.getElementById(`itemSourcesPanel-${uid}`);
    if (panel) bindExpandToggles(panel);
  });

  return html;
}

function renderLocationSection(sectionId, title, hits, color) {
  return `
    <div style="margin-bottom:10px;">
      <div style="font-family:var(--font-display); font-size:11.5px; font-weight:600; color:${color}; margin-bottom:4px;">${escapeHtml(title)} (${hits.length})</div>
      ${expandableListHtml(sectionId, hits, (h) => {
        // Resolve the chest's location fragment to its Field Map area
        // via worldMapIndex.locationToGate (built by the world_map
        // section). Older WorldMap builds lack the map -- the
        // text-only fallback keeps rendering.
        const gate = (DataStore.worldMapIndex && DataStore.worldMapIndex.locationToGate && DataStore.worldMapIndex.locationToGate[h.location]) || null;
        return `
        <span style="font-family:var(--font-mono); color:var(--db-cyan-bright);">${escapeHtml(h.chestId)}</span>
        ${h.location ? ` <span style="opacity:0.6;">— ${escapeHtml(h.location)}</span>` : ""}
        ${gate ? ` <a href="#" class="isp-open-map" data-gate="${escapeHtml(gate)}" data-chest="${escapeHtml(h.chestId)}"
             style="color:var(--db-cyan-bright); font-size:10px; text-decoration:none; border:1px solid rgba(64,207,216,0.35); border-radius:3px; padding:0 5px; margin-left:4px;"
             title="Open area ${escapeHtml(gate)} on the Field Map with this chest highlighted">📍 map</a>` : ""}
      `;})}
      <div style="font-size:10px; color:var(--hud-text-dim); margin-top:2px;">📍 map opens the chest's area on World › Map with its pin highlighted (pin position is approximate until placed-actor exports are uploaded).</div>
    </div>
  `;
}

function renderDropSection(sectionId, title, hits) {
  return `
    <div style="margin-bottom:10px;">
      <div style="font-family:var(--font-display); font-size:11.5px; font-weight:600; color:var(--rank-a); margin-bottom:4px;">${escapeHtml(title)} (${hits.length})</div>
      ${expandableListHtml(sectionId, hits, (h) => `
        <span>${escapeHtml(DataStore.getDropSourceMonsterName ? DataStore.getDropSourceMonsterName(h) : (h.enemyCode || h.rewardKey))}</span>
      `)}
    </div>
  `;
}


// "Open on map" deep links from item source panels -- one delegated
// listener (panels re-render constantly; per-render wiring would leak).
document.addEventListener("click", (ev) => {
  const a = ev.target.closest && ev.target.closest(".isp-open-map");
  if (!a) return;
  ev.preventDefault();
  // const App doesn't attach to window -- reference the lexical global.
  if (typeof App !== "undefined" && typeof App.openMapArea === "function") {
    App.openMapArea(a.dataset.gate, a.dataset.chest);
  }
});
