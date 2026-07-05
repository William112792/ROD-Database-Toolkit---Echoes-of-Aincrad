// ============================================================
// monster-stats-browser.js
// Monsters > Stats -- the level/HP data unlocked by the Blueprints/
// export, resolving Monsters > Spawns' long-standing "-1 = inherit"
// gap for every enemy this export has Blueprint data for.
//
// Source: each enemy's Default__BP_E{code}_C object (EnemyLevel, the
// "inherit" default; AttackPower/DefencePower/WeaponExperiencePoint;
// DifficultyLevelRewardLotKeys -- CONFIRMED real keys in
// DT_RewardLotTable, a richer per-difficulty drops link than Drops'
// own reward-key inference) plus its CT_E{code} curve table
// (MaxHealth/AttackPower/DefencePower/ExperiencePoint/Col as level
// curves, Time = level 1..301). Joined to the Monster database by the
// SAME confirmed E{code} <-> EnemyName_{code} link Spawns and Drops
// use, via DataStore.monstersByTitleKey.
//
// This does NOT change what Monsters > Spawns shows -- that -1 is
// still literally what the spawn table says. This section shows each
// enemy's own Blueprint default level and the curve it sits on.
// ============================================================

const MonsterStatsBrowserView = {
  state: {
    loaded: false,
    entries: [],
    selectedCode: null,
    search: "",
    family: "all",
  },

  async render(container) {
    this.container = container;
    if (!this.state.loaded) {
      container.innerHTML = `<div class="hud-panel"><p style="color:var(--hud-text-dim);">Loading monster stats…</p></div>`;
      try {
        this.state.entries = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/MonsterStats/MonsterStats.json`);
        this.state.loaded = true;
      } catch (e) {
        container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Couldn't load MonsterStats.json — run the Monsters focus build.</p></div></div>`;
        return;
      }
    }
    container.innerHTML = "";
    const idx = this.indexSummary();
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${this.state.entries.length}</b> enemy Blueprints with stats</span>
        <span><b>${this.state.entries.filter((e) => e.hasCurve).length}</b> with a level curve (1–301)</span>
        <span style="margin-left:auto; opacity:0.6;" title="Monsters &gt; Spawns still shows -1 as 'inherit' — that table literally says -1. This section shows each enemy's own Blueprint default level instead.">resolves Spawns' 'inherit' gap</span>
      </div>
      <div class="toolbar" id="statsToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 340px;">
        <div id="statsListPane" style="max-height:70vh; overflow-y:auto;"></div>
        <div id="statsDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);
    this.renderToolbar();
    this.renderList();
    this.renderDetail();
  },

  indexSummary() {
    return { count: this.state.entries.length };
  },

  families() {
    return [...new Set(this.state.entries.map((e) => e.family))].sort();
  },

  monsterFor(entry) {
    return DataStore.getMonsterByTitleKey ? DataStore.getMonsterByTitleKey(entry.enemyNameKey) : null;
  },

  displayName(entry) {
    const monster = this.monsterFor(entry);
    if (monster) return DataStore.getMonsterDisplayName(monster);
    return entry.code;
  },

  renderToolbar() {
    const el = document.getElementById("statsToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="statsSearch" placeholder="Search by code or name…" value="${escapeHtml(this.state.search)}" />
      <select class="filter-select" id="statsFamily">
        <option value="all">All families (${this.families().length})</option>
        ${this.families().map((f) => `<option value="${escapeHtml(f)}" ${this.state.family === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}
      </select>
    `;
    document.getElementById("statsSearch").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderList();
    });
    document.getElementById("statsFamily").addEventListener("change", (e) => {
      this.state.family = e.target.value;
      this.renderList();
    });
  },

  getFiltered() {
    let list = this.state.entries;
    if (this.state.family !== "all") list = list.filter((e) => e.family === this.state.family);
    const q = this.state.search.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => e.code.toLowerCase().includes(q) || this.displayName(e).toLowerCase().includes(q));
    }
    return list;
  },

  renderList() {
    const pane = document.getElementById("statsListPane");
    const list = this.getFiltered();
    const el = document.createElement("div");
    list.forEach((e) => {
      const row = document.createElement("div");
      row.className = "weapon-list-row" + (e.code === this.state.selectedCode ? " selected" : "");
      const monster = this.monsterFor(e);
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="wl-name">${escapeHtml(this.displayName(e))}</div>
          <div class="wl-id">${escapeHtml(e.code)} · Lv.${e.level != null ? e.level : "?"} · ${escapeHtml(e.enemyType || "")}</div>
        </div>
        ${!monster ? '<span class="pill unverified" title="No Monster database entry matches this code — shown by code only">no db match</span>' : ""}
        ${!e.hasCurve ? '<span class="pill unverified" title="No CT_ curve table exported for this enemy">no curve</span>' : ""}
      `;
      row.addEventListener("click", () => {
        this.state.selectedCode = e.code;
        this.renderList();
        this.renderDetail();
      });
      el.appendChild(row);
    });
    if (!list.length) {
      el.innerHTML = `<div class="hud-panel"><div class="empty-state" style="padding:24px 10px;"><div class="empty-icon">📈</div><h4>No monsters match</h4></div></div>`;
    }
    pane.innerHTML = "";
    pane.appendChild(el);
    if (!this.state.selectedCode || !list.find((e) => e.code === this.state.selectedCode)) {
      this.state.selectedCode = list.length ? list[0].code : null;
      this.renderDetail();
    }
  },

  // A dependency-free inline SVG line chart -- the app has no charting
  // library elsewhere, so this stays consistent with that (zero
  // external deps) rather than pulling one in for a single view.
  sparklineSVG(points, color) {
    if (!points || !points.length) return "";
    const w = 560, h = 140, pad = 28;
    const xs = points.map((p) => p.level);
    const ys = points.map((p) => p.value);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = 0, maxY = Math.max(...ys) * 1.08;
    const sx = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (w - pad * 2);
    const sy = (y) => h - pad - ((y - minY) / (maxY - minY || 1)) * (h - pad * 2);
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.level).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
    const gridY = [0, 0.5, 1].map((f) => h - pad - f * (h - pad * 2));
    const lastP = points[points.length - 1];
    return `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px; overflow:visible;">
        ${gridY.map((gy) => `<line x1="${pad}" y1="${gy}" x2="${w - pad}" y2="${gy}" stroke="rgba(135,200,210,0.12)" stroke-width="1"/>`).join("")}
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
        <circle cx="${sx(lastP.level)}" cy="${sy(lastP.value)}" r="3.5" fill="${color}"/>
        <text x="${pad}" y="${h - 6}" font-size="10" fill="var(--hud-text-dim)">Lv.${minX}</text>
        <text x="${w - pad}" y="${h - 6}" font-size="10" fill="var(--hud-text-dim)" text-anchor="end">Lv.${maxX}</text>
        <text x="${w - pad}" y="${sy(lastP.value) - 8}" font-size="11" fill="${color}" text-anchor="end">${Math.round(lastP.value).toLocaleString()}</text>
      </svg>
    `;
  },

  renderDetail() {
    const pane = document.getElementById("statsDetailPane");
    const e = this.state.entries.find((x) => x.code === this.state.selectedCode);
    if (!e) {
      pane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a monster</p></div></div>`;
      return;
    }
    const monster = this.monsterFor(e);
    const curveColors = { MaxHealth: "#e06c75", AttackPower: "#e5c07b", DefencePower: "#61afef", ExperiencePoint: "#98c379" };
    const curveLabels = { MaxHealth: "Max HP", AttackPower: "Attack Power", DefencePower: "Defence Power", ExperiencePoint: "Experience Point" };

    pane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <h3 style="align-self:stretch;">Monster Stats</h3>
        <div class="preview-name">${escapeHtml(this.displayName(e))}</div>
        <div class="preview-itemkey">${escapeHtml(e.code)}${monster ? "" : ' <span class="pill unverified" title="No Monster database entry with this code — shown by code only">no db match</span>'}</div>

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
          <table style="width:100%; border-collapse:collapse;"><tbody>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim); white-space:nowrap;">Default level</td>
              <td style="padding:4px 10px; font-size:13px;">${e.level != null ? e.level : "—"}
                <span style="font-size:10.5px; color:var(--hud-text-dim);">(the Blueprint's EnemyLevel — what Spawns' -1 "inherit" resolves to)</span></td></tr>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Enemy type</td>
              <td style="padding:4px 10px; font-size:13px;">${escapeHtml(e.enemyType || "—")}</td></tr>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Attack / Defence (base)</td>
              <td style="padding:4px 10px; font-size:13px; font-family:var(--font-mono);">${e.attackPower ?? "—"} / ${e.defencePower ?? "—"}</td></tr>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Weapon XP value</td>
              <td style="padding:4px 10px; font-size:13px; font-family:var(--font-mono);">${e.weaponExperiencePoint ?? "—"}</td></tr>
            <tr><td style="padding:4px 10px; font-size:11px; color:var(--hud-text-dim);">Source</td>
              <td style="padding:4px 10px; font-size:11px; font-family:var(--font-mono); word-break:break-all;">${escapeHtml(e.bpPath)}</td></tr>
          </tbody></table>
        </div>

        ${e.hasCurve ? `
          <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px;">
            <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:6px;">Level Curves (1–301)</div>
            <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:8px;">
              From this enemy's own <code>CT_${escapeHtml(e.code)}</code> curve table — the actual
              per-level values, not an estimate.
            </div>
            ${Object.entries(curveLabels).map(([key, label]) => e.curve && e.curve[key] ? `
              <div style="margin-bottom:14px;">
                <div style="font-size:11px; color:${curveColors[key]}; margin-bottom:2px;">${escapeHtml(label)}</div>
                ${this.sparklineSVG(e.curve[key], curveColors[key])}
              </div>
            ` : "").join("")}
          </div>
        ` : `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:14px;">
            <div class="mod-name">No level curve exported</div>
            <div class="mod-effect-line">This enemy's <code>CT_${escapeHtml(e.code)}</code> curve table is not in the
            current export (5 of 174 enemies are missing theirs) — shown, not estimated.</div>
          </div>
        `}

        <div class="hud-panel" style="width:100%; text-align:left; margin-top:14px; padding:12px 14px; background:rgba(155,111,224,0.06); border:1px solid rgba(155,111,224,0.25);">
          <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--rank-a); margin-bottom:6px;">Per-Difficulty Reward Links</div>
          <div style="font-size:11px; color:var(--hud-text-dim); margin-bottom:6px;">
            CONFIRMED real keys in <code>DT_RewardLotTable</code> — a richer per-difficulty drops
            link than the reward-key inference Monsters &gt; Drops uses today.
          </div>
          ${Object.entries(e.difficultyRewards || {}).map(([diff, keys]) => `
            <div style="font-size:12px; margin-bottom:3px;">
              <span style="color:var(--hud-text-dim); display:inline-block; min-width:70px;">${escapeHtml(diff)}</span>
              ${keys.map((k) => `<span style="font-family:var(--font-mono); font-size:11px; color:var(--db-cyan-bright); margin-right:8px;">${escapeHtml(k)}</span>`).join("")}
            </div>
          `).join("") || '<div style="font-size:11px; color:var(--hud-text-dim);">none listed</div>'}
        </div>
      </div>
    `;
  },
};
