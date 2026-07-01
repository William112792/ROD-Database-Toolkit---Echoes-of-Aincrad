// ============================================================
// build-dashboard.js
// A web-based control surface over the EXISTING tools/build_pipeline.py
// -- this view does not reimplement any pipeline logic. It calls the
// server endpoints in server.js, which in turn run the real Python
// pipeline (--status / --only=X / --from=X) and relay its output.
//
// Layout, top to bottom:
//   1. Drag-and-drop zone -- accepts a full Content.zip-style archive
//      OR a handful of loose .json files, per the user's explicit
//      request to support both ("if only 1-4 DT files changed we can
//      specifically upload those files... without the need to ZIP them").
//   2. Status grid, in the SAME order as PIPELINE_SECTIONS in the
//      Python pipeline (confirmed: the server's /api/pipeline/status
//      endpoint returns sections in that exact order, not re-sorted
//      here) -- one row per section, each with an Export check
//      (do the raw files this section reads from exist) and a Schema
//      check (would building this section right now actually succeed).
//   3. Unknown-files tray -- populated from the upload response when a
//      ZIP/file doesn't match any section's expected rawInputs, so new
//      content can be investigated and a new section scoped later, the
//      same workflow this project has followed for every prior new
//      section (Recipes, Towns, Quests all started this way).
// ============================================================

