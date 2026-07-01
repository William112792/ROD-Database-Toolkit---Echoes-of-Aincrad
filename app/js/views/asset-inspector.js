// ============================================================
// asset-inspector.js
// Browser for the Asset Inspector index -- Materials (166: 145
// MaterialInstanceConstant with real named parameters, 21 base
// Material with only structural metadata) and Meshes (228 avatar/
// equipment mesh-asset-path references, cross-referenced into the
// EXISTING Weapons/Armor sections by the same ID convention, not a
// separate namespace).
//
// Two sub-tabs, same tab-of-tabs pattern as Items (Catalog/Recipes)
// and Characters (Characters/Partners/Customization) -- Materials and
// Meshes are genuinely different shapes (named parameters vs. asset-
// path cross-references), not one flat list pretending to be uniform.
// ============================================================

const AssetInspectorView = {
  state: {
    activeMainTab: "materials", // "materials" | "meshes"
    materialSearch: "",
    materialTypeFilter: "all", // "all" | "instance" | "base"
    selectedMaterialPath: null,
    meshSlotFilter: "all",
    selectedMeshPath: null,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-panel" style="margin-bottom:14px;">
        <p style="font-size:12px; color:var(--hud-text-dim); margin:0; line-height:1.6;">
          Materials and meshes referenced throughout the game's avatar/equipment system.
          <b>MaterialInstanceConstant</b> assets carry real, named parameters (the exact name +
          type a mod's own material instance needs to match in order to auto-link to the game's
          material system) — <b>base Material</b> assets do not expose named parameters in this
          export (their values exist as unnamed numeric arrays; shown honestly as counts, not
          guessed names). Meshes are cross-referenced directly into the existing Weapons/Armor
          sections by the same item ID, not a separate namespace.
        </p>
      </div>

      <div class="toolbar" id="assetMainTabBar" style="margin-bottom:14px;"></div>
      <div id="assetMainTabContent"></div>
    `;
    container.appendChild(wrap);

    this.renderMainTabBar();
    this.renderActiveMainTab();
  },

  renderMainTabBar() {
    const el = document.getElementById("assetMainTabBar");
    const matCount = DataStore.assetInspectorIndex ? DataStore.assetInspectorIndex.materialCount : 0;
    const meshCount = DataStore.assetInspectorIndex ? DataStore.assetInspectorIndex.meshCount : 0;
    const tabs = [
      ["materials", `Materials (${matCount})`],
      ["meshes", `Meshes (${meshCount})`],
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
    const container = document.getElementById("assetMainTabContent");
    container.innerHTML = "";
    if (this.state.activeMainTab === "meshes") {
      this.renderMeshesTab(container);
    } else {
      this.renderMaterialsTab(container);
    }
    // Re-trigger the fade-in animation: removing the class, forcing a
    // reflow via offsetWidth, then re-adding it is the standard way to
    // restart a CSS animation on an element that already had it applied
    // (just re-adding the same class with no reflow in between is a
    // no-op, since the browser sees no actual class-list change).
    container.classList.remove("tab-content-fade-in");
    void container.offsetWidth;
    container.classList.add("tab-content-fade-in");
  },

  // ============================================================
  // Materials tab
  // ============================================================

  renderMaterialsTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="toolbar" style="margin-bottom:10px;">
        <input type="text" class="search-input" id="assetMaterialSearch" placeholder="Search by material or parent name..." />
        <select class="filter-select" id="assetMaterialTypeFilter">
          <option value="all">All Types</option>
          <option value="instance">MaterialInstanceConstant only</option>
          <option value="base">Base Material only</option>
        </select>
      </div>
      <div class="equip-layout" style="grid-template-columns: 380px 1fr;">
        <div id="assetMaterialListPane" class="list-pane-self-managed"></div>
        <div id="assetMaterialDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    document.getElementById("assetMaterialSearch").addEventListener("input", (e) => {
      this.state.materialSearch = e.target.value;
      this.renderMaterialList();
    });
    document.getElementById("assetMaterialTypeFilter").addEventListener("change", (e) => {
      this.state.materialTypeFilter = e.target.value;
      this.renderMaterialList();
    });

    this.renderMaterialList();
    this.renderMaterialDetail();
  },

  getFilteredMaterials() {
    let list = DataStore.assetMaterials || [];
    if (this.state.materialTypeFilter === "instance") {
      list = list.filter((m) => m.assetType === "MaterialInstanceConstant");
    } else if (this.state.materialTypeFilter === "base") {
      list = list.filter((m) => m.assetType === "Material");
    }
    const q = this.state.materialSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        (m.name || "").toLowerCase().includes(q) || (m.parent || "").toLowerCase().includes(q)
      );
    }
    return list;
  },

  renderMaterialList() {
    const pane = document.getElementById("assetMaterialListPane");
    const items = this.getFilteredMaterials();

    if (items.length === 0) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state" style="padding:30px 10px;"><div class="empty-icon">🔍</div><p>No materials match.</p></div></div>`;
      return;
    }

    const list = document.createElement("div");
    list.className = "hud-panel";
    list.style.maxHeight = "calc(100vh - 360px)";
    list.style.overflowY = "auto";
    list.innerHTML = `<h3>${items.length} material${items.length === 1 ? "" : "s"}</h3>`;

    items.forEach((m) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (m.path === this.state.selectedMaterialPath ? " selected" : "");
      row.style.flexDirection = "column";
      row.style.alignItems = "flex-start";
      row.style.gap = "2px";
      const isInstance = m.assetType === "MaterialInstanceConstant";
      row.innerHTML = `
        <span class="wl-name" style="font-size:12px; font-family:var(--font-mono);">${escapeHtml(m.name || "—")}</span>
        <span class="wl-id" style="font-size:10px;">${isInstance ? `Parent: ${escapeHtml(m.parent || "—")}` : "Base Material"}</span>
        ${isInstance ? `<span class="pill verified" style="font-size:9px;">${m.scalarParameters.length + m.vectorParameters.length + m.textureParameters.length} named params</span>` : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedMaterialPath = m.path;
        this.renderMaterialList();
        this.renderMaterialDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedMaterialPath || !items.find((m) => m.path === this.state.selectedMaterialPath)) {
      this.state.selectedMaterialPath = items[0].path;
    }
  },

  renderMaterialDetail() {
    const pane = document.getElementById("assetMaterialDetailPane");
    const m = (DataStore.assetMaterials || []).find((x) => x.path === this.state.selectedMaterialPath);

    if (!m) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a material</p></div></div>`;
      return;
    }

    if (m.assetType === "Material") {
      pane.innerHTML = `
        <div class="hud-panel">
          <h3 style="font-family:var(--font-mono); font-size:15px;">${escapeHtml(m.name)}</h3>
          <span class="pill" style="background:rgba(169,127,228,0.15); color:var(--hud-mod);">Base Material</span>
          <div style="font-size:12px; color:var(--hud-text-dim); margin-top:10px; line-height:1.8;">
            <div>Material Domain: <b style="color:var(--hud-text);">${escapeHtml(m.materialDomain || "—")}</b></div>
            <div>Blend Mode: <b style="color:var(--hud-text);">${escapeHtml(m.blendMode || "—")}</b></div>
          </div>
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">Parameter names not resolvable in this export</div>
            <div class="mod-effect-line">
              This base Material has ${m.scalarValueCount} scalar, ${m.vectorValueCount} vector, and
              ${m.textureValueCount} texture value(s) stored in its compiled data — but their NAMES live
              in a separate, more complex index-mapping structure not reliably decoded here. Rather than
              risk mislabeling a value with the wrong parameter name, only the value counts are shown.
              Any MaterialInstanceConstant using this as its Parent (see the Materials list, filtered to
              "MaterialInstanceConstant only") DOES have real named parameters, since those are stored
              directly by name in the instance's own data.
            </div>
          </div>
          <div class="source-footnote">Source: raw-export/Content/ROD/${escapeHtml(m.path)}</div>
        </div>
      `;
      return;
    }

    const renderParamTable = (title, params, valueRenderer) => {
      if (params.length === 0) return "";
      return `
        <div style="margin-top:14px;">
          <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${title} (${params.length})</div>
          <table class="acv-table">
            <thead><tr><th>Name</th><th>Value</th></tr></thead>
            <tbody>
              ${params.map((p) => `
                <tr>
                  <td style="text-align:left; font-family:var(--font-mono);">${escapeHtml(p.name || "—")}</td>
                  <td class="contrib">${valueRenderer(p)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    };

    pane.innerHTML = `
      <div class="hud-panel">
        <h3 style="font-family:var(--font-mono); font-size:15px;">${escapeHtml(m.name)}</h3>
        <span class="pill verified">MaterialInstanceConstant</span>
        <div style="font-size:12px; color:var(--hud-text-dim); margin-top:10px;">
          Parent: <b style="color:var(--hud-text); font-family:var(--font-mono);">${escapeHtml(m.parent || "—")}</b>
          ${m.parent ? "" : ""}
        </div>

        ${renderParamTable("Scalar Parameters", m.scalarParameters, (p) => typeof p.value === "number" ? p.value : escapeHtml(String(p.value)))}
        ${renderParamTable("Vector Parameters", m.vectorParameters, (p) => {
          const v = p.value || {};
          return v.Hex ? `<span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:14px; height:14px; border-radius:50%; background:#${escapeHtml(v.Hex)}; display:inline-block; border:1px solid rgba(255,255,255,0.2);"></span>#${escapeHtml(v.Hex)}</span>` : escapeHtml(JSON.stringify(v));
        })}
        ${renderParamTable("Texture Parameters", m.textureParameters, (p) => `<span style="font-size:10px;">${escapeHtml(p.texturePath || "—")}</span>`)}

        ${(m.scalarParameters.length + m.vectorParameters.length + m.textureParameters.length) === 0 ? `
          <div class="empty-state" style="padding:14px 10px;"><p style="font-size:12px;">No parameter overrides on this instance — it uses its parent's defaults as-is.</p></div>
        ` : ""}

        <div class="source-footnote">Source: raw-export/Content/ROD/${escapeHtml(m.path)}</div>
      </div>
    `;
  },

  // ============================================================
  // Meshes tab
  // ============================================================

  renderMeshesTab(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="toolbar" id="assetMeshSlotTabs" style="margin-bottom:10px; flex-wrap:wrap;"></div>
      <div class="equip-layout" style="grid-template-columns: 380px 1fr;">
        <div id="assetMeshListPane" class="list-pane-self-managed"></div>
        <div id="assetMeshDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderMeshSlotTabs();
    this.renderMeshList();
    this.renderMeshDetail();
  },

  /**
   * Only rebuilds the slot-filter toolbar -- never re-creates the list/
   * detail panes from scratch the way an earlier version of this
   * function did (which also relied on guessing at a parent container
   * reference via container.parentElement, the same fragile pattern
   * caught and fixed in CharactersBrowserView's Partners tab earlier
   * this project). Changing the slot filter calls this + renderMeshList()
   * directly instead.
   */
  renderMeshSlotTabs() {
    const slots = [...new Set((DataStore.assetMeshes || []).map((m) => m.slot))];
    const tabsEl = document.getElementById("assetMeshSlotTabs");
    const allSlots = ["all", ...slots];
    tabsEl.innerHTML = allSlots.map((slot) => `
      <button class="toggle-btn${this.state.meshSlotFilter === slot ? " active" : ""}" data-slot="${escapeHtml(slot)}">${slot === "all" ? "All" : escapeHtml(slot)}</button>
    `).join("");
    tabsEl.querySelectorAll("[data-slot]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.meshSlotFilter = btn.dataset.slot;
        this.state.selectedMeshPath = null;
        this.renderMeshSlotTabs();
        this.renderMeshList();
        this.renderMeshDetail();
      });
    });
  },

  getFilteredMeshes() {
    let list = DataStore.assetMeshes || [];
    if (this.state.meshSlotFilter !== "all") {
      list = list.filter((m) => m.slot === this.state.meshSlotFilter);
    }
    return list;
  },

  renderMeshList() {
    const pane = document.getElementById("assetMeshListPane");
    const items = this.getFilteredMeshes();

    if (items.length === 0) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>No meshes match.</p></div></div>`;
      return;
    }

    const list = document.createElement("div");
    list.className = "hud-panel";
    list.style.maxHeight = "calc(100vh - 360px)";
    list.style.overflowY = "auto";
    list.innerHTML = `<h3>${items.length} mesh${items.length === 1 ? "" : "es"}</h3>`;

    items.forEach((m) => {
      const itemName = DataStore.getMeshItemName(m);
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (m.path === this.state.selectedMeshPath ? " selected" : "");
      row.style.flexDirection = "column";
      row.style.alignItems = "flex-start";
      row.style.gap = "2px";
      row.innerHTML = `
        <span class="wl-name" style="font-size:12px;">${escapeHtml(itemName || m.name)}</span>
        <span class="wl-id" style="font-size:10px;">${escapeHtml(m.slot)} #${m.itemId}${itemName ? "" : " — unnamed item"}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedMeshPath = m.path;
        this.renderMeshList();
        this.renderMeshDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedMeshPath || !items.find((m) => m.path === this.state.selectedMeshPath)) {
      this.state.selectedMeshPath = items[0].path;
    }
  },

  renderMeshDetail() {
    const pane = document.getElementById("assetMeshDetailPane");
    const m = (DataStore.assetMeshes || []).find((x) => x.path === this.state.selectedMeshPath);

    if (!m) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a mesh</p></div></div>`;
      return;
    }

    const itemName = DataStore.getMeshItemName(m);
    const verified = DataStore.isMeshItemNameVerified(m);
    const sameMesh = m.malePath === m.femalePath;

    pane.innerHTML = `
      <div class="hud-panel">
        <h3>${escapeHtml(itemName || m.name)}</h3>
        ${itemName ? `<div class="preview-itemkey">${escapeHtml(m.itemKey)} ${verified ? '<span class="pill verified">verified</span>' : '<span class="pill unverified">unverified</span>'}</div>` : ""}

        <div style="font-size:12px; color:var(--hud-text-dim); margin-top:10px; line-height:1.8;">
          <div>Slot: <b style="color:var(--hud-text);">${escapeHtml(m.slot)}</b></div>
          <div>Item ID: <b style="color:var(--hud-text);">${m.itemId}</b></div>
          ${!m.itemKey ? `<div style="opacity:0.7;">This slot is not confirmed to share the Upper/Lower/Glove/Shield item-key convention — shown by raw mesh ID only.</div>` : ""}
          ${m.itemKey && !itemName ? `<div style="opacity:0.7;">This item ID has no name in any of the 13 language files — a pre-existing gap in the Armor/Weapon data, not introduced here.</div>` : ""}
        </div>

        <div style="margin-top:14px;">
          <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${sameMesh ? "Mesh Asset Path" : "Mesh Asset Paths"}</div>
          ${sameMesh ? `
            <div style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all; padding:6px 0;">${escapeHtml(m.malePath || "—")}</div>
          ` : `
            <div style="font-size:11px; color:var(--hud-text-dim);">Male</div>
            <div style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all; padding:2px 0 8px;">${escapeHtml(m.malePath || "—")}</div>
            <div style="font-size:11px; color:var(--hud-text-dim);">Female</div>
            <div style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); word-break:break-all; padding:2px 0;">${escapeHtml(m.femalePath || "—")}</div>
          `}
        </div>

        <div class="source-footnote">Source: raw-export/Content/ROD/${escapeHtml(m.path)}</div>
      </div>
    `;
  },
};
