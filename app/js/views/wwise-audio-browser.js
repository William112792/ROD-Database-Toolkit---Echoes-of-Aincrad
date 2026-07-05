// ============================================================
// wwise-audio-browser.js
// Browser for the game's Wwise audio event catalog (4449 AkAudioEvent
// files, confirmed before this was built) -- distinct from DT
// Inspector, since these are single tiny records with no Rows/
// Properties (no DataTable/CurveTable/DataAsset shape at all), and
// dumping 4449 of them into that flat list would be unusable.
//
// Organized around the REAL structure already present in the export,
// not an invented one: the folder hierarchy (30 top-level categories,
// e.g. SFX_Enemy/Wasp/..., Music_W1/..., VO/PEV/...) is preserved as
// the primary navigation, and each event's own name is kept exactly
// as-is rather than algorithmically shortened -- the full name is
// already self-describing for the vast majority of events (e.g.
// "Play_SFX_Enemy_Wasp_Voice_Hiss") and is exactly what someone
// modding audio would search for in the actual game files, so
// "cleaning it up" would work against the user's stated goal of being
// able to find and replace a specific audio file, not for it.
//
// Per event, shows: the .bnk soundbank path, the EventId, and EVERY
// physical .wem media file path, broken out per language where an
// event has more than one (confirmed: VO events specifically carry
// separate physical files per language, e.g. English(US) vs.
// Japanese(JP), which is exactly the kind of thing someone replacing
// a voice line needs to see up front).
// ============================================================