const BuildDashboardView = {
  state: {
    sections: null,
    overview: null,
    loading: true,
    loadError: null,
    rebuildingKey: null, // which section key (or "__full__") is currently mid-rebuild, for a simple busy indicator
    uploadResult: null,
    unknownFiles: [], // files from the last upload that didn't match any section's known rawInputs
  },

  async render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-panel" style="margin-bottom:14px;">
        <p style="font-size:12px; color:var(--hud-text-dim); margin:0; line-height:1.6; opacity:0.85;">
          A web view into <code>tools/build_pipeline.py</code> — check status, upload raw files, download, rebuild. No terminal needed.
        </p>
      </div>

      <div id="buildOverviewPanel"></div>

      <div class="hud-panel" id="buildUploadZone" style="margin-bottom:14px; border:2px dashed var(--hud-border); text-align:center; padding:28px 16px; cursor:pointer;">
        <div style="font-size:28px; margin-bottom:8px; opacity:0.8;">⬆</div>
        <div style="font-size:14px; font-weight:600; margin-bottom:4px;">Drop a ZIP or .json files</div>
        <div style="font-size:11px; color:var(--hud-text-dim); opacity:0.8;">
          Full Content.zip, or just the loose files that changed
        </div>
        <input type="file" id="buildFileInput" multiple accept=".zip,.json" style="display:none;" />
      </div>
      <div id="buildUploadResult"></div>

      <div class="toolbar" style="margin-bottom:10px;">
        <button class="toggle-btn active" id="buildRefreshBtn">↻ Refresh Status</button>
        <button class="toggle-btn" id="buildRebuildAllBtn">Rebuild Full Pipeline</button>
        <a class="toggle-btn" id="buildDownloadZipBtn" href="/api/pipeline/download-zip" style="margin-left:auto; text-decoration:none;" download>⬇ Download Content.zip</a>
      </div>

      <div id="buildStatusGrid"></div>
      <div id="buildUnknownFiles"></div>
    `;
    container.appendChild(wrap);

    this.wireUploadZone();
    document.getElementById("buildRefreshBtn").addEventListener("click", () => this.loadStatus());
    document.getElementById("buildRebuildAllBtn").addEventListener("click", () => this.triggerRebuild(null));

    await this.loadStatus();
  },

  async loadStatus() {
    this.state.loading = true;
    this.state.loadError = null;
    this.renderOverviewPanel();
    this.renderStatusGrid();

    try {
      const res = await fetch("/api/pipeline/status");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      this.state.sections = data.sections;
      this.state.overview = data.overview;
    } catch (e) {
      this.state.loadError = e.message;
    }
    this.state.loading = false;
    this.renderOverviewPanel();
    this.renderStatusGrid();
  },

  /**
   * Phase 4 ("proper application running" + live per-category counts)
   * is deliberately computed CLIENT-SIDE from DataStore, not from a
   * server-side recount of raw JSON -- this view only runs inside the
   * full app, after DataStore.loadAll() has already succeeded (the
   * same data every other section of the toolkit already displays),
   * so reading it directly here both answers "is the app actually
   * running" honestly (if these calls throw or return empty, it
   * isn't) and guarantees the numbers shown here can never silently
   * drift from what the rest of the app shows for the same categories.
   * "Areas" maps to Towns (10) -- the closest literal section to that
   * word in this toolkit; "enemies" maps to Monsters.
   */
  computePhase4() {
    try {
      const counts = {
        items: DataStore.getAllItemsFlat().length,
        recipes: DataStore.getAllRecipesFlat().length,
        weapons: DataStore.getAllWeaponsFlat().length,
        armor: DataStore.getAllArmorFlat().length,
        areas: DataStore.getAllTownsFlat().length,
        partners: DataStore.getPartnersFlat().length,
        enemies: DataStore.getAllMonstersFlat().length,
      };
      const allPopulated = Object.values(counts).every((n) => Number.isFinite(n) && n > 0);
      return { appRunning: allPopulated, counts, error: null };
    } catch (e) {
      // If DataStore itself failed to load, the rest of the app
      // wouldn't be usable either -- this view being open at all
      // already implies it didn't, but the try/catch is here so a
      // genuine failure shows up as "not running" rather than a
      // crashed dashboard.
      return { appRunning: false, counts: null, error: e.message };
    }
  },

  renderOverviewPanel() {
    const el = document.getElementById("buildOverviewPanel");
    if (!el) return;

    if (this.state.loading && !this.state.overview) {
      el.innerHTML = `
        <div class="hud-panel" style="margin-bottom:14px;">
          <div class="empty-state" style="padding:20px 10px;"><p>Loading overview…</p></div>
        </div>
      `;
      return;
    }
    if (this.state.loadError || !this.state.overview) {
      el.innerHTML = "";
      return;
    }

    const ov = this.state.overview;
    const p1 = ov.phase1_rawExport;
    const p2 = ov.phase2_schema;
    const p3 = ov.phase3_dataPoints;
    const p4 = this.computePhase4();

    const pill = (ok) => ok
      ? `<span class="pill verified">✓</span>`
      : `<span class="pill unverified">✗</span>`;
    // Numbers carry the weight here -- 28px, tightly tracked, label
    // reduced to one or two words with any nuance moved into a title
    // tooltip rather than always-visible prose.
    const stat = (value, label, warn, title) => `
      <div style="text-align:center; padding:4px 6px;" ${title ? `title="${escapeHtml(title)}"` : ""}>
        <div style="font-family:var(--font-mono); font-size:28px; font-weight:700; letter-spacing:-0.02em; color:${warn ? "var(--rank-a)" : "var(--hud-hp)"};">${value}</div>
        <div style="font-size:10px; color:var(--hud-text-dim); opacity:0.75; margin-top:1px; text-transform:uppercase; letter-spacing:0.03em;">${label}</div>
      </div>
    `;
    const relTime = (iso) => {
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.round(diffMs / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.round(hrs / 24)}d ago`;
    };

    el.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-bottom:14px;">

        <div class="hud-panel" style="margin-bottom:0;">
          <h3 style="display:flex; align-items:center; gap:7px; font-size:12px;">
            <span style="opacity:0.55;">Phase 1</span> Raw Export ${pill(p1.folderStructureOk && p1.identifiedJsonMissing === 0)}
          </h3>
          <div style="display:flex;">
            ${stat(p1.identifiedJsonExisting, "Present", false, "Raw JSON files the pipeline expects, found on disk")}
            ${stat(p1.identifiedJsonMissing, "Missing", p1.identifiedJsonMissing > 0, "Expected but not found — pipeline can't build these sections yet")}
          </div>
          ${p1.unclaimedJsonFilesOnDisk > 0 ? `
            <div style="font-size:11px; margin-top:6px; padding-top:6px; border-top:1px solid var(--hud-border); opacity:0.7;">
              <a href="#" id="toggleUnclaimedFilesLink" title="Files sitting in raw-export/ that no section reads yet — possible future content" style="color:var(--db-cyan-bright); text-decoration:none;">
                ${p1.unclaimedJsonFilesOnDisk} unclaimed file${p1.unclaimedJsonFilesOnDisk === 1 ? "" : "s"} · Show ▾
              </a>
              <div id="unclaimedFilesList" style="display:none; max-height:160px; overflow-y:auto; margin-top:6px; font-family:var(--font-mono); opacity:0.85;">
                ${p1.unclaimedJsonFileSample.map((f) => `<div>${escapeHtml(f)}</div>`).join("")}
                ${p1.unclaimedJsonFilesOnDisk > p1.unclaimedJsonFileSample.length ? `<div style="opacity:0.6; margin-top:4px;">+${p1.unclaimedJsonFilesOnDisk - p1.unclaimedJsonFileSample.length} more</div>` : ""}
              </div>
            </div>
          ` : ""}
        </div>

        <div class="hud-panel" style="margin-bottom:0;">
          <h3 style="display:flex; align-items:center; gap:7px; font-size:12px;">
            <span style="opacity:0.55;">Phase 2</span> Schema ${pill(p2.schemaInvalidCount === 0)}
          </h3>
          <div style="display:flex;">
            ${stat(p2.schemaValidCount, "Valid", false, "Would build successfully right now")}
            ${stat(p2.schemaInvalidCount, "Invalid", p2.schemaInvalidCount > 0, "Would fail to build right now")}
          </div>
          <div style="font-size:11px; margin-top:6px; padding-top:6px; border-top:1px solid var(--hud-border); opacity:0.75;">
            ${p2.lastBuild
              ? `${pill(p2.lastBuild.success)} ${escapeHtml(p2.lastBuild.mode)} · ${relTime(p2.lastBuild.timestamp)}
                 ${!p2.lastBuild.success ? `<div style="color:var(--rank-a); font-family:var(--font-mono); margin-top:3px; opacity:1;">${escapeHtml(p2.lastBuild.failedSection || "")} — ${escapeHtml(p2.lastBuild.error || "")}</div>` : ""}`
              : `No real build tracked yet — Rebuild below will start.`}
          </div>
        </div>

        <div class="hud-panel" style="margin-bottom:0;">
          <h3 style="display:flex; align-items:center; gap:7px; font-size:12px;">
            <span style="opacity:0.55;">Phase 3</span> Generated ${pill(p3.outputsMissing === 0)}
          </h3>
          <div style="display:flex;">
            ${stat(p3.outputsGenerated, "Generated", false, "Expected output files that exist right now")}
            ${stat(p3.outputsMissing, "Missing", p3.outputsMissing > 0, "Would exist if every raw input were present and valid")}
          </div>
        </div>

        <div class="hud-panel" style="margin-bottom:0;">
          <h3 style="display:flex; align-items:center; gap:7px; font-size:12px;">
            <span style="opacity:0.55;">Phase 4</span> Live App ${pill(p4.appRunning)}
          </h3>
          ${p4.counts ? `
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:2px;" title="Read live from this page's own loaded data — the same numbers the rest of the app shows">
              ${stat(p4.counts.weapons, "Weapons")}
              ${stat(p4.counts.armor, "Armor")}
              ${stat(p4.counts.items, "Items")}
              ${stat(p4.counts.recipes, "Recipes")}
              ${stat(p4.counts.areas, "Areas")}
              ${stat(p4.counts.partners, "Partners")}
              ${stat(p4.counts.enemies, "Enemies")}
            </div>
          ` : `<div style="font-size:12px; color:var(--rank-a);">${escapeHtml(p4.error || "")}</div>`}
        </div>

      </div>
    `;

    const toggleLink = document.getElementById("toggleUnclaimedFilesLink");
    if (toggleLink) {
      toggleLink.addEventListener("click", (e) => {
        e.preventDefault();
        const listEl = document.getElementById("unclaimedFilesList");
        const showing = listEl.style.display !== "none";
        listEl.style.display = showing ? "none" : "block";
        toggleLink.innerHTML = toggleLink.innerHTML.replace(showing ? "▴" : "▾", showing ? "▾" : "▴");
      });
    }
  },

  renderStatusGrid() {
    const el = document.getElementById("buildStatusGrid");
    if (!el) return;

    if (this.state.loading && !this.state.sections) {
      el.innerHTML = `
        <div class="hud-panel"><div class="empty-state" style="padding:30px 10px;">
          <div class="empty-icon">⏳</div><p>Checking pipeline status — this runs every section once, takes a few seconds...</p>
        </div></div>
      `;
      return;
    }
    if (this.state.loadError) {
      el.innerHTML = `
        <div class="hud-panel"><div class="empty-state">
          <p>Couldn't reach the build server: ${escapeHtml(this.state.loadError)}</p>
        </div></div>
      `;
      return;
    }

    const rows = (this.state.sections || []).map((s) => {
      const exportBadge = s.exportOk
        ? `<span class="pill verified">✓ Export</span>`
        : `<span class="pill unverified">✗ Export</span>`;
      const schemaBadge = s.schemaOk === null
        ? `<span class="pill" style="opacity:0.5;">— Schema</span>`
        : s.schemaOk
          ? `<span class="pill verified">✓ Schema</span>`
          : `<span class="pill unverified">✗ Schema</span>`;
      const isRebuilding = this.state.rebuildingKey === s.key;
      const missingInputs = s.rawInputs.filter((r) => !r.present);

      return `
        <div class="weapon-list-row" style="flex-direction:column; align-items:stretch; gap:6px; cursor:default;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="flex:1; font-weight:600; font-size:13px;">${escapeHtml(s.label)}</span>
            ${exportBadge}
            ${schemaBadge}
            <button class="toggle-btn" data-rebuild-key="${escapeHtml(s.key)}" ${isRebuilding ? "disabled" : ""} style="font-size:11px; padding:4px 10px;">
              ${isRebuilding ? "Rebuilding…" : "Rebuild"}
            </button>
          </div>
          ${missingInputs.length > 0 ? `
            <div style="font-size:11px; color:var(--rank-a); padding-left:2px;">
              Missing: ${missingInputs.map((m) => escapeHtml(m.path)).join(", ")}
            </div>
          ` : ""}
          ${s.rawInputs.filter((r) => r.present && !r.path.includes("*")).length > 0 ? `
            <div style="font-size:11px; color:var(--hud-text-dim); padding-left:2px; display:flex; flex-wrap:wrap; gap:8px;">
              ${s.rawInputs.filter((r) => r.present && !r.path.includes("*")).map((r) => `
                <a href="/api/pipeline/download-file?path=${encodeURIComponent(r.path)}" download
                   style="color:var(--db-cyan-bright); text-decoration:none; font-family:var(--font-mono);"
                   title="Download this raw export file individually">
                  ⬇ ${escapeHtml(r.path.split("/").pop())}
                </a>
              `).join("")}
            </div>
          ` : ""}
          ${s.schemaError ? `
            <div style="font-size:11px; color:var(--rank-a); padding-left:2px; font-family:var(--font-mono);">
              ${escapeHtml(s.schemaError)}
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    el.innerHTML = `<div class="hud-panel">${rows || "<p>No sections found.</p>"}</div>`;

    el.querySelectorAll("[data-rebuild-key]").forEach((btn) => {
      btn.addEventListener("click", () => this.triggerRebuild(btn.dataset.rebuildKey));
    });
  },

  async triggerRebuild(onlyKey) {
    this.state.rebuildingKey = onlyKey || "__full__";
    this.renderStatusGrid();

    // renderStatusGrid() only reflects rebuildingKey on PER-SECTION
    // buttons (each checks rebuildingKey === s.key) -- the standalone
    // "Rebuild Full Pipeline" button was never touched by any render
    // call at all, so clicking it previously gave zero visual
    // feedback anywhere on the page, even though the request was
    // genuinely running. Fixed here directly, plus a live elapsed-
    // time counter on both buttons -- a full rebuild can legitimately
    // take several seconds to over a minute depending on how much
    // changed, and a static "Rebuilding…" label with no indication
    // of elapsed time looks identical whether it's working normally
    // or actually stuck.
    const fullBtn = document.getElementById("buildRebuildAllBtn");
    const sectionBtn = onlyKey ? document.querySelector(`[data-rebuild-key="${onlyKey}"]`) : null;
    const startedAt = Date.now();
    const originalFullLabel = fullBtn ? fullBtn.textContent : "";

    const tick = () => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (fullBtn) {
        if (!onlyKey) {
          fullBtn.disabled = true;
          fullBtn.textContent = `Rebuilding Full Pipeline… (${elapsed}s)`;
        } else {
          fullBtn.disabled = true; // avoid a second rebuild racing this one, whichever section it targets
        }
      }
      if (sectionBtn) sectionBtn.textContent = `Rebuilding… (${elapsed}s)`;
    };
    tick();
    const tickInterval = setInterval(tick, 1000);

    try {
      const res = await fetch("/api/pipeline/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(onlyKey ? { onlyKey } : {}),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(`Rebuild failed (exit code ${data.exitCode}):\n\n${data.stderr || data.stdout}`);
      }
    } catch (e) {
      alert(`Rebuild request failed: ${e.message}`);
    }

    clearInterval(tickInterval);
    if (fullBtn) {
      fullBtn.disabled = false;
      fullBtn.textContent = originalFullLabel || "Rebuild Full Pipeline";
    }

    this.state.rebuildingKey = null;
    await this.loadStatus();
  },

  wireUploadZone() {
    const zone = document.getElementById("buildUploadZone");
    const input = document.getElementById("buildFileInput");

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.style.borderColor = "var(--db-cyan-bright)";
    });
    zone.addEventListener("dragleave", () => {
      zone.style.borderColor = "var(--hud-border)";
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.style.borderColor = "var(--hud-border)";
      this.handleFiles(Array.from(e.dataTransfer.files));
    });
    input.addEventListener("change", () => {
      this.handleFiles(Array.from(input.files));
      input.value = ""; // allow re-selecting the same file again later
    });
  },

  async handleFiles(files) {
    if (files.length === 0) return;

    const zipFile = files.find((f) => f.name.toLowerCase().endsWith(".zip"));
    const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith(".json"));

    const resultEl = document.getElementById("buildUploadResult");
    resultEl.innerHTML = `<div class="hud-panel"><div class="empty-state" style="padding:14px;"><p>Uploading…</p></div></div>`;

    try {
      if (zipFile) {
        await this.uploadZip(zipFile);
      } else if (jsonFiles.length > 0) {
        await this.uploadLooseFiles(jsonFiles);
      } else {
        resultEl.innerHTML = `<div class="mod-callout unresolved" style="margin-top:0;"><div class="mod-name">Unsupported file type</div><div class="mod-effect-line">Only .zip or .json files are accepted here.</div></div>`;
        return;
      }
    } catch (e) {
      resultEl.innerHTML = `<div class="mod-callout unresolved" style="margin-top:0;"><div class="mod-name">Upload failed</div><div class="mod-effect-line">${escapeHtml(e.message)}</div></div>`;
      return;
    }

    await this.loadStatus();
  },

  uploadZip(file) {
    // XMLHttpRequest, not fetch() -- fetch has no built-in way to
    // observe upload progress; XHR's upload.onprogress does. This
    // matters concretely here: a 300+MB Content.zip can take well
    // over 15 seconds just to transfer over the network, and a
    // static "Uploading…" label with zero indication of progress
    // during that whole window looked identical to a genuine hang.
    return new Promise((resolve, reject) => {
      const resultEl = document.getElementById("buildUploadResult");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/pipeline/upload-zip");
      xhr.setRequestHeader("Content-Type", "application/zip");

      xhr.upload.addEventListener("progress", (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        const mbLoaded = (e.loaded / (1024 * 1024)).toFixed(1);
        const mbTotal = (e.total / (1024 * 1024)).toFixed(1);
        resultEl.innerHTML = `
          <div class="hud-panel" style="margin-top:0;">
            <div class="empty-state" style="padding:14px;">
              <p>Uploading… ${pct}% (${mbLoaded} / ${mbTotal} MB)</p>
              <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; margin-top:8px; overflow:hidden;">
                <div style="width:${pct}%; height:100%; background:var(--db-cyan-bright); transition:width 0.2s;"></div>
              </div>
            </div>
          </div>
        `;
      });

      xhr.upload.addEventListener("load", () => {
        // Upload transfer itself is done, but the server still needs
        // to validate + extract + merge before responding -- that
        // part has no percentage to show (no way to observe server-
        // side progress over a single HTTP response), so it gets its
        // own distinct, honest label rather than a progress bar
        // stuck at a misleading 100%.
        resultEl.innerHTML = `
          <div class="hud-panel" style="margin-top:0;">
            <div class="empty-state" style="padding:14px;"><p>Upload complete — extracting on the server…</p></div>
          </div>
        `;
      });

      xhr.addEventListener("load", () => {
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {
          reject(new Error("Server returned non-JSON response"));
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300 || data.error) {
          resultEl.innerHTML = `
            <div class="mod-callout unresolved" style="margin-top:0;">
              <div class="mod-name">ZIP rejected</div>
              <div class="mod-effect-line">${escapeHtml(data.error || "Unknown error")}</div>
            </div>
          `;
          resolve(); // handled here, not a rejection -- handleFiles() shouldn't also show an "Upload failed" message on top of this one
          return;
        }

        this.flagUnknownFiles(data.files || []);
        const movedNote = (data.movedFolders && data.movedFolders.length > 0)
          ? `<p style="font-size:11px; color:var(--hud-text-dim); margin-top:4px;">Repositioned ${data.movedFolders.join(", ")} under Content/ROD/ to match the pipeline's expected structure.</p>`
          : "";
        resultEl.innerHTML = `
          <div class="hud-panel" style="margin-top:0; border-color: rgba(94,235,109,0.3);">
            <h3 style="color:var(--hud-hp);">Extracted ${data.fileCount} file${data.fileCount === 1 ? "" : "s"}</h3>
            <p style="font-size:12px; color:var(--hud-text-dim);">Files were copied into raw-export/. Use Rebuild above to apply them.</p>
            ${movedNote}
          </div>
        `;
        resolve();
      });

      xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
      xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

      file.arrayBuffer().then((buf) => xhr.send(buf));
    });
  },

  async uploadLooseFiles(fileObjs) {
    const files = await Promise.all(fileObjs.map(async (f) => {
      const content = await f.text();
      // The user drops a loose file with just its own filename (e.g.
      // "DT_TownList.json") -- we don't know its full intended
      // raw-export subfolder from the filename alone, so we match it
      // against every known section's rawInputs by basename and use
      // the first match's folder. A file matching no known section's
      // expected basename is reported as unknown rather than guessed
      // at, consistent with not fabricating data anywhere else in
      // this project.
      const relativePath = this.guessRelativePath(f.name);
      return { relativePath, content, originalName: f.name };
    }));

    const matched = files.filter((f) => f.relativePath);
    const unmatched = files.filter((f) => !f.relativePath);

    const resultEl = document.getElementById("buildUploadResult");

    if (matched.length === 0) {
      this.flagUnknownFiles(unmatched.map((f) => f.originalName));
      resultEl.innerHTML = `
        <div class="mod-callout unresolved" style="margin-top:0;">
          <div class="mod-name">No matching section found</div>
          <div class="mod-effect-line">None of the uploaded file names match any known raw-export path. See the Unknown Files list below.</div>
        </div>
      `;
      return;
    }

    const res = await fetch("/api/pipeline/upload-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: matched.map((f) => ({ relativePath: f.relativePath, content: f.content })) }),
    });
    const data = await res.json();

    this.flagUnknownFiles(unmatched.map((f) => f.originalName));

    const succeeded = (data.results || []).filter((r) => r.ok);
    const failed = (data.results || []).filter((r) => !r.ok);

    resultEl.innerHTML = `
      <div class="hud-panel" style="margin-top:0; ${failed.length === 0 ? 'border-color: rgba(94,235,109,0.3);' : ''}">
        <h3>${succeeded.length} file${succeeded.length === 1 ? "" : "s"} uploaded${failed.length > 0 ? `, ${failed.length} failed` : ""}</h3>
        ${succeeded.map((r) => `<div style="font-size:12px; color:var(--hud-hp); font-family:var(--font-mono);">✓ ${escapeHtml(r.relativePath)}</div>`).join("")}
        ${failed.map((r) => `<div style="font-size:12px; color:var(--rank-a); font-family:var(--font-mono);">✗ ${escapeHtml(r.relativePath)} — ${escapeHtml(r.error)}</div>`).join("")}
        <p style="font-size:12px; color:var(--hud-text-dim); margin-top:8px;">Files were copied into raw-export/. Use Rebuild above to apply them.</p>
      </div>
    `;
  },

  /**
   * Matches a loose uploaded file's basename against every known
   * section's rawInputs (from the last status load) to find where it
   * belongs under raw-export/Content/ROD/. Returns null if no section
   * references a file with this exact basename -- callers treat that
   * as "unknown," not as a guess.
   *
   * BUG FIXED before this shipped: the original regex conversion only
   * replaced "*" with ".*" WITHOUT first escaping the literal "."
   * already in most patterns (e.g. "*.json"), so the "." was
   * interpreted as regex "any character" too -- "*.json" became the
   * regex /^.*.json$/, which matches ANY filename ending in "json"
   * preceded by anything, including completely unrelated uploads.
   * Caught by testing a deliberately-unmatched filename and finding it
   * incorrectly matched the Wwise Audio section's broad "*.json"
   * pattern. Fixed by escaping every regex-special character in the
   * basename FIRST, then substituting the escaped "\*" back to ".*".
   * Bare single-wildcard patterns like "*.json" (match anything) are
   * ALSO excluded from matching entirely below, on top of the escaping
   * fix -- even correctly escaped, a pattern that's just "*.json" is
   * too generic to safely guess a destination from a filename alone;
   * only patterns with a real fixed prefix (e.g. "Town_*.json") are
   * trusted to disambiguate.
   */
  guessRelativePath(filename) {
    if (!this.state.sections) return null;
    for (const section of this.state.sections) {
      for (const input of section.rawInputs) {
        const inputBasename = input.path.split("/").pop();
        if (inputBasename === filename) {
          return input.path;
        }
        // Bare/near-bare wildcard patterns (e.g. "*.json") are
        // EXCLUDED from matching even though they're not literally
        // empty after stripping "*" -- ".json" alone (5 chars) would
        // pass a bare "length > 0" check while still matching nearly
        // any uploaded file, which is exactly the over-broad match
        // this function needs to avoid. Requiring a real, specific
        // fixed prefix (e.g. "Town_" in "Town_*.json" has 5 chars
        // BEFORE the wildcard, not just somewhere in the pattern) is
        // what actually distinguishes a safe, specific glob from an
        // unsafe, generic one.
        const fixedPrefix = inputBasename.split("*")[0];
        if (inputBasename.includes("*") && fixedPrefix.length >= 3) {
          const escaped = inputBasename
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");
          const regex = new RegExp("^" + escaped + "$");
          if (regex.test(filename)) {
            const dir = input.path.substring(0, input.path.lastIndexOf("/"));
            return `${dir}/${filename}`;
          }
        }
      }
    }
    return null;
  },

  flagUnknownFiles(filenames) {
    if (filenames.length === 0) return;
    this.state.unknownFiles = [...this.state.unknownFiles, ...filenames];
    this.renderUnknownFiles();
  },

  renderUnknownFiles() {
    const el = document.getElementById("buildUnknownFiles");
    if (!el || this.state.unknownFiles.length === 0) {
      if (el) el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="hud-panel" style="margin-top:14px; border-color: rgba(224,163,59,0.3);">
        <h3 style="color:var(--rank-a);">Unrecognized Files (${this.state.unknownFiles.length})</h3>
        <p style="font-size:12px; color:var(--hud-text-dim); margin-top:0;">
          These don't match any known raw-export path for any existing section. They were NOT
          copied anywhere — investigate them to decide if they're a new content area worth
          building (the same way Recipes, Towns, and Quests all started: a file showed up that
          didn't fit an existing section, got inspected by hand, and became its own builder).
        </p>
        <ul style="margin:0; padding-left:18px; font-size:12px; font-family:var(--font-mono); color:var(--hud-text-dim);">
          ${this.state.unknownFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
        </ul>
        <button class="toggle-btn" id="clearUnknownFilesBtn" style="margin-top:10px; font-size:11px;">Clear list</button>
      </div>
    `;
    document.getElementById("clearUnknownFilesBtn").addEventListener("click", () => {
      this.state.unknownFiles = [];
      this.renderUnknownFiles();
    });
  },
};
