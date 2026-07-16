// materials-browser.js
// Tools > Materials -- the material hierarchy index built by the
// `materials` pipeline section: every Material (master) and
// MaterialInstanceConstant in the export, grouped by ROOT master, with
// parent chains, children, per-asset overrides, and chain-merged
// effective parameters (each value attributed to the asset that set
// it). Built for the CelShader-recreation workflow: names lie in this
// game (several M_* assets are instances -- e.g. M_CHR_Cel_Upper),
// so type always comes from the JSON, and the true master is one
// click up the chain.
//
// Honest-limit banner is permanent, not dismissable: cooked exports
// contain NO master node graph, and MSM_CelSf is a custom engine
// shading model stock UE 5.3.2 doesn't have. Recreating the hierarchy
// + parameter scaffolding is scripted (tools/
// generate_ue_material_script.py); the cel math itself is hand work.

const MaterialsBrowserView = {
  state: {
    loaded: false,
    entries: [],          // Materials.json
    byPath: {},
    index: null,
    rootFilter: "",       // search text
    celOnly: false,
    selectedPath: null,
  },

  async render(container) {
    container.innerHTML = "";
    if (!this.state.loaded) {
      container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Loading materials index…</p></div></div>`;
      try {
        this.state.index = await (await fetch(`Content/ROD/DataAssets/Database/Materials/_index.json`)).json();
        this.state.entries = await (await fetch(`Content/ROD/DataAssets/Database/Materials/Materials.json`)).json();
        this.state.byPath = {};
        for (const e of this.state.entries) this.state.byPath[e.jsonPath] = e;
        this.state.loaded = true;
      } catch (e) {
        container.innerHTML = `<div class="hud-panel"><div class="empty-state">
          <p>Materials index not built yet.</p>
          <p style="font-size:11px; opacity:0.75;">Run the <b>Materials Index</b> section from the Build Dashboard (or <code>python3 build_pipeline.py --only=materials</code>) after uploading material JSONs (BaseMaterials/, Effects/, …).</p>
        </div></div>`;
        return;
      }
      container.innerHTML = "";
    }

    const idx = this.state.index || {};
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${idx.count || 0}</b> material assets</span>
        <span><b>${idx.masters || 0}</b> masters · <b>${idx.instances || 0}</b> instances</span>
        <span><b>${idx.celShaderFamily || 0}</b> in cel-shader families</span>
        ${idx.brokenChains ? `<span style="color:var(--hud-sp);"><b>${idx.brokenChains}</b> broken parent chains (parent JSON not uploaded)</span>` : ""}
        <span style="margin-left:auto; opacity:0.6;" title="Cooked exports contain NO master node graph (verified: zero MaterialExpression objects, empty CachedExpressionData) — the internal cel-shading math is compiled shader code and cannot be read back. MSM_CelSf is a custom engine shading model; stock UE 5.3.2 doesn't have it. tools/generate_ue_material_script.py recreates the full hierarchy + parameter scaffolding; the math is hand work.">node graphs not in export — hover</span>
      </div>
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <input id="matSearch" class="hud-input" type="text" placeholder="Search name / parameter / root…" value="${escapeHtml(this.state.rootFilter)}" style="flex:1; max-width:340px;"/>
        <button id="matCelBtn" class="toggle-btn${this.state.celOnly ? " active" : ""}">Cel-shader families only</button>
      </div>
      <div class="equip-layout two-col" style="--list-col: 330px;">
        <div id="matListPane" style="max-height:calc(100vh - 240px); overflow-y:auto;"></div>
        <div id="matDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    document.getElementById("matSearch").addEventListener("input", (e) => {
      this.state.rootFilter = e.target.value;
      this.renderList();
    });
    document.getElementById("matCelBtn").addEventListener("click", () => {
      this.state.celOnly = !this.state.celOnly;
      document.getElementById("matCelBtn").classList.toggle("active", this.state.celOnly);
      this.renderList();
    });
    this.renderList();
    this.renderDetail();
  },

  filtered() {
    const q = this.state.rootFilter.trim().toLowerCase();
    return this.state.entries.filter((e) => {
      if (this.state.celOnly && !(e.customShadingModel || /cel/i.test(e.rootName || ""))) return false;
      if (!q) return true;
      if ((e.name || "").toLowerCase().includes(q)) return true;
      if ((e.rootName || "").toLowerCase().includes(q)) return true;
      return (e.effectiveParams || []).some((p) => String(p.name || "").toLowerCase().includes(q));
    });
  },

  renderList() {
    const pane = document.getElementById("matListPane");
    const items = this.filtered();
    // Group by root master; masters listed first inside each group.
    const groups = new Map();
    for (const e of items) {
      if (!groups.has(e.rootJson)) groups.set(e.rootJson, []);
      groups.get(e.rootJson).push(e);
    }
    if (!this.state.selectedPath && items.length) this.state.selectedPath = items[0].jsonPath;
    let html = "";
    for (const [rootJson, members] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const rootName = (this.state.byPath[rootJson] || {}).name || rootJson.split("/").pop().replace(".json", "");
      html += `<div style="font-family:var(--font-display); font-size:10px; font-weight:600; letter-spacing:0.08em; color:var(--db-cyan-bright); margin:10px 4px 3px;" title="${escapeHtml(rootJson)}">${escapeHtml(rootName)} <span style="opacity:0.55; font-weight:400;">(${members.length})</span></div>`;
      for (const e of members) {
        const depth = (e.parentChain || []).length;
        html += `
          <div class="weapon-list-row${e.jsonPath === this.state.selectedPath ? " selected" : ""}" data-mat="${escapeHtml(e.jsonPath)}">
            <div style="flex:1; min-width:0; padding-left:${Math.min(depth, 4) * 12}px;">
              <div class="wl-name">${e.type === "Material" ? "◆ " : "◇ "}${escapeHtml(e.name)}</div>
              <div class="wl-id">${e.type === "Material" ? "master" : "instance"}${e.customShadingModel ? " · MSM_CelSf" : ""}${e.chainBroken ? " · ⚠ chain broken" : ""}${(e.children || []).length ? ` · ${e.children.length} child${e.children.length === 1 ? "" : "ren"}` : ""}</div>
            </div>
          </div>`;
      }
    }
    pane.innerHTML = html || `<div class="empty-state"><p>No materials match.</p></div>`;
    pane.querySelectorAll("[data-mat]").forEach((row) => {
      row.addEventListener("click", () => {
        this.state.selectedPath = row.dataset.mat;
        this.renderList();
        this.renderDetail();
      });
    });
  },

  /**
   * Texture modal: the image, plus what its channels ACTUALLY carry.
   *
   * The channel readout matters more than the picture here. "_S" looks like
   * a specular map from its name and like a normal map from its colour, and
   * measurement says it is neither: R and G are a tangent-space normal's X
   * and Y, and blue is an authored mask. Showing the analysis next to the
   * image is what stops the next person guessing from appearance.
   */
  async openTextureModal(gamePath) {
    let modal = document.getElementById("texModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "texModal";
      modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.82); z-index:1000; "
        + "display:flex; align-items:center; justify-content:center; padding:24px;";
      modal.addEventListener("click", (ev) => { if (ev.target === modal) modal.remove(); });
      document.body.appendChild(modal);
      document.addEventListener("keydown", function esc(ev) {
        if (ev.key === "Escape") { const m = document.getElementById("texModal"); if (m) m.remove(); document.removeEventListener("keydown", esc); }
      });
    }

    const shortName = gamePath.split("/").pop().replace(/\.\d+$/, "");
    modal.innerHTML = `
      <div class="hud-panel" style="max-width:1100px; width:100%; max-height:92vh; overflow:auto; position:relative;">
        <button id="texModalClose" class="toggle-btn" style="position:absolute; top:10px; right:10px; font-size:11px;">✕ Close</button>
        <h3 style="font-family:var(--font-display); color:var(--db-cyan-bright); margin:0 0 2px;">${escapeHtml(shortName)}</h3>
        <div style="font-family:var(--font-mono); font-size:10px; color:var(--hud-text-dim); margin-bottom:12px; word-break:break-all;">${escapeHtml(gamePath)}</div>
        <div id="texModalBody" style="font-size:12px; color:var(--hud-text-dim);">Loading…</div>
      </div>`;
    modal.querySelector("#texModalClose").addEventListener("click", () => modal.remove());
    const body = modal.querySelector("#texModalBody");

    let info;
    try {
      info = await (await fetch(`/api/texture/resolve?path=${encodeURIComponent(gamePath)}`)).json();
    } catch (e) {
      body.innerHTML = `<div class="mod-callout unresolved"><div class="mod-name">Could not look up this texture</div><div class="mod-effect-line">${escapeHtml(e.message)}</div></div>`;
      return;
    }

    if (!info.found) {
      // Honest, not broken: the game has ~18,400 textures / 17.6GB and only
      // the exported subset is on disk.
      body.innerHTML = `
        <div class="mod-callout unresolved">
          <div class="mod-name">This texture isn't in the export yet</div>
          <div class="mod-effect-line">
            The material references it, but the PNG hasn't been exported into <code>Content/</code>.
            Export it from FModel to the same path and it'll appear here — no rebuild needed.
          </div>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div style="display:flex; gap:16px; flex-wrap:wrap;">
        <div style="flex:1 1 380px; min-width:280px;">
          <div style="background:
              linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%),
              linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.04) 75%);
              background-size:16px 16px; background-position:0 0, 8px 8px; border:1px solid rgba(64,207,216,0.25); padding:6px;">
            <img src="${escapeHtml(info.url)}" alt="${escapeHtml(shortName)}"
                 style="width:100%; height:auto; display:block; image-rendering:auto;" />
          </div>
          <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
            <a class="toggle-btn" style="font-size:10px; padding:2px 10px; text-decoration:none;"
               href="${escapeHtml(info.url)}" download>Download PNG</a>
            <span style="font-size:10px; color:var(--hud-text-dim);">${(info.bytes / 1048576).toFixed(2)} MB</span>
          </div>
        </div>
        <div style="flex:1 1 380px; min-width:280px;">
          <div style="font-family:var(--font-display); font-size:11px; color:var(--db-cyan-bright); margin-bottom:6px;">
            WHAT THE CHANNELS ACTUALLY CARRY
          </div>
          <pre id="texAnalysis" style="font-family:var(--font-mono); font-size:10.5px; color:var(--hud-text);
               background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.08); padding:10px;
               white-space:pre-wrap; margin:0; max-height:420px; overflow:auto;">measuring…</pre>
        </div>
      </div>`;

    try {
      const a = await (await fetch(`/api/texture/analyze?path=${encodeURIComponent(gamePath)}`)).json();
      const el = document.getElementById("texAnalysis");
      if (el) el.textContent = (a.report || a.error || "no result").trim();
    } catch (e) {
      const el = document.getElementById("texAnalysis");
      if (el) el.textContent = "Analysis unavailable: " + e.message;
    }
  },

  renderDetail() {
    const pane = document.getElementById("matDetailPane");
    const e = this.state.byPath[this.state.selectedPath];
    if (!e) { pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a material</p></div></div>`; return; }

    const chainCrumb = [e.name, ...(e.parentChain || []).map((p) => {
      const pe = this.state.byPath[p];
      return pe ? pe.name : `${p.split("/").pop().replace(".json", "")} (missing)`;
    })].reverse().map((n, i, arr) => {
      const isSelf = i === arr.length - 1;
      const path = isSelf ? null : [e.jsonPath, ...(e.parentChain || [])].reverse()[i];
      return path && this.state.byPath[path]
        ? `<a href="#" data-chain="${escapeHtml(path)}" style="color:var(--db-cyan-bright); text-decoration:none;">${escapeHtml(n)}</a>`
        : `<span style="color:${isSelf ? "var(--hud-text)" : "var(--hud-sp)"};">${escapeHtml(n)}</span>`;
    }).join(` <span style="opacity:0.5;">›</span> `);

    const paramRow = (p) => {
      // A texture parameter's value is a /Game/... path. Make it clickable:
      // the whole point of a material browser is being able to SEE the
      // texture it references, not read its path.
      const isTex = p.group === "textureParams" && typeof p.value === "string" && p.value.startsWith("/Game/");
      const valCell = isTex
        ? `<td style="padding:2px 8px 2px 0; max-width:260px;">
             <a href="#" class="tex-open" data-tex="${escapeHtml(p.value)}"
                style="font-family:var(--font-mono); font-size:10px; color:var(--db-cyan-bright); text-decoration:none; border-bottom:1px dotted var(--db-cyan-bright); display:inline-block; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;"
                title="${escapeHtml(p.value)}">${escapeHtml(this.fmtVal(p.value))}</a>
           </td>`
        : `<td style="font-family:var(--font-mono); font-size:10px; color:var(--hud-text); padding:2px 8px 2px 0; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(JSON.stringify(p.value))}">${escapeHtml(this.fmtVal(p.value))}</td>`;
      return `
      <tr>
        <td style="font-family:var(--font-mono); font-size:10.5px; color:var(--hud-text); padding:2px 8px 2px 0;">${escapeHtml(String(p.name))}</td>
        <td style="font-size:10px; color:var(--hud-text-dim); padding:2px 8px 2px 0;">${escapeHtml(p.group.replace("Params", ""))}</td>
        ${valCell}
        <td style="font-family:var(--font-mono); font-size:10px; color:${p.setBy === e.name ? "var(--db-cyan-bright)" : "var(--hud-text-dim)"}; padding:2px 0;">${escapeHtml(p.setBy)}${p.setBy === e.name ? " (this asset)" : ""}</td>
      </tr>`;
    };

    pane.innerHTML = `
      <div class="hud-panel" style="padding:16px;">
        <div style="font-family:var(--font-display); font-size:15px; font-weight:600; color:var(--hud-text);">${escapeHtml(e.name)}
          <span class="pill ${e.type === "Material" ? "verified" : "unverified"}" style="margin-left:8px;">${e.type === "Material" ? "MASTER Material" : e.type}</span>
          ${e.customShadingModel ? `<span class="pill unverified" title="Custom engine shading model — stock UE 5.3.2 has no MSM_CelSf; the recreation script substitutes DEFAULT_LIT and the cel response must be rebuilt by hand.">MSM_CelSf (custom)</span>` : ""}
        </div>
        <div style="font-family:var(--font-mono); font-size:10px; color:var(--hud-text-dim); margin:3px 0 10px;">${escapeHtml(e.jsonPath)}</div>

        <div style="font-size:11px; margin-bottom:10px;"><span style="color:var(--hud-text-dim);">Chain:</span> ${chainCrumb}</div>
        ${e.chainBroken ? `<div style="font-size:10.5px; color:var(--hud-sp); margin-bottom:8px;">⚠ Parent chain breaks above this family — the parent's JSON wasn't in the uploaded export. Upload its folder and rebuild the Materials Index to complete the chain.</div>` : ""}

        <div style="display:flex; gap:14px; flex-wrap:wrap; font-size:11px; color:var(--hud-text-dim); margin-bottom:10px;">
          ${e.blendMode ? `<span>Blend: <b style="color:var(--hud-text);">${escapeHtml(e.blendMode)}</b></span>` : ""}
          ${e.shadingModel ? `<span>Shading: <b style="color:var(--hud-text);">${escapeHtml(e.shadingModel)}</b></span>` : ""}
          ${e.opacityMaskClipValue != null ? `<span>Opacity clip: <b style="color:var(--hud-text);">${e.opacityMaskClipValue}</b></span>` : ""}
          ${(e.usageFlags || []).length ? `<span title="${escapeHtml(e.usageFlags.join(", "))}">Usage flags: <b style="color:var(--hud-text);">${e.usageFlags.length}</b></span>` : ""}
        </div>

        ${(e.children || []).length ? `
          <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--hud-text); margin:8px 0 4px;">CHILDREN (${e.children.length})</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:10px;">
            ${e.children.map((c) => {
              const ce = this.state.byPath[c];
              return `<a href="#" data-chain="${escapeHtml(c)}" class="toggle-btn" style="font-size:10px; text-decoration:none;">${escapeHtml(ce ? ce.name : c.split("/").pop())}</a>`;
            }).join("")}
          </div>` : ""}

        <div style="font-family:var(--font-display); font-size:11px; font-weight:600; color:var(--hud-text); margin:8px 0 2px;">
          EFFECTIVE PARAMETERS (${(e.effectiveParams || []).length})
          <span style="font-weight:400; font-size:9.5px; color:var(--hud-text-dim); margin-left:6px;">chain-merged root → this asset; “set by” shows which asset last set each value</span>
        </div>
        <div style="max-height:320px; overflow-y:auto;">
          <table style="border-collapse:collapse; width:100%;">
            <tr style="font-size:9px; color:var(--hud-text-dim); text-align:left;"><th>NAME</th><th>TYPE</th><th>VALUE</th><th>SET BY</th></tr>
            ${(e.effectiveParams || []).map(paramRow).join("")}
          </table>
        </div>

        <div class="mod-callout" style="margin-top:12px;">
          <div class="mod-name">Normal map → packed _S map</div>
          <div class="mod-effect-line" style="margin-bottom:6px;">
            The game's <code>_S</code> maps are <b>not specular maps</b>. Measured across 12 shield
            textures and one known normal map: <b>R and G are a tangent-space normal's X and Y</b>
            (both centred on 128, uncorrelated, 99.8% inside the unit circle — identical to a real
            normal map), <b>blue is an authored mask</b>, and alpha is unused. A normal map wastes
            blue on a constant 255, because Z is reconstructible from X and Y — this game puts data there.
            <br><br>
            Upload a normal map and this packs it into that layout. It will <b>not</b> invent the blue
            channel: I tested curvature, edge magnitude, slope and flatness against the real maps and
            every correlation came back at |r| ≈ 0.04 — noise. Blue is painted by hand, so you get a
            correct R/G/A and a blue channel you still own.
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <input type="file" id="nrmFile" accept="image/png,image/tga,image/jpeg"
                   style="font-size:10px; color:var(--hud-text-dim); max-width:230px;" />
            <label style="font-size:10px; color:var(--hud-text-dim);">Blue:
              <select id="nrmBlue" style="font-size:10px; background:rgba(0,0,0,0.4); color:var(--hud-text); border:1px solid rgba(64,207,216,0.3);">
                <option value="255">constant 255 (yours to author)</option>
                <option value="128">constant 128</option>
                <option value="0">constant 0</option>
                <option value="curvature">curvature (a starting point — paint over it)</option>
              </select>
            </label>
            <label style="font-size:10px; color:var(--hud-text-dim); display:flex; align-items:center; gap:4px;">
              <input type="checkbox" id="nrmFlipG" /> flip green (DirectX↔OpenGL)
            </label>
            <button id="nrmConvert" class="toggle-btn" style="font-size:10px; padding:2px 12px;">Convert</button>
            <span id="nrmMsg" style="font-size:10px; color:var(--rank-a);"></span>
          </div>
        </div>

        <div class="mod-callout" style="margin-top:12px;">
          <div class="mod-name">Recreate in UE 5.3.2</div>
          <div class="mod-effect-line" style="margin-bottom:6px;">
            Downloads a ZIP with the generated editor script for the whole
            <b>${escapeHtml(e.rootName)}</b> family (parents created before children, every parameter
            scaffolded on the master by name), INSTRUCTIONS.md for loading it in UE 5.3.2, and a list
            of every texture the family references. The master's internal node graph is NOT in the
            export — that part is hand work on the generated scaffolding.
          </div>
          <a class="toggle-btn" style="text-decoration:none; display:inline-block; font-size:11px; border-color:var(--db-cyan-bright); color:var(--db-cyan-bright);"
             href="/api/materials/recreation-zip?family=${encodeURIComponent(e.rootName)}" download>⬇ Download recreation ZIP</a>
          <span style="font-size:9.5px; color:var(--hud-text-dim); margin-left:8px;">CLI equivalent: <code>python3 tools/generate_ue_material_script.py --family ${escapeHtml(e.rootName)}</code></span>
        </div>
      </div>
    `;
    // Clicking a texture parameter opens it. This is the thing a material
    // browser is for -- seeing the texture, not reading its path.
    const convertBtn = pane.querySelector("#nrmConvert");
    if (convertBtn) {
      convertBtn.addEventListener("click", async () => {
        const f = pane.querySelector("#nrmFile").files[0];
        const msg = pane.querySelector("#nrmMsg");
        if (!f) { msg.textContent = "Choose a normal map first."; return; }
        msg.textContent = "converting…";
        try {
          const blue = pane.querySelector("#nrmBlue").value;
          const flip = pane.querySelector("#nrmFlipG").checked;
          const r = await fetch(`/api/texture/normal-to-s?blue=${encodeURIComponent(blue)}&flipGreen=${flip}`, {
            method: "POST",
            headers: { "Content-Type": f.type || "image/png" },
            body: f,
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || `Failed (${r.status})`);
          }
          const blob = await r.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = f.name.replace(/\.(png|tga|jpe?g)$/i, "").replace(/_?(Nrm|Normal|_N)$/i, "") + "_S.png";
          a.click();
          URL.revokeObjectURL(a.href);
          msg.textContent = "done — check your downloads";
        } catch (e) {
          msg.textContent = e.message;
        }
      });
    }

    pane.querySelectorAll(".tex-open").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.openTextureModal(a.dataset.tex);
      });
    });

    pane.querySelectorAll("[data-chain]").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.state.selectedPath = a.dataset.chain;
        this.renderList();
        this.renderDetail();
      });
    });
  },

  fmtVal(v) {
    if (v == null) return "—";
    if (typeof v === "object") {
      if ("R" in v) return `RGBA(${v.R}, ${v.G}, ${v.B}, ${v.A})`;
      return JSON.stringify(v);
    }
    if (typeof v === "string") return v.split("/").pop();
    return String(v);
  },
};
