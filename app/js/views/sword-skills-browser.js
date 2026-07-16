// ============================================================
// sword-skills-browser.js
// Equipment > Sword Skills -- the player's own per-weapon-category
// combat techniques, built from DT_SwordSkillList_{Category}.json (one
// per WEAPON_CATEGORIES key). Each real skill has a WeaponProficiency
// unlock tier (0-10) -- a SEPARATE per-category progression track from
// the Player tab's own (informational, not per-category-aware) Weapon
// Proficiency slider, per the user's own direct explanation.
//
// Deliberately distinct from three other systems that live elsewhere,
// so as not to be confused with them (per the user's own framing):
//   - Combination Slash / Support Skill: Partner-specific, already
//     built under Characters > Partners.
//   - Active Skills (Recovery/Search/etc.): not built anywhere yet --
//     recorded as a known future item, not this section.
//   - Status ailments (StateIconImages): not built anywhere yet either.
//
// 60 of 67 real entries (across all 6 categories) resolve a full
// official name+description. The remaining 7 (one "Counter" technique
// per category, always present by ID position regardless of its
// internal codename, plus Axe's Aftershock specifically) genuinely
// have no official name/description anywhere in this export -- shown
// honestly with a "no official name found" fallback, the same
// treatment as any other confirmed-real-but-unnamed entry elsewhere
// in this project, not hidden or guessed at.
// ============================================================

const SWORD_SKILL_DESC_COLOR_MAP = {
  SSYellow: "var(--hud-atk-label)", // Crush Attack
  SSCyan: "var(--hud-sp)",          // Severing Attack
  SSGreen: "var(--hud-hp)",         // Sword Strike
  SSRed: "var(--hud-acv)",          // Counter
};

/**
 * Converts a Sword Skill description's small, CONFIRMED CLOSED set of
 * rich-text tags (<SSYellow>/<SSCyan>/<SSGreen>/<SSRed>...</>,
 * <img id="TI_ATK"/>) into safe HTML -- verified against all 60
 * official descriptions before writing this (exactly 6 distinct tags
 * used, no others) rather than attempting to handle an open-ended tag
 * vocabulary. The whole string is escaped FIRST via escapeHtml(), then
 * only the specific escaped tag patterns this function already knows
 * about are turned back into real markup -- so any unexpected
 * character in the source text can never be interpreted as HTML, only
 * these exact known patterns can. {BaseATK_N}/{ATKModifier_N}%
 * placeholders are left as literal text: no numeric source data for
 * these exists anywhere in this export (confirmed by searching every
 * datatable), so resolving them would mean fabricating numbers rather
 * than reporting an honest gap.
 */
function renderSwordSkillDescription(desc) {
  if (!desc) return "";
  let safe = escapeHtml(desc);
  for (const [tag, color] of Object.entries(SWORD_SKILL_DESC_COLOR_MAP)) {
    const openEsc = escapeHtml(`<${tag}>`);
    safe = safe.split(openEsc).join(`<span style="color:${color}; font-weight:600;">`);
  }
  const closeEsc = escapeHtml("</>");
  safe = safe.split(closeEsc).join("</span>");
  const imgEsc = escapeHtml('<img id="TI_ATK"/>');
  safe = safe.split(imgEsc).join('<span style="color:var(--hud-atk-label); font-weight:600;">ATK</span>');
  // \r\n in the raw source -> line breaks
  safe = safe.replace(/\r\n/g, "<br/>");
  return safe;
}

