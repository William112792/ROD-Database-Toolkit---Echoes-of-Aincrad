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
    rebuildingKey: null, // which section key ("__full__", or "__group_<name>__") is currently mid-rebuild, for a simple busy indicator
    sectionProgress: null, // structured per-section progress from .pipeline-progress.json (via /api/pipeline/rebuild-progress) -- survives page reloads
    groups: {}, // focus-build bundles from --status (FOCUS_GROUPS, dependency-expanded server-side)
    statusGeneratedAt: null, // when the cached checks were really computed
    statusCached: true,
    uploadResult: null,
    interrupted: null, // set when a progress file claims "running" but its process is gone
    unknownFiles: [], // files from the last upload that didn't match any section's known rawInputs
    csvExportTables: [], // DataTable catalog for the Export to CSV panel, from _DtInspector/_index.json
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
          Full Content.zip, loose .json files that changed, or a <b>Dumper-7 SDK dump</b>
          (the whole zip — it lands in GameSDK/&lt;version&gt;/, its .usmap is copied to
          raw-export/Mappings/, and the <b>Game SDK</b> focus group indexes its types)
        </div>
        <input type="file" id="buildFileInput" multiple accept=".zip,.json" style="display:none;" />
      </div>
      <div id="buildUploadResult"></div>

      <div class="hud-panel" style="margin-bottom:14px;">
        <h3 style="font-size:13px;">Export to CSV <span style="opacity:0.55; font-weight:400; font-size:10.5px;">(for re-importing into Unreal Engine)</span></h3>
        <p style="font-size:11.5px; color:var(--hud-text-dim); margin-top:0;">
          Converts a raw exported JSON file into a CSV using UE's OWN DataTable convention —
          nested struct fields become <code>(Key=Value,...)</code>, arrays become
          <code>(Item1,Item2,...)</code> — so the result can be re-imported into the editor for
          testing, rebuilding a reference table, or manual editing. Works best for real
          DataTables (one column per field, one row per table row). DataAssets don't have a
          native CSV import convention in UE, so those export as a single best-effort row —
          offered anyway since it doesn't hurt to have it, but labeled as best-effort rather than
          a guaranteed round-trip.
        </p>
        <input type="text" class="search-input" id="csvExportSearch" placeholder="Search DataTables by path (e.g. ItemLotTable)…" style="width:100%; margin-bottom:8px;"/>
        <div id="csvExportList" style="max-height:220px; overflow-y:auto; margin-bottom:10px;"></div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="text" class="search-input" id="csvExportManualPath" placeholder="Or paste any raw-export path (DataTable or DataAsset)…" style="flex:1;"/>
          <button class="toggle-btn" id="csvExportManualBtn">Check &amp; Export</button>
        </div>
        <div id="csvExportManualResult" style="font-size:11px; margin-top:6px;"></div>
      </div>

      <div class="toolbar" style="margin-bottom:10px;">
        <button class="toggle-btn active" id="buildRefreshBtn"
          title="Re-reads the CURRENT state (last saved check report, live build progress, focus groups). It builds nothing and changes nothing — it just refreshes what you're looking at. To re-run the Export/Schema/Outputs checks, use 'Run checks now' below; to regenerate data, use a Rebuild button.">↻ Refresh Status</button>
        <button class="toggle-btn" id="buildRebuildAllBtn">Rebuild Full Pipeline</button>
        <a class="toggle-btn" id="buildDownloadZipBtn" href="/api/pipeline/download-zip" style="margin-left:auto; text-decoration:none;" download>⬇ Download Content.zip</a>
      </div>

      <div id="buildFocusGroups"></div>
      <div id="buildInterruptedBanner"></div>
      <div id="buildProgressPanel"></div>
      <pre id="buildLiveLog" style="display:none; max-height:220px; overflow-y:auto; background:rgba(0,0,0,0.35); border:1px solid var(--hud-border); border-radius:6px; padding:10px 12px; font-size:11px; line-height:1.5; white-space:pre-wrap; margin:10px 0;" title="Live pipeline output — streamed from the running background job (python3 -u), polled every ~1.2s"></pre>

      <div id="buildStatusGrid"></div>
      <div id="buildUnknownFiles"></div>
    `;
    container.appendChild(wrap);

    this.wireUploadZone();
    this.wireCsvExportPanel();
    document.getElementById("buildRefreshBtn").addEventListener("click", () => this.loadStatus());
    document.getElementById("buildRebuildAllBtn").addEventListener("click", () => this.triggerRebuild(null));

    await this.loadStatus();
    // After the grid is up: show the last/current run's per-section
    // states, and if a build is mid-flight (page reloaded during a
    // run, or a terminal-launched run), resume its live indicator.
    this.resumeRunningBuild();
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
      this.state.groups = data.groups || {};
      // Groups from a CACHED status can be stale (a group added after
      // the last check run simply wouldn't be there -- that's how the
      // Game SDK focus button went missing). Always refresh them from
      // the cheap dedicated endpoint, which runs no sections.
      this.refreshFocusGroups();
      this.state.statusGeneratedAt = data.generatedAt || null;
      this.state.statusCached = !!data.cached;
      this.state.statusNeverComputed = !!data.neverComputed;
    } catch (e) {
      this.state.loadError = e.message;
    }
    this.state.loading = false;
    this.renderOverviewPanel();
    this.renderStatusGrid();
    this.renderFocusGroups();
  },

  /**
   * Per-section live build indicator. Driven by the pipeline's OWN
   * .pipeline-progress.json (via /api/pipeline/rebuild-progress) --
   * not by parsing log text -- so it lists exactly the sections the
   * run resolved (auto-included prerequisites too), in run order,
   * each pending -> running -> ok/failed/skipped. Because the file
   * is on disk, this panel shows correctly after a page reload
   * mid-run, and still shows the LAST run's outcome after everything
   * finished (or after a server restart killed the in-memory job).
   */
  /**
   * A build that was killed before it finished (server stopped, container
   * restarted, Ctrl-C) leaves a progress file still claiming "running".
   * The dashboard used to believe it and disable every build button --
   * so the only action that would have cleared the file was the one
   * action you couldn't take. Now the server verifies the build process
   * is actually alive (by pid), and if it isn't, we say so, keep the
   * buttons usable, and offer to clear the record.
   */
  renderInterruptedBanner() {
    const el = document.getElementById("buildInterruptedBanner");
    if (!el) return;
    const i = this.state.interrupted;
    if (!i) { el.innerHTML = ""; return; }
    const stopped = i.stoppedAt ? ` It was part-way through <b>${escapeHtml(i.stoppedAt.label || i.stoppedAt.key)}</b>.` : "";
    el.innerHTML = `
      <div class="mod-callout unresolved" style="margin-bottom:14px;">
        <div class="mod-name">Previous build was interrupted — not still running</div>
        <div class="mod-effect-line">
          A <b>${escapeHtml(i.mode || "build")}</b> started ${escapeHtml(new Date(i.startedAt).toLocaleString())} never finished
          (its process${i.pid ? ` — pid ${i.pid}` : ""} is gone, so it was killed rather than left running).
          It completed <b>${i.completed}/${i.total}</b> sections.${stopped}
          <br/><b>Nothing is stuck:</b> the build buttons work, and any partial output is simply overwritten by the next run.
          Clearing just tidies the record.
        </div>
        <div style="margin-top:8px; display:flex; gap:8px;">
          <button class="toggle-btn" id="buildClearInterruptedBtn">Clear interrupted record</button>
        </div>
      </div>`;
    const btn = document.getElementById("buildClearInterruptedBtn");
    if (btn) btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Clearing…";
      try {
        const r = await fetch("/api/pipeline/clear-progress", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { alert(j.error || "Could not clear."); btn.disabled = false; btn.textContent = "Clear interrupted record"; return; }
        this.state.interrupted = null;
        this.renderInterruptedBanner();
        await this.pollProgressOnce();
      } catch (e) {
        alert(`Clear failed: ${e.message}`);
        btn.disabled = false;
        btn.textContent = "Clear interrupted record";
      }
    });
  },

  async pollProgressOnce() {
    try {
      const prog = await (await fetch("/api/pipeline/rebuild-progress")).json();
      this.renderBuildProgress(prog.sectionProgress || null);
      this.state.interrupted = prog.interrupted ? prog.interruptedInfo : null;
      this.renderInterruptedBanner();
    } catch (e) { /* leave the panel as-is */ }
  },

  renderBuildProgress(prog) {
    if (prog !== undefined) this.state.sectionProgress = prog;
    const el = document.getElementById("buildProgressPanel");
    if (!el) return;
    const p = this.state.sectionProgress;
    if (!p || !p.sections || !p.sections.length) { el.innerHTML = ""; return; }

    const chip = (s) => {
      const style = {
        ok:      "background:rgba(94,235,109,0.12); border:1px solid rgba(94,235,109,0.4); color:var(--hud-hp);",
        running: "background:rgba(64,207,216,0.15); border:1px solid rgba(64,207,216,0.6); color:var(--db-cyan-bright); animation:skeletonPulse 1.4s ease-in-out infinite;",
        failed:  "background:rgba(224,49,79,0.12); border:1px solid rgba(224,49,79,0.5); color:var(--hud-acv);",
        skipped: "border:1px solid var(--hud-border); color:var(--hud-text-dim); opacity:0.55;",
        pending: "border:1px solid var(--hud-border); color:var(--hud-text-dim);",
      }[s.state] || "border:1px solid var(--hud-border); color:var(--hud-text-dim);";
      const mark = { ok: "✓", running: "▶", failed: "✗", skipped: "⤼", pending: "○" }[s.state] || "○";
      const secs = s.startedAt && s.finishedAt
        ? ` · ${Math.max(1, Math.round((new Date(s.finishedAt) - new Date(s.startedAt)) / 1000))}s` : "";
      return `<span data-progress-chip="${escapeHtml(s.key)}" title="${escapeHtml(s.label)}${s.error ? " — " + s.error : ""}${secs}"
        style="display:inline-flex; align-items:center; gap:5px; font-size:10px; font-family:var(--font-mono);
               padding:2px 8px; border-radius:3px; ${style}">${mark} ${escapeHtml(s.key)}</span>`;
    };

    const done = p.sections.filter((s) => s.state === "ok").length;
    const failed = p.sections.filter((s) => s.state === "failed").length;
    const running = p.sections.find((s) => s.state === "running");
    const header = p.running
      ? `Build running — <b>${escapeHtml(p.mode || "?")}</b> · ${done}/${p.sections.length} sections done${running ? ` · now: <b>${escapeHtml(running.label)}</b>` : ""}`
      : p.success === false
        ? `Last build <span style="color:var(--hud-acv);">FAILED</span> — ${escapeHtml(p.mode || "?")} · ${done} ok, ${failed} failed`
        : `Last build finished — ${escapeHtml(p.mode || "?")} · ${done}/${p.sections.length} sections`;

    el.innerHTML = `
      <div class="hud-panel" style="margin:10px 0; padding:10px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:8px;">
          ${header}
          <span style="opacity:0.55; font-weight:400; font-size:10px; margin-left:8px;" title="Per-section states come from the pipeline's own .pipeline-progress.json — they survive page reloads and terminal-launched runs show here too.">${p.startedAt ? "started " + new Date(p.startedAt).toLocaleTimeString() : ""}</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:5px;">${p.sections.map(chip).join("")}</div>
      </div>
    `;
  },

  /**
   * Shared poll loop for a running build: tails the live log AND
   * repaints the per-section progress panel every ~1.2s until the job
   * reports finished. `jobId` may be null when resuming a run this
   * page didn't start (reload mid-run, or a terminal-launched
   * pipeline) -- then completion is judged by the progress file's own
   * running flag instead of the in-memory job id.
   */
  async pollBuild(jobId) {
    const logEl = document.getElementById("buildLiveLog");
    let last = null;
    let done = false;
    while (!done) {
      await new Promise((r) => setTimeout(r, 1200));
      let prog;
      try {
        prog = await (await fetch("/api/pipeline/rebuild-progress")).json();
      } catch (e) {
        continue; // transient poll failure: keep trying, the job is server-side
      }
      last = prog;
      if (logEl && prog.log != null) {
        const tail = prog.log.length > 6000 ? "…" + prog.log.slice(-6000) : prog.log;
        logEl.style.display = "block";
        logEl.textContent = tail;
        logEl.scrollTop = logEl.scrollHeight;
      }
      this.renderBuildProgress(prog.sectionProgress || null);
      if (jobId != null) {
        if (!prog.running && prog.jobId === jobId) done = true;
      } else {
        if (!prog.running) done = true;
      }
    }
    return last;
  },

  /**
   * Reload-resume: if a build is already running when this page loads
   * (started before a reload, from another tab, or from a terminal),
   * pick its indicator back up instead of showing an idle dashboard
   * that quietly disagrees with reality.
   */
  async resumeRunningBuild() {
    let prog;
    try {
      prog = await (await fetch("/api/pipeline/rebuild-progress")).json();
    } catch (e) {
      return;
    }
    this.renderBuildProgress(prog.sectionProgress || null);
    // An interrupted run (server stopped mid-build) is NOT a running
    // build: the buttons stay enabled and we say what happened.
    this.state.interrupted = prog.interrupted ? prog.interruptedInfo : null;
    this.renderInterruptedBanner();
    if (!prog.running) return;

    const mode = prog.mode || (prog.sectionProgress && prog.sectionProgress.mode) || "";
    if (mode.startsWith("group:")) this.state.rebuildingKey = `__group_${mode.slice(6)}__`;
    else if (mode.startsWith("only:")) this.state.rebuildingKey = mode.slice(5);
    else this.state.rebuildingKey = "__full__";
    this.renderStatusGrid();
    this.renderFocusGroups();
    const fullBtn = document.getElementById("buildRebuildAllBtn");
    if (fullBtn) { fullBtn.disabled = true; fullBtn.textContent = "Build in progress…"; }

    await this.pollBuild(prog.jobId != null ? prog.jobId : null);

    this.state.rebuildingKey = null;
    if (fullBtn) { fullBtn.disabled = false; fullBtn.textContent = "Rebuild Full Pipeline"; }
    await this.loadStatus();
  },

  /**
   * Focus builds: named bundles of related sections, rendered from
   * the SAME FOCUS_GROUPS registry the pipeline CLI runs (delivered
   * inside --status as `groups`, dependency-expanded server-side) --
   * the introspect-don't-duplicate principle this whole dashboard was
   * built on. Each button starts a background job that rebuilds ONLY
   * that bundle (plus any auto-included prerequisites, which the
   * status payload lists), leaving every other section's outputs on
   * disk untouched -- previous calculations are retained by
   * construction, since no section ever deletes a sibling's files.
   */
  async refreshFocusGroups() {
    try {
      const r = await fetch("/api/pipeline/focus-groups");
      if (!(r.headers.get("content-type") || "").includes("application/json")) return; // older server: keep cached groups
      const j = await r.json();
      if (j.groups && Object.keys(j.groups).length) {
        this.state.groups = j.groups;
        this.renderFocusGroups();
      }
    } catch (e) { /* keep whatever the status report gave us */ }
  },

  async runServerSideGroup(key, group) {
    const resultEl = document.getElementById("buildUploadResult");
    this.state.rebuildingKey = `__group_${key}__`;
    this.renderFocusGroups();
    try {
      const r = await fetch(group.endpoint, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      const lines = (j.log || []).map((l) => escapeHtml(l)).join("<br>");
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="hud-panel" style="margin-top:0; border-color: rgba(94,235,109,0.3);">
            <h3 style="color:var(--hud-hp);">Tools rebuilt — ${j.restored} script(s) restored</h3>
            <div style="font-family:var(--font-mono); font-size:11px; color:var(--hud-text-dim); margin-top:6px;">${lines}</div>
            ${(j.pythonPackages || []).some((p) => p.status === "using-stdlib-fallback") ? `
              <div class="mod-callout" style="margin-top:8px;">
                <div class="mod-name">numpy/Pillow not installed — the texture tools still work</div>
                <div class="mod-effect-line">
                  This Python has no pip, so they couldn't be fetched. That's fine: the texture tools
                  fall back to <code>tools/pngkit.py</code>, a pure standard-library PNG reader/writer,
                  and produce byte-identical results. They're just slower — about 9s for a 2048×2048
                  texture instead of ~1s.
                </div>
              </div>` : ""}
            <p style="font-size:12px; color:var(--hud-text-dim); margin-top:8px;">
              ${escapeHtml(j.note || "")}
            </p>
          </div>`;
      }
      await this.refreshFocusGroups();
    } catch (e) {
      if (resultEl) {
        resultEl.innerHTML = `<div class="mod-callout unresolved" style="margin-top:0;"><div class="mod-name">Tools rebuild failed</div><div class="mod-effect-line">${escapeHtml(e.message)}</div></div>`;
      }
    } finally {
      this.state.rebuildingKey = null;
      this.renderFocusGroups();
    }
  },

  renderFocusGroups() {
    const el = document.getElementById("buildFocusGroups");
    if (!el) return;
    const groups = this.state.groups || {};
    const names = Object.keys(groups);
    if (!names.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="hud-panel" style="margin:10px 0; padding:10px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--hud-text); margin-bottom:2px;">Focus Builds</div>
        <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:8px;">
          Rebuild just one area of the app — runs only that bundle (auto-including any
          prerequisite sections, shown per button) and leaves everything else exactly as the
          last build left it. The full pipeline run above still exists unchanged.
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${names.map((name) => {
            const g = groups[name];
            const busy = this.state.rebuildingKey === `__group_${name}__`;
            const auto = (g.autoIncluded || []).length
              ? ` — auto-includes: ${g.autoIncluded.join(", ")}`
              : "";
            return `<button class="toggle-btn" data-group-key="${escapeHtml(name)}" ${this.state.rebuildingKey ? "disabled" : ""} style="font-size:11px; padding:5px 12px;" title="${escapeHtml(g.label)}: ${escapeHtml(g.sections.join(", "))}${escapeHtml(auto)}">${busy ? "Building…" : escapeHtml(g.label)}</button>`;
          }).join("")}
        </div>
      </div>
    `;
    el.querySelectorAll("[data-group-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = (this.state.groups || {})[btn.dataset.groupKey] || {};
        // A server-side group (Tools) is NOT a pipeline run -- the pipeline
        // lives in tools/, so it can't be the thing that rebuilds tools/.
        // Node does it, and this posts to its endpoint instead.
        if (g.serverSide && g.endpoint) return this.runServerSideGroup(btn.dataset.groupKey, g);
        this.triggerRebuild(null, btn.dataset.groupKey);
      });
    });
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
   * "Areas" used to map to Towns (10) as the closest literal section
   * to that word before a real Areas section existed -- it now reads
   * the real World > Areas data and Towns gets its own count;
   * "enemies" maps to Monsters.
   */
  computePhase4() {
    try {
      const counts = {
        items: DataStore.getAllItemsFlat().length,
        recipes: DataStore.getAllRecipesFlat().length,
        weapons: DataStore.getAllWeaponsFlat().length,
        armor: DataStore.getAllArmorFlat().length,
        areas: DataStore.getAllAreasFlat().length,
        towns: DataStore.getAllTownsFlat().length,
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
    if (this.state.statusNeverComputed && !this.state.overview) {
      el.innerHTML = `
        <div class="hud-panel" style="margin-bottom:14px; padding:12px 14px;">
          <div style="font-size:12px; color:var(--hud-text-dim);">
            No section checks have been computed on this instance yet — the dashboard no longer
            runs them on page load (they really run every section, which takes minutes).
            <button class="toggle-btn" id="buildRefreshChecksBtn" style="font-size:11px; padding:3px 10px; margin-left:8px;"
              title="Actually RE-RUNS every section as a diagnostic (minutes) and saves a fresh report. It does not write app data — that's what Rebuild does.">Run checks now</button>
          </div>
        </div>
      `;
      const btn = document.getElementById("buildRefreshChecksBtn");
      if (btn) btn.addEventListener("click", () => this.refreshChecks());
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
      ${this.renderMissingExportsHtml()}
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; font-size:11px; color:var(--hud-text-dim);">
        <span title="The Export/Schema/Outputs checks below really run every section, which now takes minutes — so the dashboard loads the LAST computed report instantly and only re-runs the checks on request (as a background job).">
          ${this.state.statusCached
            ? `Checks from ${this.state.statusGeneratedAt ? new Date(this.state.statusGeneratedAt).toLocaleString() : "a previous run"} (cached)`
            : `Checks freshly computed${this.state.statusGeneratedAt ? " " + new Date(this.state.statusGeneratedAt).toLocaleString() : ""}`}
        </span>
        <button class="toggle-btn" id="buildRefreshChecksBtn" ${this.state.rebuildingKey ? "disabled" : ""} style="font-size:11px; padding:3px 10px;">Re-run checks</button>
      </div>
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
              ${stat(p4.counts.towns, "Towns")}
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

    const refreshBtn = document.getElementById("buildRefreshChecksBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => this.refreshChecks());
  },

  /**
   * Re-runs the REAL status checks (--status: every section actually
   * executes) as a background job through the same single-job
   * machinery rebuilds use, then reloads the freshly cached report.
   * This is the explicit, on-demand replacement for what page load
   * used to do synchronously -- and used to 500/504 on once the
   * pipeline grew past the HTTP timeout.
   */
  async refreshChecks() {
    const btn = document.getElementById("buildRefreshChecksBtn");
    const startedAt = Date.now();
    const logEl = document.getElementById("buildLiveLog");
    const tick = () => {
      if (btn) {
        btn.disabled = true;
        btn.textContent = `Re-running checks… (${Math.round((Date.now() - startedAt) / 1000)}s)`;
      }
    };
    tick();
    const tickInterval = setInterval(tick, 1000);
    try {
      const res = await fetch("/api/pipeline/refresh-status", { method: "POST" });
      const started = await res.json();
      if (res.status === 409) {
        alert(`A build is already running (${started.mode || "unknown mode"}). Wait for it to finish.`);
        clearInterval(tickInterval);
        if (btn) { btn.disabled = false; btn.textContent = "Re-run checks"; }
        return;
      }
      if (logEl) { logEl.style.display = "block"; logEl.textContent = "Re-running all section checks…"; }
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 1500));
        let prog;
        try {
          prog = await (await fetch("/api/pipeline/rebuild-progress")).json();
        } catch (e) { continue; }
        if (!prog.running && prog.jobId === started.jobId) {
          done = true;
          if (logEl) logEl.style.display = "none"; // the status job's "log" is one giant JSON blob -- not useful to display
          if (prog.exitCode !== 0) {
            alert(`Status check failed (exit code ${prog.exitCode}):\n\n${(prog.log || "").slice(-1200)}`);
          }
        }
      }
    } catch (e) {
      alert(`Status refresh failed: ${e.message}`);
    }
    clearInterval(tickInterval);
    await this.loadStatus();
  },

  // What each still-blocked export unlocks, and how to get it out of
  // FModel -- actionable, rather than a generic "upload more files" nag.
  EXPORT_GUIDE: {
    bp_inspector: {
      export: "Widget/AvatarCustomize/AvatarCustomize/WBP_*.json",
      how: "FModel → Content/ROD/Widget/AvatarCustomize/ → right-click the folder → Save Properties (.json).",
      unlocks: "BP Inspector: the avatar-customisation widget graphs (what the character creator actually exposes).",
    },
    asset_skeletons: {
      export: "CHR/**/SK_*.json",
      how: "FModel → Content/ROD/CHR/ → Save Properties (.json) on the SK_* skeletal meshes. These are the mesh JSONs — the .psk/.fbx/.glb you already uploaded are the geometry; this section needs the metadata JSONs.",
      unlocks: "Asset Inspector (Skeletons) — and Asset Inspector Index, which is blocked only by this.",
    },
    wwise_audio: {
      export: "WwiseAudio/Events/**/*.json",
      how: "FModel → Content/ROD/WwiseAudio/ → Save Properties (.json) on the Events tree.",
      unlocks: "Wwise Audio Index: which sound event each ability, UI action and monster uses.",
    },
  },

  renderMissingExportsHtml() {
    const sections = (this.state.status && this.state.status.sections) || [];
    const blocked = sections.filter((s) => !s.exportOk || (s.blockedBy || []).length > 0);
    if (!blocked.length) {
      return `
        <div class="mod-callout" style="margin-bottom:14px;">
          <div class="mod-name">Every section has its inputs ✓</div>
          <div class="mod-effect-line">Nothing is waiting on an upload.</div>
        </div>`;
    }
    return `
      <div class="hud-panel" style="padding:14px; margin-bottom:14px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:6px;">
          STILL WAITING ON EXPORTS — ${blocked.length} section${blocked.length === 1 ? "" : "s"}
        </div>
        ${blocked.map((s) => {
          const g = this.EXPORT_GUIDE[s.key];
          const dep = (s.blockedBy || [])[0];
          return `
            <div style="margin-bottom:10px;">
              <div style="font-size:12px; font-weight:600; color:var(--hud-text);">${escapeHtml(s.label)}</div>
              ${g ? `
                <div style="font-size:11px; color:var(--hud-text-dim); line-height:1.6;">
                  <div><b style="color:var(--rank-a);">Export:</b> <code>${escapeHtml(g.export)}</code></div>
                  <div><b>How:</b> ${escapeHtml(g.how)}</div>
                  <div><b>Unlocks:</b> ${escapeHtml(g.unlocks)}</div>
                </div>`
              : dep ? `
                <div style="font-size:11px; color:var(--hud-text-dim); line-height:1.6;">
                  Nothing missing of its own — waiting on <b>${escapeHtml(dep.label)}</b>
                  (<code>${escapeHtml(dep.missing.join(", "))}</code>). Runs automatically once that does.
                </div>`
              : `<div style="font-size:11px; color:var(--hud-text-dim);">Missing: ${s.rawInputs.filter((r) => !r.present).map((r) => escapeHtml(r.path)).join(", ")}</div>`}
            </div>`;
        }).join("")}
        <div style="font-size:10px; color:var(--hud-text-dim); opacity:0.8;">
          Everything else builds. These are honest gaps, not failures.
        </div>
      </div>`;
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
          ${(s.blockedBy || []).length > 0 ? `
            <div style="font-size:11px; color:var(--rank-a); padding-left:2px;">
              Blocked by ${s.blockedBy.map((b) => `<b>${escapeHtml(b.label)}</b> (needs ${escapeHtml(b.missing.join(", "))})`).join("; ")}
              — its own inputs are fine; it runs as soon as that one can.
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

  async triggerRebuild(onlyKey, groupKey) {
    this.state.rebuildingKey = groupKey ? `__group_${groupKey}__` : (onlyKey || "__full__");
    this.renderStatusGrid();
    this.renderFocusGroups();

    // Rebuilds are now BACKGROUND JOBS: the server returns immediately
    // and this poller tails /api/pipeline/rebuild-progress until the
    // job exits. The original synchronous request-per-rebuild produced
    // a real 504 once full runs grew past the HTTP timeout (44
    // sections + the Maps/DNG level scans) -- polling has no such
    // ceiling, and gets a genuinely live log as a bonus (the server
    // runs python3 -u so section prints stream as they happen).
    const fullBtn = document.getElementById("buildRebuildAllBtn");
    const sectionBtn = onlyKey ? document.querySelector(`[data-rebuild-key="${onlyKey}"]`) : null;
    const groupBtn = groupKey ? document.querySelector(`[data-group-key="${groupKey}"]`) : null;
    const startedAt = Date.now();
    const originalFullLabel = fullBtn ? fullBtn.textContent : "";
    const logEl = document.getElementById("buildLiveLog");
    if (logEl) {
      logEl.style.display = "block";
      logEl.textContent = "Starting…";
    }

    const tick = () => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (fullBtn) {
        fullBtn.disabled = true; // one job at a time -- the server enforces this too (409)
        if (!onlyKey && !groupKey) fullBtn.textContent = `Rebuilding Full Pipeline… (${elapsed}s)`;
      }
      if (sectionBtn) sectionBtn.textContent = `Rebuilding… (${elapsed}s)`;
      if (groupBtn) groupBtn.textContent = `Building… (${elapsed}s)`;
    };
    tick();
    const tickInterval = setInterval(tick, 1000);

    const finish = () => {
      clearInterval(tickInterval);
      if (fullBtn) {
        fullBtn.disabled = false;
        fullBtn.textContent = originalFullLabel || "Rebuild Full Pipeline";
      }
      this.state.rebuildingKey = null;
    };

    try {
      const body = groupKey ? { groupKey } : (onlyKey ? { onlyKey } : {});
      const res = await fetch("/api/pipeline/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const started = await res.json();
      if (res.status === 409) {
        alert(`A build is already running (${started.mode || "unknown mode"}, started ${started.startedAt}). Wait for it to finish.`);
        finish();
        return;
      }
      if (!started.started) {
        alert(`Rebuild failed to start: ${started.error || "unknown error"}`);
        finish();
        return;
      }

      // Poll until done, tailing the live log + per-section progress
      // panel via the shared poller (same one reload-resume uses).
      const prog = await this.pollBuild(started.jobId);
      if (prog && prog.exitCode !== 0 && prog.exitCode != null) {
        const tail = (prog.log || "").slice(-1500);
        alert(`Rebuild failed (exit code ${prog.exitCode}):\n\n${tail}`);
      }
    } catch (e) {
      alert(`Rebuild request failed: ${e.message}`);
    }

    finish();
    await this.loadStatus();
  },

  /**
   * Lists every REAL DataTable this export contains (reusing the DT
   * Inspector's own catalog -- Content/ROD/DataAssets/_DtInspector/
   * _index.json, kind === "DataTable" -- never a guessed/fabricated
   * list of table names), searchable by path, each with a direct
   * Export CSV download link. A manual path field covers anything
   * not in that catalog (including DataAssets, best-effort).
   */
  async wireCsvExportPanel() {
    try {
      const idx = await (await fetch(`${CONTENT_ROOT}/DataAssets/_DtInspector/_index.json`)).json();
      this.state.csvExportTables = idx.filter((e) => e.kind === "DataTable").sort((a, b) => a.path.localeCompare(b.path));
    } catch (e) {
      this.state.csvExportTables = [];
    }
    this.renderCsvExportList("");

    document.getElementById("csvExportSearch").addEventListener("input", (e) => {
      this.renderCsvExportList(e.target.value);
    });
    document.getElementById("csvExportManualBtn").addEventListener("click", () => this.checkAndExportManualCsv());
    document.getElementById("csvExportManualPath").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.checkAndExportManualCsv();
    });
  },

  renderCsvExportList(query) {
    const el = document.getElementById("csvExportList");
    const tables = this.state.csvExportTables || [];
    const q = query.trim().toLowerCase();
    const filtered = q ? tables.filter((t) => t.path.toLowerCase().includes(q)) : tables;
    if (!filtered.length) {
      el.innerHTML = `<div style="font-size:11px; color:var(--hud-text-dim); padding:8px;">${tables.length ? "No DataTables match." : "DT Inspector catalog not built yet — run the Inspectors focus build first."}</div>`;
      return;
    }
    const shown = filtered.slice(0, 150);
    el.innerHTML = shown.map((t) => `
      <div style="display:flex; align-items:center; gap:8px; padding:4px 6px; font-size:11.5px; border-bottom:1px solid rgba(135,200,210,0.08);">
        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--font-mono); color:var(--hud-text);" title="${escapeHtml(t.path)}">${escapeHtml(t.path)}</span>
        <span style="color:var(--hud-text-dim); flex-shrink:0;">${t.rowCount != null ? t.rowCount + " rows" : ""}</span>
        <a class="toggle-btn" style="flex-shrink:0; padding:2px 8px; font-size:10.5px; text-decoration:none;" href="/api/pipeline/export-csv?path=${encodeURIComponent(t.path)}" download>⬇ CSV</a>
      </div>
    `).join("");
    if (filtered.length > shown.length) {
      el.insertAdjacentHTML("beforeend", `<div style="font-size:10.5px; color:var(--hud-text-dim); padding:6px;">Showing ${shown.length} of ${filtered.length} — narrow your search for more.</div>`);
    }
  },

  async checkAndExportManualCsv() {
    const input = document.getElementById("csvExportManualPath");
    const resultEl = document.getElementById("csvExportManualResult");
    const rawPath = input.value.trim().replace(/^\/+/, "");
    if (!rawPath) return;
    resultEl.innerHTML = `<span style="color:var(--hud-text-dim);">Checking…</span>`;
    try {
      const res = await fetch(`/api/pipeline/export-csv-info?path=${encodeURIComponent(rawPath)}`);
      const data = await res.json();
      if (!res.ok) {
        resultEl.innerHTML = `<span style="color:var(--rank-a);">${escapeHtml(data.error || "Not found")}</span>`;
        return;
      }
      if (data.kind === "unrecognized") {
        resultEl.innerHTML = `<span style="color:var(--rank-a);">This file's shape isn't a DataTable or a recognizable DataAsset — can't export.</span>`;
        return;
      }
      const kindLabel = data.kind === "datatable" ? `DataTable, ${data.rowCount} rows` : `DataAsset — best-effort single row, not a native UE import format`;
      resultEl.innerHTML = `
        <span style="color:var(--hud-hp);">${escapeHtml(kindLabel)}</span> —
        <a class="toggle-btn" style="padding:2px 8px; font-size:10.5px; text-decoration:none;" href="/api/pipeline/export-csv?path=${encodeURIComponent(rawPath)}" download>⬇ Download CSV</a>
      `;
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--rank-a);">${escapeHtml(e.message)}</span>`;
    }
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
      // A runtime chest dump is a .json, but it does NOT belong in
      // Content/ROD/ like every other loose json -- it's a capture from
      // the live game, not an FModel export. Route it by name to the
      // endpoint that merges it.
      // GimmickLocations.json (v2) supersedes ChestLocations.json (v1),
      // but both are still accepted -- someone mid-sweep with the old
      // script shouldn't have their capture rejected.
      const gimmickDump = files.find((f) => /^GimmickLocations.*\.json$/i.test(f.name));
      if (gimmickDump) {
        const resultEl = document.getElementById("buildUploadResult");
        try {
          const text = await gimmickDump.text();
          const r = await fetch("/api/runtime-dump/gimmicks", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: text,
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`);
          const kinds = Object.entries(j.byKind || {}).sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${escapeHtml(k)}: ${n}`).join(" · ");
          resultEl.innerHTML = `
            <div class="hud-panel" style="margin-top:0; border-color: rgba(94,235,109,0.3);">
              <h3 style="color:var(--hud-hp);">Gimmicks merged — ${j.newGimmicks} new, ${j.totalKnown} known</h3>
              <div style="font-size:11.5px; color:var(--hud-text); margin:4px 0;">${kinds}</div>
              <p style="font-size:12px; color:var(--hud-text-dim);">
                Merged (not replaced) into <code>raw-export/RuntimeDumps/GimmickLocations.json</code>.
                Rebuild <b>World</b> to put the pins on the map.
              </p>
            </div>`;
        } catch (e) {
          resultEl.innerHTML = `<div class="mod-callout unresolved" style="margin-top:0;"><div class="mod-name">Gimmick dump rejected</div><div class="mod-effect-line">${escapeHtml(e.message)}</div></div>`;
        }
        return;
      }

      const chestDump = files.find((f) => /^ChestLocations.*\.json$/i.test(f.name));
      if (chestDump) {
        const resultEl = document.getElementById("buildUploadResult");
        try {
          const text = await chestDump.text();
          const r = await fetch("/api/runtime-dump/chests", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: text,
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`);
          resultEl.innerHTML = `
            <div class="hud-panel" style="margin-top:0; border-color: rgba(94,235,109,0.3);">
              <h3 style="color:var(--hud-hp);">Chest coordinates merged — ${j.newChests} new, ${j.totalKnown} known</h3>
              <p style="font-size:12px; color:var(--hud-text-dim);">
                Merged (not replaced) into <code>raw-export/RuntimeDumps/ChestLocations.json</code> — chests only exist
                while their level is streamed in, so dumps are partial by nature and accumulate across sweeps.
                Rebuild <b>Items</b> or <b>World</b> to put the pins on the map.
              </p>
            </div>`;
        } catch (e) {
          resultEl.innerHTML = `<div class="mod-callout unresolved" style="margin-top:0;"><div class="mod-name">Chest dump rejected</div><div class="mod-effect-line">${escapeHtml(e.message)}</div></div>`;
        }
        return;
      }

      if (zipFile) {
        // A Dumper-7 dump and a Content export are both .zip -- routing
        // by NAME would be fragile, so the server validates shape either
        // way. The name check here only picks which endpoint to try
        // first; a wrong guess produces the server's explicit
        // "doesn't look like X" error rather than a bad extraction.
        const looksLikeSdk = /dumper|cppsdk|EchoesofAincrad|\+\+\+/i.test(zipFile.name);
        await this.uploadZip(zipFile, looksLikeSdk ? "/api/pipeline/upload-sdk-zip" : "/api/pipeline/upload-zip");
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

  uploadZip(file, endpoint) {
    // XMLHttpRequest, not fetch() -- fetch has no built-in way to
    // observe upload progress; XHR's upload.onprogress does. This
    // matters concretely here: a 300+MB Content.zip can take well
    // over 15 seconds just to transfer over the network, and a
    // static "Uploading…" label with zero indication of progress
    // during that whole window looked identical to a genuine hang.
    return new Promise((resolve, reject) => {
      const resultEl = document.getElementById("buildUploadResult");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint || "/api/pipeline/upload-zip");
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

        // The SDK endpoint answers with a DIFFERENT shape (version /
        // sdkFiles / mappingsCopied) than the content-zip endpoint
        // (fileCount / files). Rendering one template for both produced
        // the "Extracted undefined files" message -- report each for
        // what it actually is.
        if (data.version && data.sdkFiles != null) {
          resultEl.innerHTML = `
            <div class="hud-panel" style="margin-top:0; border-color: rgba(94,235,109,0.3);">
              <h3 style="color:var(--hud-hp);">Game SDK dump received — ${escapeHtml(data.version)}</h3>
              <p style="font-size:12px; color:var(--hud-text-dim);">
                ${data.sdkFiles} SDK file${data.sdkFiles === 1 ? "" : "s"} extracted to
                <code>raw-export/GameSDK/${escapeHtml(data.version)}/</code>.
                ${(data.mappingsCopied || []).length
                  ? `Mappings copied to <code>raw-export/Mappings/</code>: ${data.mappingsCopied.map(escapeHtml).join(", ")}.`
                  : "No mapping files found in this dump."}
              </p>
              ${(data.versionedMappings || []).length ? `
                <p style="font-size:12px; color:var(--hud-hp);">
                  Game version <b>${escapeHtml(data.gameVersion)}</b> — mapping files also filed under
                  <code>mapping-files/</code>, so Data Coverage's <b>Direct</b> buttons now serve
                  ${data.versionedMappings.length} file${data.versionedMappings.length === 1 ? "" : "s"} from this dump
                  instead of an older version.
                </p>` : ""}
              ${data.versionedSkippedReason ? `
                <p style="font-size:12px; color:var(--hud-acv);">${escapeHtml(data.versionedSkippedReason)}</p>` : ""}
              <p style="font-size:12px; color:var(--hud-text);">
                Now run the <b>Game SDK</b> focus group above to index its types
                (enums, structs, DataTable row structs, DataAsset classes).
              </p>
            </div>
          `;
          resolve();
          return;
        }

        // The server already truncates `files` to the first 200
        // entries (a full upload can have thousands) -- these are
        // ABSOLUTE paths, so strip everything up through "Content/ROD/"
        // to get the relative path every section's rawInputs is
        // actually expressed in, then check each one for real instead
        // of flagging the entire list unconditionally. That
        // unconditional flagging was a real, separate bug from the
        // stale-pre-merge-path one above: even a perfectly recognized
        // file (or a Localization file whose path had JUST been
        // corrected to the right location) was still shown as
        // "unrecognized," because nothing was actually checking
        // whether it matched a known section at all.
        const relativePaths = (data.files || [])
          .map((f) => {
            const normalized = f.replace(/\\/g, "/");
            const idx = normalized.indexOf("Content/ROD/");
            return idx === -1 ? null : normalized.slice(idx + "Content/ROD/".length);
          })
          .filter(Boolean);
        const unrecognized = relativePaths.filter((p) => !this.isRecognizedRawPath(p));
        this.flagUnknownFiles(unrecognized);
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
  /**
   * Checks a path already relative to raw-export/Content/ROD/ (e.g.
   * "Localization/Game/de/Game.json") directly against every known
   * section's rawInputs -- literal paths or glob patterns, same
   * over-broad-glob guard as guessRelativePath() below (a bare/near-
   * bare wildcard like "*.json" is never trusted as a match on its
   * own). This is the ZIP-upload counterpart to guessRelativePath():
   * that one guesses a full path from a bare FILENAME (all a loose-
   * file upload has to go on); this one already HAS the full path
   * (every file extracted from a ZIP knows exactly where it landed)
   * and just needs to check it directly, not guess at it.
   */
  isRecognizedRawPath(relativePath) {
    if (!this.state.sections) return false;
    for (const section of this.state.sections) {
      for (const input of section.rawInputs) {
        if (input.path === relativePath) return true;
        if (input.path.includes("*")) {
          const fixedPrefix = input.path.split("*")[0];
          if (fixedPrefix.length < 3) continue;
          const escaped = input.path
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");
          const regex = new RegExp("^" + escaped + "$");
          if (regex.test(relativePath)) return true;
        }
      }
    }
    return false;
  },

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
