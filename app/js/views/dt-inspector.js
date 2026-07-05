// ============================================================
// dt-inspector.js
// Full raw-datatable browser: lists every DataTable / CurveTable /
// CurveFloat / DataAsset found anywhere under raw-export/ (built by
// build_dt_inspector_index() in the Python pipeline), with its
// location, an auto-generated structural summary, and -- for
// row-based tables -- every individual row, browsable the same way
// the JSON Inspector browses individual weapons/armor.
//
// Distinct from JsonInspectorView: that one is a per-ENTRY quick
// reference (one weapon/armor record, cross-linked to its
// localization). This one is a full DATABASE/DATATABLE view -- every
// row of every raw export file, regardless of whether the app has
// any UI built for that data yet. Per the user: "JSON Inspector is
// for quick references per entry where DT Inspector is a full
// database/datatable inspection of all its entries."
// ============================================================

const DtInspectorView = {
  state: {
    selectedPath: null,
    selectedRowKey: null, // for DataTable/CurveTable kinds, which row is open
    search: "",
    loadedFile: null,     // the lazily-fetched raw JSON for selectedPath
    loadError: null,
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-panel" style="margin-bottom:14px;">
        <p style="font-size:12px; color:var(--hud-text-dim); margin:0; line-height:1.6;">
          Every raw DataTable, CurveTable, CurveFloat, and DataAsset found under
          <code>raw-export/</code> -- textures excluded (tracked separately below as
          reference counts, not bundled into the app). Summaries are auto-generated
          from each file's structure; they'll be replaced with reviewed, hand-written
          notes as each table actually gets used by a future section.
        </p>
      </div>
      <div class="toolbar">
        <input type="text" class="search-input" id="dtInspectorSearch"
               placeholder="Find by table name, path, or field name..." />
      </div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="dtInspectorList"></div>
        <div id="dtInspectorDetail"></div>
      </div>
    `;
    container.appendChild(wrap);

    document.getElementById("dtInspectorSearch").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderList({ resetScroll: true });
    });

    this.renderList();
    this.renderDetail();
  },

  getFiltered() {
    const all = DataStore.dtInspectorIndex || [];
    if (!this.state.search.trim()) return all;
    const q = this.state.search.trim().toLowerCase();
    return all.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q) ||
      (e.fields || []).some((f) => String(f).toLowerCase().includes(q))
    );
  },

  renderList(options = {}) {
    const { resetScroll = false } = options;
    const pane = document.getElementById("dtInspectorList");

    // Same scroll-preservation fix as JsonInspectorView.renderList() --
    // see that file's comment for the full root-cause explanation.
    // Selecting a table re-renders this list (to show the new
    // selection highlight); resetScroll=true is only passed by the
    // search handler, where jumping to the top of a freshly-filtered
    // list is the correct behavior.
    const previousList = pane.querySelector(".hud-panel");
    const previousScrollTop = (!resetScroll && previousList) ? previousList.scrollTop : 0;

    const tables = this.getFiltered();
    const list = document.createElement("div");
    list.className = "hud-panel";
    list.style.maxHeight = "calc(100vh - 280px)";
    list.style.overflowY = "auto";
    list.innerHTML = `<h3>Datatables (${tables.length})</h3>`;

    if (tables.length === 0) {
      list.innerHTML += `<div class="empty-state" style="padding:20px 10px;"><p>No tables match.</p></div>`;
    }

    tables.forEach((t) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (t.path === this.state.selectedPath ? " selected" : "");
      row.style.flexDirection = "column";
      row.style.alignItems = "flex-start";
      row.style.gap = "2px";
      row.innerHTML = `
        <div style="display:flex; width:100%; align-items:center; gap:8px;">
          <span class="pill" style="background:rgba(64,207,216,0.15); color:var(--db-cyan-bright); flex-shrink:0;">${escapeHtml(t.kind)}</span>
          <span class="wl-name" style="font-size:13px;">${escapeHtml(t.name)}</span>
        </div>
        <span class="wl-id" style="font-size:10px;">${escapeHtml(t.path)}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedPath = t.path;
        this.state.selectedRowKey = null;
        this.state.loadedFile = null;
        this.state.loadError = null;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);
    list.scrollTop = previousScrollTop;

    if (!this.state.selectedPath && tables.length > 0) {
      this.state.selectedPath = tables[0].path;
    }
  },

  async renderDetail() {
    const pane = document.getElementById("dtInspectorDetail");
    const meta = (DataStore.dtInspectorIndex || []).find((e) => e.path === this.state.selectedPath);

    if (!meta) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a datatable to inspect it.</p></div></div>`;
      return;
    }

    // Show the summary immediately, with a loading state for the body
    // while the (potentially large) raw file is fetched -- some of
    // these are 1MB+, so this shouldn't look frozen while it loads.
    pane.innerHTML = this.renderMetaHeader(meta) + `
      <div class="hud-panel" style="margin-top:14px;">
        <div class="empty-state" style="padding:30px 10px;">
          <div class="empty-icon">⏳</div>
          <p>Loading raw file...</p>
        </div>
      </div>
    `;

    if (!this.state.loadedFile || this.state.loadedFile.__path !== meta.path) {
      try {
        const data = await DataStore.getDtInspectorFile(meta.path);
        // Tag the cached object with which path it came from, so a
        // fast double-click (select table A, then B, before A's fetch
        // resolves) can't show table A's data under table B's header --
        // re-check this.state.selectedPath below before rendering.
        data.__path = meta.path;
        this.state.loadedFile = data;
        this.state.loadError = null;
      } catch (err) {
        this.state.loadError = err;
      }
    }

    // Guard against the selection having changed again while this
    // fetch was in flight.
    if (this.state.selectedPath !== meta.path) return;

    if (this.state.loadError) {
      pane.innerHTML = this.renderMetaHeader(meta) + `
        <div class="hud-panel" style="margin-top:14px;">
          <div class="empty-state"><p>Failed to load: ${escapeHtml(String(this.state.loadError.message || this.state.loadError))}</p></div>
        </div>
      `;
      return;
    }

    const entry = this.state.loadedFile[0];

    // SAME SCROLL-JUMP RISK AS JsonInspectorView.renderList() (fixed
    // earlier this session): clicking a row in #dtRowList calls
    // renderDetail() again, which replaces pane.innerHTML wholesale --
    // including #dtRowList itself, which would reset its own
    // scrollTop to 0 on every single row click in a long table.
    // Capturing and restoring it here proactively, rather than waiting
    // to rediscover the same bug class a second time.
    const previousRowList = pane.querySelector("#dtRowList");
    const previousRowListScrollTop = previousRowList ? previousRowList.scrollTop : 0;

    pane.innerHTML = this.renderMetaHeader(meta) + this.renderBody(meta, entry);

    const newRowList = pane.querySelector("#dtRowList");
    if (newRowList) {
      newRowList.scrollTop = previousRowListScrollTop;
    }

    // Wire up row selection if this table has a browsable row list.
    if (meta.kind === "DataTable" || meta.kind === "CurveTable") {
      const rowListEl = pane.querySelector("#dtRowList");
      if (rowListEl) {
        rowListEl.querySelectorAll("[data-row-key]").forEach((el) => {
          el.addEventListener("click", () => {
            this.state.selectedRowKey = el.dataset.rowKey;
            this.renderDetail();
          });
        });
      }
    }
  },

  renderMetaHeader(meta) {
    const texInfo = meta.textureRefCount > 0
      ? `${meta.texturesPresent}/${meta.textureRefCount} referenced textures already present in Content/ROD/`
      : `No texture references found in this table.`;
    return `
      <div class="hud-panel">
        <h3>${escapeHtml(meta.name)}</h3>
        <div style="font-family:var(--font-mono); font-size:12px; color:var(--hud-text-dim); line-height:1.7;">
          Location: <span style="color:var(--db-cyan-bright);">Content/ROD/${escapeHtml(meta.path)}</span><br/>
          Kind: <b style="color:var(--hud-text);">${escapeHtml(meta.kind)}</b>
          ${meta.rowCount !== null ? ` &mdash; ${meta.rowCount} row${meta.rowCount !== 1 ? "s" : ""}` : " &mdash; singleton (no row list)"}
          <br/>
          ${escapeHtml(texInfo)}
          ${meta.texturesMissing > 0 ? ` <span class="pill unverified">${meta.texturesMissing} missing</span>` : ""}
        </div>
        <p style="font-size:12px; color:var(--hud-text-dim); margin:10px 0 0; font-style:italic;">${escapeHtml(meta.summary)}</p>
      </div>
    `;
  },

  renderBody(meta, entry) {
    if (meta.kind === "DataTable" || meta.kind === "CurveTable") {
      return this.renderRowBrowser(meta, entry);
    }
    if (meta.kind === "CurveFloat" || meta.kind === "RODCurveFloat") {
      return this.renderCurveFloatBody(entry);
    }
    // DataAsset (singleton) or anything unrecognized: show the raw
    // Properties object directly -- there's no meaningful "row" to
    // select, the whole thing IS the one record.
    const body = entry.Properties !== undefined ? entry.Properties : entry;
    return `
      <div class="hud-panel" style="margin-top:14px;">
        <h3>Raw Record</h3>
        <div class="json-inspector">${syntaxHighlightJson(body)}</div>
      </div>
    `;
  },

  renderRowBrowser(meta, entry) {
    const rows = entry.Rows || {};
    const rowKeys = Object.keys(rows);
    if (!this.state.selectedRowKey || !(this.state.selectedRowKey in rows)) {
      this.state.selectedRowKey = rowKeys[0] || null;
    }

    const rowListHtml = rowKeys.map((key) => {
      const row = rows[key];
      // Best-effort label: prefer a recognizable title/name-ish field
      // if this row has one, otherwise just the row key itself (UE
      // DataTable row names are often meaningful on their own, e.g.
      // curve names like "VIT"/"END"/"MND").
      const titleField = row && typeof row === "object"
        ? (row.DatabaseTitleKey || row.Name || row.Title || null)
        : null;
      const label = titleField ? `${key} — ${titleField}` : key;
      const selected = key === this.state.selectedRowKey;
      return `<div class="weapon-list-row${selected ? " selected" : ""}" data-row-key="${escapeHtml(key)}" style="padding:8px 12px;">
        <span class="wl-name" style="font-size:12px;">${escapeHtml(label)}</span>
      </div>`;
    }).join("");

    const selectedRow = this.state.selectedRowKey !== null ? rows[this.state.selectedRowKey] : null;

    return `
      <div class="equip-layout two-col" style="--list-col: 240px; margin-top:14px;">
        <div class="hud-panel" id="dtRowList" style="max-height:calc(100vh - 420px); overflow-y:auto; padding:8px;">
          ${rowListHtml || '<div class="empty-state" style="padding:16px;"><p>No rows.</p></div>'}
        </div>
        <div class="hud-panel">
          <h3>Row: ${escapeHtml(this.state.selectedRowKey ?? "—")}</h3>
          ${selectedRow !== null
            ? `<div class="json-inspector">${syntaxHighlightJson(selectedRow)}</div>`
            : '<div class="empty-state"><p>Select a row.</p></div>'}
        </div>
      </div>
    `;
  },

  renderCurveFloatBody(entry) {
    const keys = ((entry.Properties || {}).FloatCurve || {}).Keys || [];
    const rowsHtml = keys.map((k, i) => `
      <tr>
        <td>${i}</td>
        <td>${escapeHtml(String(k.Time))}</td>
        <td>${escapeHtml(String(k.Value))}</td>
        <td style="opacity:0.6; font-size:11px;">${escapeHtml(k.InterpMode || "")}</td>
      </tr>
    `).join("");
    return `
      <div class="hud-panel" style="margin-top:14px;">
        <h3>Keyframe Points (${keys.length})</h3>
        <table class="acv-table">
          <thead><tr><th>#</th><th>Time</th><th>Value</th><th>Interpolation</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="4">No keyframes.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  },
};