const SwordSkillsBrowserView = {
  state: {
    activeCategory: "OneHandedSword",
    selectedId: null,
    search: "",
  },

  render(container) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner" id="ssQuickCoverage"></div>
      <div class="type-tabs" id="ssTypeTabs"></div>
      <div class="toolbar" id="ssToolbar"></div>
      <div class="equip-layout two-col" style="--list-col: 360px;">
        <div id="ssListPane"></div>
        <div id="ssDetailPane"></div>
      </div>
    `;
    container.appendChild(wrap);

    this.renderQuickCoverage();
    this.renderTypeTabs();
    this.renderToolbar();
    this.renderListPane();
    this.renderDetail();
  },

  renderQuickCoverage() {
    const el = document.getElementById("ssQuickCoverage");
    const all = DataStore.getAllSwordSkillsFlat();
    const named = all.filter((s) => DataStore.isSwordSkillNameVerified(s.id)).length;
    el.innerHTML = `
      <span><b>${all.length}</b> Sword Skills loaded, across 6 weapon categories</span>
      <span><b>${named}</b>/${all.length} names verified</span>
      <span style="margin-left:auto; opacity:0.6;">Weapon Proficiency shown here is a per-category unlock tier — separate from the Player tab's own Weapon Proficiency slider</span>
    `;
  },

  renderTypeTabs() {
    const el = document.getElementById("ssTypeTabs");
    const cats = DataStore.swordSkillsIndex.byCategory;
    el.innerHTML = "";
    Object.keys(cats).forEach((catKey) => {
      const meta = cats[catKey];
      const tab = document.createElement("div");
      tab.className = "type-tab" + (catKey === this.state.activeCategory ? " active" : "");
      tab.title = `${meta.label} (icon mapping inferred — see Data Coverage)`;
      tab.innerHTML = `<img src="${weaponCategoryIconPath(catKey)}" alt="" />`;
      tab.addEventListener("click", () => {
        this.state.activeCategory = catKey;
        this.state.selectedId = null;
        this.renderTypeTabs();
        this.renderListPane();
        this.renderDetail();
      });
      el.appendChild(tab);
    });
    const countEl = document.createElement("span");
    countEl.className = "type-tab-count";
    const activeMeta = cats[this.state.activeCategory];
    countEl.textContent = `${activeMeta.label} — ${activeMeta.namedCount}/${activeMeta.count} named`;
    el.appendChild(countEl);
  },

  renderToolbar() {
    const el = document.getElementById("ssToolbar");
    el.innerHTML = `
      <input type="text" class="search-input" id="ssSearchInput" placeholder="Search by name or id (e.g. 'Sharp Nail' or '01_007')..." value="${escapeHtml(this.state.search)}" />
    `;
    document.getElementById("ssSearchInput").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      this.renderListPane();
    });
  },

  getFilteredSkills() {
    let skills = DataStore.swordSkillsByCategory[this.state.activeCategory] || [];
    const q = this.state.search.trim().toLowerCase();
    if (q) {
      skills = skills.filter((s) =>
        DataStore.getSwordSkillDisplayName(s.id).toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
      );
    }
    return skills;
  },

  renderListPane() {
    const pane = document.getElementById("ssListPane");
    const skills = this.getFilteredSkills();

    if (skills.length === 0) {
      pane.innerHTML = `
        <div class="hud-panel">
          <div class="empty-state" style="padding:30px 10px;">
            <div class="empty-icon">🔍</div>
            <h4>No Sword Skills match</h4>
            <p>Try clearing the search.</p>
          </div>
        </div>
      `;
      return;
    }

    const list = document.createElement("div");
    skills.forEach((s) => list.appendChild(this.buildListRow(s)));
    pane.innerHTML = "";
    pane.appendChild(list);

    if (!this.state.selectedId || !skills.find((s) => s.id === this.state.selectedId)) {
      this.state.selectedId = skills[0].id;
      this.renderDetail();
    }
  },

  buildListRow(skill) {
    const row = document.createElement("div");
    row.className = "weapon-list-row" + (skill.id === this.state.selectedId ? " selected" : "");
    const verified = DataStore.isSwordSkillNameVerified(skill.id);
    const displayName = DataStore.getSwordSkillDisplayName(skill.id);
    row.innerHTML = `
      <div style="width:32px; height:32px; flex-shrink:0; border-radius:var(--radius-sm); background:rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; overflow:hidden;">
        ${skill.textures.icon ? `<img src="${skill.textures.icon}" alt="" style="width:100%;height:100%;object-fit:contain;" onerror="this.style.visibility='hidden';" />` : ""}
      </div>
      <span class="wl-name">${escapeHtml(displayName)}</span>
      ${skill.isCounterSkill
        ? `<span class="pill" style="opacity:0.6;">Counter</span>`
        : `<span class="pill" style="opacity:0.7;">Tier ${skill.weaponProficiency}</span>`}
      ${!verified ? `<span class="pill unverified">unverified</span>` : ""}
      <span class="wl-id">${escapeHtml(skill.id)}</span>
    `;
    row.addEventListener("click", () => {
      this.state.selectedId = skill.id;
      this.renderListPane();
      this.renderDetail();
    });
    return row;
  },

  renderDetail() {
    const detailPane = document.getElementById("ssDetailPane");
    const skill = DataStore.swordSkillsById[this.state.selectedId];
    if (!skill) {
      detailPane.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Select a Sword Skill.</p></div></div>`;
      return;
    }

    const verified = DataStore.isSwordSkillNameVerified(skill.id);
    const displayName = DataStore.getSwordSkillDisplayName(skill.id);
    const description = DataStore.getSwordSkillDescription(skill.id);
    const descVerified = DataStore.isSwordSkillDescriptionVerified(skill.id);

    const sourceFootnote = `
      <div class="source-footnote">
        Name/description: DataAssets/Items/Weapons/SwordSkill/DT_SwordSkillList_${escapeHtml(skill.category)}.json
        row "${escapeHtml(skill.id)}" → SwordSkillName_${escapeHtml(skill.id)} / SwordSkillDescription_${escapeHtml(skill.id)}
        in the official game localization.<br/>
        Weapon Proficiency + Soul cost: same row's own <code>WeaponProficiency</code> / <code>Decrease_Soul</code> fields.<br/>
        Animation clips: same row's <code>SkillLevel1..5ClipID</code> fields.
      </div>
    `;

    // Animation clip per skill LEVEL. These are clip IDENTIFIERS, not
    // asset paths -- and the AnimMontage assets they name are not in
    // this export (the strings appear nowhere else, including the SDK's
    // GObjects dump). Shown as what they are, with the naming
    // convention spelled out, rather than as links that would 404.
    const clips = skill.animationClips || [];
    const animationBlock = clips.length ? `
      <div class="hud-panel" style="width:100%; text-align:left; margin-top:12px; padding:12px 14px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright); margin-bottom:4px;">ANIMATION CLIPS (per skill level)</div>
        <table style="width:100%; border-collapse:collapse;">
          ${clips.map((c) => `
            <tr>
              <td style="padding:2px 8px 2px 0; font-size:11px; color:var(--hud-text-dim); width:60px;">Lv ${c.level}</td>
              <td style="padding:2px 0; font-family:var(--font-mono); font-size:11px; color:var(--hud-text);">${escapeHtml(c.clipId)}</td>
            </tr>`).join("")}
        </table>
        <div style="font-size:9.5px; color:var(--hud-text-dim); margin-top:5px;">
          Naming convention: <code>SwordSkill_&lt;weaponIndex&gt;_&lt;skillIndex&gt;_&lt;level&gt;</code>. The AnimMontage assets
          themselves are <b>not in this export</b> — no asset, path, or object anywhere carries these names. To view them,
          export the game's <code>Animation/</code> (or <code>CHR/**/Montage</code>) tree from FModel and upload it; the
          Asset Inspector will pick them up.
        </div>
      </div>` : "";

    detailPane.innerHTML = `
      <div class="hud-panel weapon-preview">
        <div class="preview-img-wrap zoomable-icon" id="ssZoomTarget" ${skill.textures.icon ? 'title="Click to zoom"' : ""} style="cursor:${skill.textures.icon ? "zoom-in" : "default"};">
          ${skill.textures.icon
            ? `<img src="${skill.textures.icon}" alt="" />`
            : `<div class="empty-state" style="padding:20px;"><p style="font-size:11px;">No icon exists for this entry in this export.</p></div>`}
        </div>
        <h2>${escapeHtml(displayName)} ${!verified ? '<span class="pill unverified">unverified name</span>' : ""}</h2>
        <div class="preview-itemkey">${escapeHtml(skill.id)}</div>

        ${!verified ? `
          <div class="mod-callout unresolved" style="width:100%; text-align:left; margin-top:10px;">
            ${skill.isCounterSkill
              ? `No official name exists for this technique anywhere in the export — every weapon category has one "Counter" skill at this same position (ID *_000), consistently present but never localized. Internal name: <code>${escapeHtml(skill.internalName)}</code>.`
              : `No official name exists for this specific skill anywhere in the export, even though it has a real icon and is clearly not a placeholder slot. Internal name: <code>${escapeHtml(skill.internalName)}</code>.`}
          </div>
        ` : ""}

        ${description ? `
          <div class="item-description" style="width:100%; margin-top:10px;">
            ${renderSwordSkillDescription(description)}
            ${!descVerified ? '<span class="pill unverified" style="margin-left:6px;">unverified description</span>' : ""}
          </div>
        ` : ""}

        <table class="acv-table" style="margin-top:14px;">
          <tbody>
            <tr><td style="text-align:left;">Weapon Category</td><td>${escapeHtml(skill.categoryLabel)}</td></tr>
            <tr><td style="text-align:left;">Weapon Proficiency tier</td><td>${skill.isCounterSkill ? "— (always available)" : skill.weaponProficiency}</td></tr>
            <tr><td style="text-align:left;">SP cost</td><td>${skill.soulCost}</td></tr>
          </tbody>
        </table>

        ${animationBlock}
      ${sourceFootnote}
      </div>
    `;

    if (skill.textures.icon) {
      document.getElementById("ssZoomTarget").addEventListener("click", () => {
        openIconZoom({
          itemKey: skill.id,
          rank: null,
          textures: { icon: skill.textures.icon, categoryPlaceholderRender: skill.textures.icon },
        }, displayName);
      });
    }
  },
};
