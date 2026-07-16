// rodschema-view.js
// Tools > RODSchema -- the JSON-mod-loader workbench. Three pieces:
//   1. Memory Signatures: view/edit rodschema/signatures.json (the
//      toolkit-managed source of truth; tools_sync_signatures.py in the
//      packaged ZIP writes them into RODSignatures.h before a build).
//   2. Patch composer: ONE unified JSON describing edits across many
//      DataTables/DataAssets, validated against the REAL raw export
//      (table found, rows exist, field names match) and split into
//      RODSchema's PalSchema-style per-table raw/ files.
//   3. Package: download the full source + signatures + composed mods
//      as a ZIP with BUILD-INSTRUCTIONS.md.
// HONEST LIMIT (stated in the UI and the zip): the DLL itself must be
// built on Windows (VS2022) -- RE-UE4SS needs MSVC; this Linux server
// cannot cross-compile it. Everything up to that point happens here.

const RodSchemaView = {
  state: { sigs: null, patchText: null, report: null, loaded: false },

  DEFAULT_PATCH: {
    name: "MyFirstMod",
    author: "you",
    version: "1.0.0",
    edits: [
      { target: "DataTable", table: "DT_FixTBoxTable", op: "edit", row: "TB_Plains1_1_01_1",
        fields: { ItemLotTableKeys: ["TB_Plains1_1_01_1", "None", "None", "None", "None"] } },
      { target: "DataTable", table: "DT_ItemLotTable", op: "add", row: "MyNewLot_1",
        fields: {} },
    ],
  },

  async render(container) {
    container.innerHTML = "";
    if (!this.state.loaded) {
      try {
        this.state.sigs = await (await fetch("/api/rodschema/signatures")).json();
      } catch (e) { this.state.sigs = null; }
      if (this.state.patchText == null) this.state.patchText = JSON.stringify(this.DEFAULT_PATCH, null, 2);
      this.state.loaded = true;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>RODSchema</b> — UE4SS JSON mod loader (PalSchema-architecture port)</span>
        <span id="rsServerBuild" style="opacity:0.6;"></span>
        <span style="margin-left:auto; opacity:0.6;" title="RE-UE4SS C++ mods require the MSVC x64 toolchain; this Linux server can't cross-compile the DLL. Everything else — signatures, mod JSON validation against the real export, packaging with build instructions — happens here, and the Windows build is one command (build.ps1, VS2022).">DLL builds on Windows — hover for why</span>
      </div>

      <div class="hud-panel" style="padding:14px; margin-bottom:12px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:6px;">MEMORY SIGNATURES</div>
        <div style="font-size:10.5px; color:var(--hud-text-dim); margin-bottom:8px;">
          The AOB patterns RODSchema scans for at boot. <b>direct</b> = the pattern IS the function start;
          <b>call-resolve</b> = the pattern hits a CALL site and the target is resolved from it. Empty pattern =
          placeholder, skipped by the scanner (the loader logs and no-ops — same behavior as the shipped source).
          Saved to <code>rodschema/signatures.json</code>; the packaged ZIP's <code>tools_sync_signatures.py</code>
          writes them into the header before building.
          <br/><b>Status:</b> UDataTable::Serialize CONFIRMED (covers every raw DataTable edit — the registry
          captures each table as it loads); the two AROHeroCharacter equipment hooks are set;
          FPakPlatformFile::GetPakFolders is a placeholder (optional feature). GameInstance class path is now
          <b>confirmed from the export</b> (BP_RODGameInstance's SuperStruct = <code>/Script/ROD.RODGameInstance</code>);
          the remaining blocker for DataAsset-phase loaders (weapons) is its Init() <b>vtable index</b>, derived on
          Windows with a debugger exactly like PalSchema's index 90.
        </div>
        <div id="rsSigTable"></div>
        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="toggle-btn" id="rsAddSig">+ Add signature</button>
          <button class="toggle-btn" id="rsSaveSigs" style="border-color:var(--db-cyan-bright); color:var(--db-cyan-bright);">Save signatures</button>
          <span id="rsSigStatus" style="font-size:10.5px; color:var(--hud-text-dim); align-self:center;"></span>
        </div>
      </div>

      <div class="hud-panel" style="padding:14px; margin-bottom:12px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:6px;">PATCH COMPOSER — one JSON, many tables</div>
        <div style="font-size:10.5px; color:var(--hud-text-dim); margin-bottom:8px;">
          Describe every edit in ONE JSON (<code>edits[]</code> across any number of DataTables / DataAssets).
          <b>Validate</b> checks each edit against the real raw export on this server — table file found, row
          exists (edit/delete) or is genuinely new (add), field names present on a real row — then shows the
          split into RODSchema's <code>mods/&lt;name&gt;/raw/&lt;Table&gt;.json</code> files (RawTableLoader format:
          <code>{ TableName: { RowName: fields, RowToDelete: null } }</code>).
        </div>
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
          <select id="rsExampleSel" style="font-size:11px; background:rgba(4,12,16,0.9); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:3px; padding:4px;">
            <option value="">Load an example patch…</option>
          </select>
          <span id="rsExampleNote" style="font-size:9.5px; color:var(--hud-text-dim);"></span>
        </div>
        <textarea id="rsPatch" spellcheck="false" style="width:100%; min-height:220px; background:rgba(4,12,16,0.7); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:4px; font-family:var(--font-mono); font-size:11px; padding:8px;"></textarea>
        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="toggle-btn" id="rsValidate">Validate against export</button>
          <button class="toggle-btn" id="rsPackage" style="border-color:var(--db-cyan-bright); color:var(--db-cyan-bright);">⬇ Package RODSchema ZIP (source + signatures + this mod)</button>
        </div>
        <div id="rsReport" style="margin-top:10px;"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderSigTable();
    document.getElementById("rsPatch").value = this.state.patchText;
    document.getElementById("rsPatch").addEventListener("input", (e) => { this.state.patchText = e.target.value; });
    document.getElementById("rsAddSig").addEventListener("click", () => {
      this.state.sigs = this.state.sigs || { signatures: [] };
      this.state.sigs.signatures.push({ target: "UClass::NewFunction", pattern: "", kind: "direct" });
      this.renderSigTable();
    });
    document.getElementById("rsSaveSigs").addEventListener("click", () => this.saveSigs());
    document.getElementById("rsValidate").addEventListener("click", () => this.validatePatch());
    this.loadExamples();
    this.checkServerBuild();
    document.getElementById("rsPackage").addEventListener("click", () => this.packageZip());
  },

  async checkServerBuild() {
    const el = document.getElementById("rsServerBuild");
    try {
      const r = await fetch("/api/server-info");
      if (!(r.headers.get("content-type") || "").includes("application/json")) throw new Error("no /api/server-info");
      const j = await r.json();
      el.textContent = `server build ${j.serverBuild} · up since ${new Date(j.startedAt).toLocaleTimeString()}`;
    } catch (e) {
      el.innerHTML = `<b style="color:var(--hud-acv);">RUNNING SERVER IS OUTDATED</b> — no /api/server-info. If you copied server.js and restarted: a Docker container restart does NOT pick up copied files unless the project folder is bind-mounted — rebuild the image (or check the compose mounts), then confirm the boot log prints the build stamp.`;
    }
  },

  renderSigTable() {
    const el = document.getElementById("rsSigTable");
    if (!el) return;
    const sigs = (this.state.sigs && this.state.sigs.signatures) || [];
    if (!sigs.length && !this.state.sigs) {
      el.innerHTML = `<div style="font-size:11px; color:var(--hud-sp);">signatures.json not found — deploy the <code>rodschema/</code> folder on this instance to manage signatures here.</div>`;
      return;
    }
    el.innerHTML = `
      <table style="width:100%; border-collapse:collapse;">
        <tr style="font-size:9px; color:var(--hud-text-dim); text-align:left;"><th style="width:30%;">TARGET (Class::Function)</th><th style="width:12%;">KIND</th><th>PATTERN (hex + ?? wildcards; empty = placeholder)</th><th></th></tr>
        ${sigs.map((s, i) => `
          <tr>
            <td style="padding:2px 6px 2px 0;"><input data-sig-target="${i}" value="${escapeHtml(s.target)}" style="width:100%; font-family:var(--font-mono); font-size:10.5px; background:rgba(4,12,16,0.7); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:3px; padding:3px 5px;"/></td>
            <td style="padding:2px 6px 2px 0;">
              <select data-sig-kind="${i}" style="font-size:10.5px; background:rgba(4,12,16,0.9); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:3px; padding:3px;">
                <option value="direct"${s.kind !== "call-resolve" ? " selected" : ""}>direct</option>
                <option value="call-resolve"${s.kind === "call-resolve" ? " selected" : ""}>call-resolve</option>
              </select></td>
            <td style="padding:2px 6px 2px 0;"><input data-sig-pattern="${i}" value="${escapeHtml(s.pattern)}" placeholder="(placeholder — scanner skips)" style="width:100%; font-family:var(--font-mono); font-size:10px; background:rgba(4,12,16,0.7); color:${s.pattern ? "var(--hud-text)" : "var(--hud-sp)"}; border:1px solid var(--hud-border); border-radius:3px; padding:3px 5px;"/></td>
            <td><button class="toggle-btn" data-sig-del="${i}" style="font-size:10px;">✕</button></td>
          </tr>`).join("")}
      </table>`;
    el.querySelectorAll("[data-sig-target]").forEach((inp) => inp.addEventListener("input", (e) => { this.state.sigs.signatures[+inp.dataset.sigTarget].target = e.target.value; }));
    el.querySelectorAll("[data-sig-kind]").forEach((sel) => sel.addEventListener("change", (e) => { this.state.sigs.signatures[+sel.dataset.sigKind].kind = e.target.value; }));
    el.querySelectorAll("[data-sig-pattern]").forEach((inp) => inp.addEventListener("input", (e) => { this.state.sigs.signatures[+inp.dataset.sigPattern].pattern = e.target.value; }));
    el.querySelectorAll("[data-sig-del]").forEach((btn) => btn.addEventListener("click", () => { this.state.sigs.signatures.splice(+btn.dataset.sigDel, 1); this.renderSigTable(); }));
  },

  async saveSigs() {
    const status = document.getElementById("rsSigStatus");
    try {
      const r = await fetch("/api/rodschema/signatures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatures: this.state.sigs.signatures }),
      });
      // An HTML response here means Express answered "Cannot POST"
      // (its default 404 page) -- i.e. the RUNNING server predates
      // this endpoint. Say that plainly instead of the cryptic
      // "Unexpected token '<'" a blind r.json() produced.
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        status.textContent = "Server has no /api/rodschema/signatures POST route — the running server.js is older than this page. Copy the updated server.js and RESTART the Node server (the frontend updates on reload, the server only on restart).";
        status.style.color = "var(--hud-acv)";
        return;
      }
      const j = await r.json();
      status.textContent = r.ok ? `Saved ${j.count} signature(s) to rodschema/signatures.json` : `Rejected: ${j.error}`;
      status.style.color = r.ok ? "var(--hud-hp)" : "var(--hud-acv)";
    } catch (e) { status.textContent = `Save failed: ${e.message}`; status.style.color = "var(--hud-acv)"; }
  },

  async loadExamples() {
    const sel = document.getElementById("rsExampleSel");
    const note = document.getElementById("rsExampleNote");
    let data;
    try {
      const r = await fetch("/api/rodschema/patch-examples");
      if (!(r.headers.get("content-type") || "").includes("application/json")) throw new Error("endpoint missing (older server.js running — restart after updating)");
      data = await r.json();
    } catch (e) { note.textContent = `Examples unavailable: ${e.message}`; return; }
    this._examples = data.examples || [];
    for (const [i, ex] of this._examples.entries()) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = ex.label;
      sel.appendChild(o);
    }
    if (data.missing && data.missing.length) note.textContent = `Unavailable until uploaded: ${data.missing.join("; ")}`;
    else note.textContent = "Field shapes are cloned from REAL rows in your current export.";
    sel.addEventListener("change", () => {
      const ex = this._examples[+sel.value];
      if (!ex) return;
      this.state.patchText = JSON.stringify(ex.patch, null, 2);
      document.getElementById("rsPatch").value = this.state.patchText;
      document.getElementById("rsReport").innerHTML = "";
    });
  },

  parsePatch() {
    try { return { patch: JSON.parse(this.state.patchText) }; }
    catch (e) { return { error: `Patch JSON doesn't parse: ${e.message}` }; }
  },

  async validatePatch() {
    const out = document.getElementById("rsReport");
    const { patch, error } = this.parsePatch();
    if (error) { out.innerHTML = `<div style="color:var(--hud-acv); font-size:11px;">${escapeHtml(error)}</div>`; return; }
    out.innerHTML = `<div style="font-size:11px; color:var(--hud-text-dim);">Validating against the raw export…</div>`;
    try {
      const r = await fetch("/api/rodschema/validate-patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (j.error) { out.innerHTML = `<div style="color:var(--hud-acv); font-size:11px;">${escapeHtml(j.error)}</div>`; return; }
      out.innerHTML = `
        <div style="font-size:11.5px; font-weight:600; color:${j.ok ? "var(--hud-hp)" : "var(--hud-acv)"}; margin-bottom:6px;">${j.ok ? "✓ Every edit validates against the real export" : "✗ Some edits have problems"}</div>
        ${j.report.map((r0) => `
          <div style="font-size:10.5px; margin-bottom:4px; color:${r0.ok ? "var(--hud-text-dim)" : "var(--hud-acv)"};">
            <span style="font-family:var(--font-mono);">edit[${r0.index}]</span> ${r0.ok ? "✓" : "✗"} ${escapeHtml(r0.tableFile || r0.target || "")}
            ${(r0.notes || []).map((n) => `<div style="margin-left:14px; opacity:0.9;">— ${escapeHtml(n)}</div>`).join("")}
          </div>`).join("")}
        ${j.files && j.files.length ? `
          <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--hud-text); margin:8px 0 4px;">SPLIT INTO RODSCHEMA FILES</div>
          ${j.files.map((f) => `
            <div style="font-family:var(--font-mono); font-size:10px; color:var(--db-cyan-bright); margin-bottom:2px;">${escapeHtml(f.path)}</div>
            <pre style="font-size:9.5px; max-height:140px; overflow:auto; background:rgba(4,12,16,0.7); border:1px solid var(--hud-border); border-radius:4px; padding:6px; color:var(--hud-text);">${escapeHtml(f.content)}</pre>`).join("")}` : ""}
      `;
    } catch (e) { out.innerHTML = `<div style="color:var(--hud-acv); font-size:11px;">Validation request failed: ${escapeHtml(e.message)}</div>`; }
  },

  async packageZip() {
    const { patch, error } = this.parsePatch();
    if (error) { alert(error); return; }
    const r = await fetch("/api/rodschema/package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patches: [patch] }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Package failed: ${j.error || r.status}`); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "RODSchema-package.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  },
};
