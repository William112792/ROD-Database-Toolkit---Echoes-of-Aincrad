// ============================================================
// active-skills-browser.js
// Browser for Characters > Active Skills -- the 10 rows of
// DataAssets/Parameters/Hero/DT_ActiveSkillList.json, the table an
// earlier session recorded as deliberately left unbuilt while
// ActiveSkill1's in-game trigger was unconfirmed (TRANSCRIPT §14);
// built now at the user's request as part of the Characters cluster.
//
// HONEST LIMIT, confirmed before building: the names (Recovery,
// Search, ...) are INTERNAL DEVELOPER STRINGS -- no ActiveSkillName_*
// key family exists in any of the 13 languages, so there is no
// localization here and the name is labeled internal rather than
// pretending it's translated. What the table genuinely carries:
// ID, soul cost (Decrease_Soul), cooldown seconds, and a thumbnail
// icon (all 10 T_ActiveSkill*.png confirmed present).
// ============================================================

const ActiveSkillsBrowserView = {
  render(container) {
    const idx = DataStore.activeSkillIndex || {};
    const skills = DataStore.activeSkills || [];
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${idx.count || 0}</b> active skills</span>
        <span><b>${idx.withIcon || 0}</b> with icons</span>
        <span style="margin-left:auto; opacity:0.6;" title="No ActiveSkillName_* key family exists in any language (searched) — the names shown are the table's own internal developer strings.">names are internal strings — no localization exists</span>
      </div>
      <div class="hud-panel" style="padding:14px;">
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--hud-border);">
            <th style="padding:6px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Icon</th>
            <th style="padding:6px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">ID</th>
            <th style="padding:6px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);" title="Internal developer string from the table's ActiveSkillName field — not localized">Internal name</th>
            <th style="padding:6px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);" title="Decrease_Soul field">Soul cost</th>
            <th style="padding:6px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Cooldown</th>
          </tr></thead>
          <tbody>
            ${skills.map((s) => `
              <tr style="border-bottom:1px solid rgba(135,200,210,0.08);">
                <td style="padding:6px 10px;">${s.iconTexture && s.hasIcon
                  ? `<img src="${escapeHtml(s.iconTexture)}" alt="" style="width:36px; height:36px; object-fit:contain;" loading="lazy"/>`
                  : '<span style="font-size:11px; color:var(--hud-text-dim);">—</span>'}</td>
                <td style="padding:6px 10px; font-family:var(--font-mono); font-size:12px;">${escapeHtml(s.id || "")}</td>
                <td style="padding:6px 10px; font-size:13px;">${escapeHtml(s.internalName || "")} <span class="pill unverified" title="Internal developer string — no localization key family exists for active skills in any language">internal</span></td>
                <td style="padding:6px 10px; text-align:right; font-family:var(--font-mono); font-size:13px;">${s.soulCost}</td>
                <td style="padding:6px 10px; text-align:right; font-family:var(--font-mono); font-size:13px;">${s.coolTimeSeconds}s</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="font-size:11px; color:var(--hud-text-dim); margin-top:10px;">
          Source: <code>DataAssets/Parameters/Hero/DT_ActiveSkillList.json</code> (ActiveSkillDataTable).
          The table carries no effect descriptions, unlock conditions, or upgrade data — those
          live in unexported Blueprint logic. An earlier session deliberately left this table
          unbuilt while its in-game trigger was unconfirmed; it's surfaced now as reference data,
          with that caveat carried over.
        </div>
      </div>
    `;
    container.appendChild(wrap);
  },
};