const WwiseAudioView = {
  state: {
    activeCategory: null,
    search: "",
    selectedPath: null,
    events: null, // lazily loaded full list, cached after first fetch
    loadError: null,
  },

  async render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-panel" style="margin-bottom:14px;">
        <p style="font-size:12px; color:var(--hud-text-dim); margin:0; line-height:1.6;">
          Every Wwise audio event in the game's export (${(DataStore.wwiseAudioIndex && DataStore.wwiseAudioIndex.totalCount) || "—"}
          total) — organized by the same category structure the actual Wwise project uses, with
          every physical media (.wem) file path shown per event, broken out by language where an
          event has more than one. Event names are kept exactly as exported, not shortened, since
          the full name is what you'd search for in the actual game files.
        </p>
      </div>
      <div id="wwiseLoadingState"></div>
      <div id="wwiseBrowserBody" style="display:none;">
        <div class="toolbar">
          <input type="text" class="search-input" id="wwiseSearchInput" placeholder="Search by event name or path..." />
        </div>
        <div class="toolbar" id="wwiseCategoryBar" style="margin:10px 0; flex-wrap:wrap;"></div>
        <div class="equip-layout two-col" style="--list-col: 380px;">
          <div id="wwiseListPane" class="list-pane-self-managed"></div>
          <div id="wwiseDetailPane"></div>
        </div>
      </div>
    `;
    container.appendChild(wrap);

    document.getElementById("wwiseLoadingState").innerHTML = `
      <div class="hud-panel"><div class="empty-state" style="padding:30px 10px;"><div class="empty-icon">⏳</div><p>Loading audio event catalog...</p></div></div>
    `;

    try {
      this.state.events = await DataStore.getWwiseEvents();
    } catch (err) {
      this.state.loadError = err;
    }

    document.getElementById("wwiseLoadingState").style.display = "none";
    if (this.state.loadError) {
      document.getElementById("wwiseLoadingState").style.display = "";
      document.getElementById("wwiseLoadingState").innerHTML = `
        <div class="hud-panel"><div class="empty-state"><p>Failed to load: ${escapeHtml(String(this.state.loadError.message || this.state.loadError))}</p></div></div>
      `;
      return;
    }
    document.getElementById("wwiseBrowserBody").style.display = "";

    if (!this.state.activeCategory) {
      const counts = (DataStore.wwiseAudioIndex && DataStore.wwiseAudioIndex.categoryCounts) || {};
      const topCategory = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      this.state.activeCategory = topCategory || null;
    }

    document.getElementById("wwiseSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderCategoryBar();
      this.renderList({ resetScroll: true });
    });

    this.renderCategoryBar();
    this.renderList();
    this.renderDetail();
  },

  renderCategoryBar() {
    const el = document.getElementById("wwiseCategoryBar");
    const counts = (DataStore.wwiseAudioIndex && DataStore.wwiseAudioIndex.categoryCounts) || {};
    const isSearching = this.state.search.trim().length > 0;
    const categories = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    el.innerHTML = categories.map((cat) => {
      const active = !isSearching && cat === this.state.activeCategory;
      return `<button class="toggle-btn${active ? " active" : ""}" data-cat="${escapeHtml(cat)}" ${isSearching ? "disabled" : ""}>${escapeHtml(cat)} <span style="opacity:0.6;">(${counts[cat]})</span></button>`;
    }).join("");

    el.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.activeCategory = btn.dataset.cat;
        this.state.selectedPath = null;
        this.renderCategoryBar();
        this.renderList({ resetScroll: true });
        this.renderDetail();
      });
    });
  },

  getFilteredEvents() {
    const all = this.state.events || [];
    const q = this.state.search.trim().toLowerCase();
    if (q) {
      // Searching spans every category, not just the active one --
      // the category tabs disable themselves while searching (see
      // renderCategoryBar) so this doesn't look like a silent
      // contradiction of "Category: X" while showing other categories.
      return all.filter((e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
    }
    return all.filter((e) => e.category === this.state.activeCategory);
  },

  renderList(options = {}) {
    const { resetScroll = false } = options;
    const pane = document.getElementById("wwiseListPane");

    // Same scroll-preservation pattern as JsonInspectorView/DtInspectorView
    // -- selecting an event re-renders this list to show the new
    // selection highlight; resetScroll=true (passed by the search
    // handler) deliberately skips restoring scroll, since a freshly
    // filtered/re-categorized list should start at the top.
    const previousList = pane.querySelector(".hud-panel");
    const previousScrollTop = (!resetScroll && previousList) ? previousList.scrollTop : 0;

    const events = this.getFilteredEvents();
    const list = document.createElement("div");
    list.className = "hud-panel";
    list.style.maxHeight = "calc(100vh - 320px)";
    list.style.overflowY = "auto";
    list.innerHTML = `<h3>${events.length} event${events.length === 1 ? "" : "s"}</h3>`;

    if (events.length === 0) {
      list.innerHTML += `<div class="empty-state" style="padding:16px;"><p>No events match.</p></div>`;
    }

    events.forEach((ev) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (ev.path === this.state.selectedPath ? " selected" : "");
      row.style.flexDirection = "column";
      row.style.alignItems = "flex-start";
      row.style.gap = "2px";
      row.innerHTML = `
        <span class="wl-name" style="font-size:12px; font-family:var(--font-mono);">${escapeHtml(ev.name)}</span>
        ${ev.isMultiLanguage ? `<span class="pill verified" style="font-size:9px;">${ev.languages.length} languages</span>` : ""}
        <span class="wl-id" style="font-size:9px;">${escapeHtml(ev.path)}</span>
      `;
      row.addEventListener("click", () => {
        this.state.selectedPath = ev.path;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(row);
    });

    pane.innerHTML = "";
    pane.appendChild(list);
    list.scrollTop = previousScrollTop;

    if (!this.state.selectedPath || !events.find((e) => e.path === this.state.selectedPath)) {
      this.state.selectedPath = events[0] ? events[0].path : null;
    }
  },

  renderDetail() {
    const pane = document.getElementById("wwiseDetailPane");
    const ev = (this.state.events || []).find((e) => e.path === this.state.selectedPath);

    if (!ev) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select an audio event.</p></div></div>`;
      return;
    }

    const languageBlocks = ev.languages.map((lang) => `
      <div style="margin-top:10px;">
        <div style="font-size:12px; font-weight:600; color:var(--db-cyan-bright);">${escapeHtml(lang.language || "(unspecified)")}</div>
        ${lang.mediaPaths.length > 0 ? lang.mediaPaths.map((p) => `
          <div style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim); padding:3px 0 3px 10px; border-left:2px solid rgba(255,255,255,0.1);">${escapeHtml(p)}</div>
        `).join("") : `<div style="font-size:11px; color:var(--hud-text-dim); padding-left:10px;">No media file path found for this language.</div>`}
      </div>
    `).join("");

    pane.innerHTML = `
      <div class="hud-panel">
        <h3 style="font-family:var(--font-mono); font-size:15px;">${escapeHtml(ev.name)}</h3>
        <div style="font-family:var(--font-mono); font-size:12px; color:var(--hud-text-dim); line-height:1.8; margin-top:8px;">
          Category: <span style="color:var(--db-cyan-bright);">${escapeHtml(ev.category)}</span><br/>
          Full path: <span style="color:var(--hud-text);">WwiseAudio/Events/${escapeHtml(ev.path)}</span><br/>
          Event ID: ${ev.eventId ?? "—"}<br/>
          Soundbank: ${ev.soundBankPath ? escapeHtml(ev.soundBankPath) : "—"}<br/>
          Media files: ${ev.mediaFileCount}${ev.isMultiLanguage ? ` across ${ev.languages.length} languages` : ""}
        </div>

        <div style="margin-top:14px;">
          <div style="font-size:13px; font-weight:600; margin-bottom:4px;">Media File Paths</div>
          ${languageBlocks || '<p style="font-size:12px; color:var(--hud-text-dim);">No media file paths found for this event.</p>'}
        </div>
      </div>
    `;
  },
};
