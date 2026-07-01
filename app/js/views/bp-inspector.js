// ============================================================
// bp-inspector.js
// Browser for the BP Inspector index (37 Widget Blueprint files,
// 87 functions total) -- explicitly scoped to WIDGET Blueprints only.
// No standalone Blueprint (BP_*) or Macro asset exists in any export
// checked, confirmed before this was built; if either ever shows up,
// this view's per-widget detail panel is the place to extend, not a
// reason to assume coverage that doesn't exist yet.
//
// Function-first by design: the user's stated goal was "knowing the
// function name can allow executing the function... like opening the
// Chest Menu or Smithy" -- so this view's primary list is every
// function across every widget (searchable by name), not a tree of
// widgets you have to drill into first. Each function shows its real
// UE FunctionFlags (BlueprintCallable/BlueprintEvent/Public) and any
// extracted real parameters (name + type), distinguished from
// internal compiler-generated locals by the pipeline (see
// build_bp_inspector_index()'s docstring in build_pipeline.py for
// exactly how that distinction is made and verified).
// ============================================================

const BpInspectorView = {
  state: {
    search: "",
    callableOnly: false,
    selectedWidgetPath: null,
    selectedFunctionName: null,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-panel" style="margin-bottom:14px;">
        <p style="font-size:12px; color:var(--hud-text-dim); margin:0; line-height:1.6;">
          Every function found in the game's Widget Blueprint exports (${DataStore.bpInspectorIndex ? DataStore.bpInspectorIndex.count : "—"}
          widgets, ${DataStore.bpInspectorIndex ? DataStore.bpInspectorIndex.totalFunctions : "—"} functions) — scoped honestly to
          <b>Widget Blueprints only</b>. No standalone Blueprint (<code>BP_*</code>) or Macro asset exists in
          any export checked so far; this catalogs what's actually present, not a guess at what
          might exist elsewhere. Each function shows its real UE flags (is it actually callable
          from outside, is it an event hook, is it public) and any extracted real parameter
          names/types — distinguished from internal compiler-generated locals, not just everything
          that happened to be in the function's data.
        </p>
      </div>

      <div class="toolbar" style="margin-bottom:10px;">
        <input type="text" class="search-input" id="bpSearchInput" placeholder="Search by function or widget name..." />
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--hud-text-dim); cursor:pointer;">
          <input type="checkbox" id="bpCallableOnly" />
          BlueprintCallable only
        </label>
      </div>

      <div class="equip-layout" style="grid-template-columns: 420px 1fr;">
        <div id="bpFunctionListPane" class="list-pane-self-managed"></div>
        <div id="bpDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    document.getElementById("bpSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderFunctionList();
    });
    document.getElementById("bpCallableOnly").addEventListener("change", (e) => {
      this.state.callableOnly = e.target.checked;
      this.renderFunctionList();
    });

    this.renderFunctionList();
    this.renderDetail();
  },

  /**
   * Flattens every (widget, function) pair into one searchable list --
   * the same widget's name is repeated per function it owns, since the
   * function itself is the primary unit being browsed here, not the
   * widget.
   */
  getFlatFunctionList() {
    const widgets = DataStore.bpInspectorWidgets || [];
    const flat = [];
    for (const widget of widgets) {
      for (const fn of widget.functions) {
        flat.push({ widget, fn });
      }
    }
    return flat;
  },

  getFilteredFunctions() {
    let list = this.getFlatFunctionList();
    if (this.state.callableOnly) {
      list = list.filter((item) => item.fn.isBlueprintCallable);
    }
    const q = this.state.search.trim().toLowerCase();
    if (q) {
      list = list.filter((item) =>
        item.fn.name.toLowerCase().includes(q) || item.widget.name.toLowerCase().includes(q)
      );
    }
    return list;
  },

  renderFunctionList() {
    const pane = document.getElementById("bpFunctionListPane");
    const items = this.getFilteredFunctions();

    if (items.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel"><div class="empty-state" style="padding:30px 10px;">
          <div class="empty-icon">🔍</div><h4>No functions match</h4>
          <p>Try clearing the search or the BlueprintCallable filter.</p>
        </div></div>
      `;
      return;
    }

    const list = document.createElement("div");
    list.className = "hud-panel";
    list.style.maxHeight = "calc(100vh - 320px)";
    list.style.overflowY = "auto";
    list.innerHTML = `<h3>${items.length} function${items.length === 1 ? "" : "s"}</h3>`;

    items.forEach(({ widget, fn }) => {
      const row = document.createElement("div");
      const isSelected = widget.path === this.state.selectedWidgetPath && fn.name === this.state.selectedFunctionName;
      row.className = "weapon-list-row" + (isSelected ? " selected" : "");
      row.style.flexDirection = "column";
      row.style.alignItems = "flex-start";
      row.style.gap = "2px";
      row.innerHTML = `
        <span class="wl-name" style="font-size:12px; font-family:var(--font-mono);">${escapeHtml(fn.name)}(${fn.parameters.map((p) => escapeHtml(p.name)).join(", ")})</span>
        <span class="wl-id" style="font-size:10px;">${escapeHtml(widget.name)}</span>
        <span style="display:flex; gap:4px; flex-wrap:wrap;">
          ${fn.isBlueprintCallable ? '<span class="pill verified" style="font-size:9px;">Callable</span>' : ""}
          ${fn.isBlueprintEvent ? '<span class="pill" style="font-size:9px; background:rgba(64,207,216,0.15); color:var(--db-cyan-bright);">Event</span>' : ""}
          ${fn.isPublic ? '<span class="pill" style="font-size:9px; background:rgba(169,127,228,0.15); color:var(--hud-mod);">Public</span>' : ""}
        </span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedWidgetPath = widget.path;
        this.state.selectedFunctionName = fn.name;
        this.renderFunctionList();
        this.renderDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedFunctionName || !items.find((i) => i.widget.path === this.state.selectedWidgetPath && i.fn.name === this.state.selectedFunctionName)) {
      this.state.selectedWidgetPath = items[0].widget.path;
      this.state.selectedFunctionName = items[0].fn.name;
    }
  },

  renderDetail() {
    const pane = document.getElementById("bpDetailPane");
    const widget = (DataStore.bpInspectorWidgets || []).find((w) => w.path === this.state.selectedWidgetPath);
    const fn = widget ? widget.functions.find((f) => f.name === this.state.selectedFunctionName) : null;

    if (!widget || !fn) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a function</p></div></div>`;
      return;
    }

    const signature = `${fn.name}(${fn.parameters.map((p) => `${p.name}: ${escapeHtml(p.type || "?")}${p.isOutput ? " [out]" : ""}`).join(", ")})`;

    pane.innerHTML = `
      <div class="hud-panel">
        <h3 style="font-family:var(--font-mono); font-size:15px;">${escapeHtml(signature)}</h3>
        <div style="display:flex; gap:6px; margin:8px 0;">
          ${fn.isBlueprintCallable ? '<span class="pill verified">BlueprintCallable</span>' : '<span class="pill unverified">Not externally callable</span>'}
          ${fn.isBlueprintEvent ? '<span class="pill" style="background:rgba(64,207,216,0.15); color:var(--db-cyan-bright);">BlueprintEvent</span>' : ""}
          ${fn.isPublic ? '<span class="pill" style="background:rgba(169,127,228,0.15); color:var(--hud-mod);">Public</span>' : '<span class="pill" style="opacity:0.6;">Not public</span>'}
        </div>

        <div style="font-size:12px; color:var(--hud-text-dim); margin-top:10px;">
          <div>From widget: <b style="color:var(--hud-text); font-family:var(--font-mono);">${escapeHtml(widget.name)}</b></div>
          <div>Export path: <span style="font-family:var(--font-mono); font-size:10px;">${escapeHtml(widget.path)}</span></div>
        </div>

        ${fn.parameters.length > 0 ? `
          <div style="margin-top:14px;">
            <div style="font-size:13px; font-weight:600; margin-bottom:6px;">Parameters (${fn.parameters.length})</div>
            <table class="acv-table">
              <thead><tr><th>Name</th><th>Type</th><th>Direction</th></tr></thead>
              <tbody>
                ${fn.parameters.map((p) => `
                  <tr>
                    <td style="font-family:var(--font-mono); text-align:left;">${escapeHtml(p.name)}</td>
                    <td>${escapeHtml(p.type || "—")}</td>
                    <td>${p.isOutput ? "Output" : "Input"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state" style="padding:14px 10px;">
            <p style="font-size:12px;">No real parameters extracted for this function — either it genuinely
            takes none, or its data only contained internal compiler-generated locals (filtered out here,
            not because nothing was found but because what was found wasn't a real caller-facing parameter).</p>
          </div>
        `}

        <div class="source-footnote">
          Function flags + parameters: raw-export/Content/ROD/${escapeHtml(widget.path)} →
          WidgetBlueprintGeneratedClass.FuncMap["${escapeHtml(fn.name)}"] → FunctionFlags / ChildProperties
        </div>
      </div>

      <div class="hud-panel" style="margin-top:14px;">
        <h3>Widget Hierarchy Summary</h3>
        <p style="font-size:12px; color:var(--hud-text-dim); margin-top:0;">
          Element counts by UMG widget type for ${escapeHtml(widget.name)} (${widget.totalEntries} total export entries,
          ${widget.functionCount} of which are functions). This is a count summary, not a reconstructed visual
          tree — confirmed that Outer-chain references give a real UObject parent but not the same thing as
          the actual rendered widget hierarchy, so this stays at the level that's actually confirmed.
        </p>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${Object.entries(widget.widgetTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => `
            <span class="pill" style="background:rgba(255,255,255,0.06);">${escapeHtml(type)}: ${count}</span>
          `).join("")}
        </div>
      </div>
    `;
  },
};
