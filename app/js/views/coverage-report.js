// ============================================================
// coverage-report.js
// Transparent report of what's verified vs. unknown in the
// current data export -- so the reverse-engineering team always
// knows what's solid ground vs. still-needs-work.
// ============================================================

const CoverageReportView = {
  render(container) {
    const allWeapons = DataStore.getAllEquipmentFlat();
    const verified = allWeapons.filter((w) => DataStore.isVerifiedName(w.itemKey));
    const unverified = allWeapons.filter((w) => !DataStore.isVerifiedName(w.itemKey));
    const report = DataStore.modCoverageReport;
    const devRef = DataStore.devReference;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      ${this.renderDevReference(devRef)}

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Localization Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          Item names and descriptions are sourced from the game's own
          official UE string-table export (<code>Game.json</code>, one
          per language under <code>Localization/Game/{lang}/</code>) —
          this is ground truth, not an inferred match, and covers all
          13 languages the game ships. It superseded an earlier
          weapon-only <code>weapon_names_{lang}.json</code> source
          (kept as a fallback) and, before that, a rank+ATK signature
          matching approach against <code>EOA-SAO-Weapons-Updated.xlsx</code>
          which correctly resolved every weapon it attempted but left a
          couple of pairs genuinely unresolved without further evidence
          — the official table resolved those too, plus most armor
          names that previously had no source at all. Equipment Unique
          MOD names/descriptions and all 26 EX-MOD labels are sourced
          the same way (see the Mod Coverage section below). Anything
          not covered by any source falls back to its raw ItemKey/raw
          enum name in every view, rather than a guess.
        </p>
        <div style="display:flex; gap:24px; margin-top:14px;">
          <div>
            <div style="font-size:28px; font-family:var(--font-mono); color:var(--hud-hp);">${verified.length}</div>
            <div style="font-size:12px; color:var(--hud-text-dim);">verified names (current language)</div>
          </div>
          <div>
            <div style="font-size:28px; font-family:var(--font-mono); color:var(--rank-a);">${unverified.length}</div>
            <div style="font-size:12px; color:var(--hud-text-dim);">showing raw ItemKey</div>
          </div>
        </div>
        ${this.renderLanguageBreakdown()}
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Monster Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          Monster identity and flavor text come from <code>DT_MonsterDatabase.json</code>
          (120 rows) the same way item names/descriptions do — <code>EnemyName_*</code> for the
          name (<code>ST_GeneralLocalizeList</code>) and the row's resolved
          <code>DatabaseText_Monster_*</code> key for the description
          (<code>ST_DatabaseLocalizeList</code> — a DIFFERENT string table than items/mods use,
          confirmed by inspecting the source directly). Coverage here is much lower than
          items: only 27 of 120 rows have any localization at all in this export, across every
          one of the 13 languages — the other 93 are real rows (a genuine EnemyType + numeric
          ID) with no matching name string anywhere. There's no way to tell from this data alone
          whether that's unreleased content, cut monsters, or simply not yet localized.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          Two things this export does NOT have for monsters, confirmed by direct search before
          the Monsters section was built (not assumed): <b>no per-monster combat stats</b> —
          no level, HP, ATK, or DEF field exists anywhere for any monster (the two enemy-related
          curves that do exist, <code>EnemyLevelCoefDamageCurve</code> and
          <code>CoefFixedLevelExperiencePointCurve</code>, are global multipliers applied
          uniformly to every monster, not per-monster values) — and <b>no image/texture
          reference</b> — all 120 rows have the literal placeholder <code>"/ /_-1._-1"</code> for
          <code>DatabaseImagetID</code>, with zero exceptions. Monsters are shown in-game as a
          live rotating 3D model (see the reference screenshot), not a 2D icon the way every
          other category in this app is, so this isn't a gap in the export so much as a genuinely
          different presentation this app can't reproduce yet.
        </p>
        ${this.renderMonsterCategoryBreakdown()}
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Item Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          The Items section's list comes from <code>DT_ItemDatabase.json</code> (the in-game
          Database menu's OWN list — confirmed against 3 reference screenshots: its
          <code>SubCategory</code> field has exactly 3 values, matching the Consumables/
          Materials/Key Items tabs), cross-referenced with <code>ItemDataAsset.json</code> for
          per-item stats (rarity, stack size, buy/sell). Items have a genuinely different
          description structure than weapons/armor/monsters: TWO paragraphs, from two different
          string tables — a general mechanical-effect line (<code>ItemDescription_*</code>,
          shown for nearly every item) plus an OPTIONAL Database-menu-only flavor-text paragraph
          (<code>DatabaseText_Item_*</code>, present for only 60 of 148 items). Coverage is high:
          148/148 named, 148/148 described.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          Two confirmed, real exceptions to the normal data flow — found by direct comparison
          before the Items section was built, not assumed: <b>"Hand Mirror"</b> (Usable #73)
          exists in <code>ItemDataAsset.json</code> with full stats and a real name/description,
          but isn't registered in the Database menu's list at all — shown anyway, flagged as a
          Database-menu exception, since dropping a real fully-described item felt worse than
          flagging the inconsistency. <b>5 Key Items</b> (Teleport Crystal, Healing Crystal,
          Sacred Tree Brooch, Recording Crystal, Holo Crystal — IDs 41-45) are the OPPOSITE: real
          Database-menu entries with a name, description, and thumbnail, but NO stats record
          anywhere in this export (confirmed by checking <code>DatabaseDataAsset.json</code>'s
          parallel copy of the same rows too) — shown with rank/stack/buy-sell left blank rather
          than guessed.
        </p>
        ${this.renderItemCategoryBreakdown()}
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Recipe Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          245 recipes (Items &gt; Recipes), sourced from <code>ItemDataAsset.json</code>'s 11
          recipe maps — NOT in any in-game Database menu file, confirmed by searching every
          Database file before this was built. Recipe name/description strings are dynamic
          substitution TEMPLATES (e.g. <code>"{Rep_ItemName_WOS_1} Blueprint"</code>), not plain
          text — resolved here by parsing the embedded key and substituting in the produced
          item's real, already-localized name for the current language, the same source weapons/
          armor/items already use for that name. A formula-based approach (deriving the produced
          item's ID directly from the recipe's numeric <code>ItemId</code>) was tried and
          confirmed unreliable before being abandoned: the encoding differs per category (Upper/
          Lower/Glove use <code>realId×1000+1</code>, Shield uses the plain ID with no encoding,
          and Usable's ID happens to equal the recipe's own key, not the produced item's ID) —
          parsing the template directly is what's actually used, and matches what the game's own
          UI would substitute in.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          Coverage: 236/245 resolve a produced item. The 9 that don't are a mix, confirmed
          individually rather than assumed to be one pattern: 6 are recipes for the already-known
          unnamed weapon <code>*_37</code> slots; 2 (<code>Upper_21</code>, <code>Lower_21</code>)
          reference armor IDs that don't exist in the armor catalog at all; 1
          (<code>OneHandedSwordRecipe_99</code>) has no recipe-name localization key at all, even
          though the weapon it would produce (<code>WOS_99</code>, "Proto-Shortsword") is itself
          named — a genuinely different kind of gap from the other 8, not glossed over as the
          same explanation.
        </p>
        ${this.renderRecipeCategoryBreakdown()}
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Sword Skill Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          67 Sword Skills (Equipment &gt; Sword Skills), sourced from 6 files —
          <code>DT_SwordSkillList_{Category}.json</code>, one per weapon category, reusing
          the exact same category dict Weapons itself uses. WeaponProficiency (0-10 per skill)
          is a real, per-category unlock tier, shown directly from this data — a SEPARATE
          progression track from the Player tab's own Weapon Proficiency slider, which is
          global/informational and not per-category-aware.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          Determining which rows are real content vs. unused padding was NOT a fixed numeric
          range — an early version assumed IDs *_001 through *_010 were always real and *_011+
          was always padding, and testing directly disproved this before it shipped: Axe's real
          skill set is actually *_001-*_005 plus *_007-*_011 (11 total, not 10), because
          *_006 ("Aftershock") is real — a genuine icon exists for it
          (<code>T_SwordSkill_WAX6.png</code>) — but has no official name or description
          anywhere in this export. The final rule combines two signals: the one "Counter"
          technique per category (ID <code>*_000</code>) is ALWAYS included regardless of its
          internal codename (TwoHandedSword's happens to be "NoNameTHS00", which would
          otherwise look exactly like a placeholder), and every other row is included unless its
          internal name starts with "PlaceHolder" or "NoName".
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          Coverage: 60/67 resolve a full official name + description (60/60 among the "normal"
          numbered skills — perfect coverage there). The 7 that don't are the 6 Counter
          techniques (one per category, all consistently unnamed) plus Axe's Aftershock —
          all shown honestly with a "no official name found" fallback rather than hidden or
          guessed. Description text contains embedded formula placeholders
          (<code>{BaseATK_1}</code>, <code>{ATKModifier_1}%</code>) with no numeric source data
          anywhere in this export (confirmed by searching every datatable) — left as literal
          text rather than fabricated. The small, closed set of rich-text color tags
          (<code>&lt;SSYellow&gt;</code>/<code>&lt;SSCyan&gt;</code>/<code>&lt;SSGreen&gt;</code>/
          <code>&lt;SSRed&gt;</code>, one per attack type) is rendered as colored spans using the
          existing HUD stat colors, not stripped to plain text.
        </p>
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Lore Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          World &gt; Lore is a single flat list (no sub-categories — <code>SubCategory</code> is
          unused on all 177 rows, and the reference screenshots show one flat scrollable list,
          confirmed before this was built, not assumed), sourced from
          <code>DT_WorldViewDatabase.json</code>. The localization source is genuinely different
          from every other category here: both the name (<code>DatabaseTitle_WorldView_*</code>)
          AND the description (<code>DatabaseText_WorldView_*</code>) resolve against
          <code>ST_GeneralLocalizeList</code> — monsters and items both use
          <code>ST_DatabaseLocalizeList</code> for their description text instead, confirmed by
          checking that table has zero <code>WorldView_*</code> keys at all before this was built.
          Coverage is the best of any category: 177/177 named AND described, no exceptions.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          One confirmed gap: 40 of 177 entries (a clean, contiguous ID block — 5001 through 5040)
          have no thumbnail image anywhere in either export. By name these are written notes and
          messages (e.g. "Scouting Party Note 1," "A Warning to Adventurers"), not landmarks or
          sights — a genuinely different kind of content from the other 137 entries, not a
          texture-export oversight affecting the whole category. Shown with a placeholder image
          and an honest flag rather than hidden or guessed.
        </p>
        <div style="display:flex; gap:24px; margin-top:14px;">
          <div>
            <div style="font-size:28px; font-family:var(--font-mono); color:var(--hud-hp);">${(DataStore.loreIndex && DataStore.loreIndex.count) || 0}</div>
            <div style="font-size:12px; color:var(--hud-text-dim);">total lore entries</div>
          </div>
          <div>
            <div style="font-size:28px; font-family:var(--font-mono); color:var(--rank-a);">${(DataStore.loreIndex && DataStore.loreIndex.missingThumbnails || []).length}</div>
            <div style="font-size:12px; color:var(--hud-text-dim);">missing thumbnail (written notes)</div>
          </div>
        </div>
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Character Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          Characters (22 total, from <code>DT_CharacterDatabase.json</code>) use a 4th, distinct
          localization wiring: the description resolves directly from the row's
          <code>DescriptionKey</code> field (e.g. <code>PartnerDescription_IOM</code>) against
          <code>ST_GeneralLocalizeList</code> — unlike monsters/items/lore, there's no
          <code>DatabaseInfo[].DatabaseTextKey</code> lookup step at all, since that slot is
          always empty here. Coverage is low: ${DataStore.characterIndex ? DataStore.getAllCharactersFlat().filter(c=>DataStore.isCharacterNameVerified(c)).length : 0}/22 named,
          ${DataStore.characterIndex ? DataStore.getAllCharactersFlat().filter(c=>DataStore.isCharacterDescriptionVerified(c)).length : 0}/22 described.
          Every entry unlocks via story progress (<code>SubProgress</code>/<code>MainProgress</code>),
          never a simple pickup — confirmed across all 22 rows. Like Monsters, no image/texture
          reference exists on any row (3D model shown live, not a 2D icon).
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          7 of the 22 (${DataStore.characterIndex ? DataStore.getPartnersFlat().map(p=>DataStore.getCharacterDisplayName(p)).join(', ') : '—'})
          have a dedicated <code>DT_Partner_{code}.json</code> with a 200-level stat growth
          table — confirmed by checking which files actually exist before assuming all 7 named
          characters in the reference screenshots would. Only 3 of those 7 (Argo/Iori/Wyzeman)
          have a portrait thumbnail anywhere in either export.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          <b>Weapon + skills (added once a later export included this data):</b> all 7 partners
          have a confirmed weapon category and a specific equipped weapon, resolved to its real
          name via the same weapon localization weapons/armor already use, from
          <code>DT_PartnerList.json</code>. Only 3 of the 7 (Argo/Iori/Wyzeman) have a named
          Combination Slash + Support Skill (<code>DT_CombinationSlash.json</code> /
          <code>DT_SupportSkill.json</code>) — confirmed by which codes actually appear in those
          tables, not assumed all 7 would. Of those 3, only Iori's pair (Twin Embrace / Healing
          Circle) resolves to a real localized name and description in the current snapshot;
          Argo's and Wyzeman's fall back to their raw internal tag name (TwinMoon / TriStampede /
          VertigoImpact), unverified. This corrects an earlier version of this section, which
          accurately reported no skill or weapon-type data existed for partners in the export
          available at the time — not a mistake, just a real gap that a later export closed.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          Character Customization (face parts, voices, color palettes, presets, from
          <code>AvatarCustomizeDataAsset.json</code>) has NO name field anywhere — pure visual
          swatches, selected by appearance. Voice entries have a <code>LocalizeKey</code> field
          but it resolves to nothing in any of the 13 language files, confirmed directly — even
          voices fall back to a raw ID + internal switch name.
        </p>
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Player Build Coverage</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          The Player tab (Characters &gt; Player) is a build SIMULATOR, not a save-file viewer —
          there is no player save data anywhere in any export checked. Level, stat allocation,
          and equipped gear are all freely chosen by the user, the same way the Weapons section's
          enhancement slider lets you try any tier rather than reading one from a save. Total ATK
          reuses the exact same <code>simulateTotalATK()</code> engine the Weapons calculator
          itself uses (already validated against 3 in-game screenshots), fed the player's own
          allocated STR/DEX/AGI/INT instead of free-standing test inputs — not a new formula.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          <b>Growth Points</b> (<code>GrowPointCurve2.json</code>): confirmed, not inferred — the
          cumulative total at level 15 sums to exactly 36, matching the user's own in-game
          screenshot ("Growth Points: 0/36") exactly. The per-level award array (not just the
          running total) is preserved in <code>PlayerConfig.json</code> for transparency.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          <b>HP / Stamina / SP</b> (<code>CT_GrowthParam.json</code>, keyed by VIT/END/MND):
          confirmed AT FLOOR STATS — the same screenshot independently confirms all three
          simultaneously (VIT=END=MND=1 gives HP 200/200, Stamina 200/200, SP 150/150, matching
          exactly). The curve's behavior away from the floor (its 30/60/90 breakpoints) is a
          data-grounded extrapolation, not independently screenshot-verified the way the floor
          value is — the Player tab's own UI carries this same distinction rather than presenting
          both with equal confidence. <code>HeroStatusParameters.json</code>'s own MaxHealth/
          MaxStamina/MaxSoul/ATK/DEF fields are a SEPARATE, lower-confidence concept — level-based
          ceilings, not the live computed value (confirmed by their ATK/DEF values being far below
          any real equipped-weapon total).
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          <b>Def</b>: a flat sum of equipped armor pieces' own <code>def</code> field — the same
          field the Armor section already shows. All 12 Shields in this export have
          <code>def: null</code> (a real, confirmed absence, not a bug) — equipping a Shield adds
          0 to the Def total, with an honest note shown rather than silently treating null as 0
          with no explanation. Equipped Unique MODs (e.g. a shield's GuardAgitation) are real but
          NOT factored into the Def total in this first version — a known simplification, not an
          oversight.
        </p>
        <p style="font-size:13px; color:var(--hud-text-dim); margin: 10px 0 0;">
          <b>Weapon Proficiency</b> (<code>SwordSkillPointCurve.json</code>): real curve data
          exists and is shown as an informational slider (visible in the user's reference
          screenshot as "Weapon Proficiency 3"), but nothing in this export confirms what action
          earns these points or that the value feeds the ATK formula at all — it is deliberately
          NOT wired into any calculated total, only displayed.
        </p>
      </div>

      ${DataStore.ambiguousNamePairs.length > 0 ? `
      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Ambiguous Name Matches</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          Several weapons share an <i>identical</i> rank+ATK signature with another
          named weapon in the xlsx reference, so signature matching alone can't tell
          them apart — assigning a name based on signature alone would be a coin flip.
          Where we found a second piece of evidence (the weapon's Unique MOD name
          matching something visible in a screenshot) we used it to break the tie;
          where we didn't, both candidates are left unverified rather than guessed.
        </p>
        ${DataStore.ambiguousNamePairs.map((pair) => `
          <div style="padding:10px 14px; margin-bottom:8px; border-radius:4px; background:rgba(0,0,0,0.2); border:1px solid ${pair.resolved ? 'rgba(94,235,109,0.3)' : 'rgba(224,163,59,0.3)'};">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <b style="font-family:var(--font-mono); font-size:13px;">${pair.candidates.join(" ↔ ")}</b>
              <span class="pill ${pair.resolved ? "verified" : "unverified"}">${pair.resolved ? "resolved" : "still ambiguous"}</span>
            </div>
            <div style="font-size:12px; color:var(--hud-text-dim); margin:4px 0;">
              Possible name(s): ${pair.possibleNames.join(", ")}
            </div>
            <div style="font-size:12px; color:var(--hud-text-dim);">${pair.note}</div>
          </div>
        `).join("")}
      </div>
      ` : `
      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Ambiguous Name Matches</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin:0;">
          No open questions right now — every weapon name-collision case
          from the earlier signature-matching approach was resolved once
          the official localization table arrived. This section will
          repopulate automatically if armor ever needs the same kind of
          tiebreaking.
        </p>
      </div>
      `}

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Unverified Equipment (need a name)</h3>
        <div style="max-height:260px; overflow-y:auto;">
          ${unverified.map((w) => {
            const isArmor = !!DataStore.armorByItemKey[w.itemKey];
            const iconPath = isArmor
              ? (w.textures.iconSmallMale || w.textures.iconSmall)
              : w.textures.iconSmall;
            const statText = isArmor
              ? (w.def !== null ? `DEF ${w.def}` : "no DEF field")
              : `ATK ${w.enhancement.baseWeaponATK[0]}`;
            return `
            <div class="weapon-list-row">
              <span class="wl-icon"><img src="${iconPath}" loading="lazy" onerror="this.style.display='none';" /></span>
              <span class="wl-name" style="font-size:13px;">${w.itemKey}</span>
              <span class="wl-id">${w.categoryLabel} · Rank ${rankShort(w.rank)} · ${statText}</span>
            </div>
          `;
          }).join("")}
        </div>
      </div>

      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Unique MOD Resolution</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          ${report.resolved.length} of ${report.totalModNamesReferenced} distinct
          equipment modifiers (weapons + armor) resolve to numeric effect data in
          <code>DA_AttributeModification.json</code>. The rest (including
          <code>AgilityBlast</code>, seen in-game on Steel Knife) have an
          official name and description from the localization export, but
          no numeric effect data in this export — that mechanical value is
          likely defined elsewhere in the game's Blueprint logic, not yet
          captured. These two are separate concerns: every mod below is
          named, none of them have a known damage/stat number to show.
        </p>
        <div style="display:flex; gap:24px; margin: 14px 0;">
          <div>
            <div style="font-size:28px; font-family:var(--font-mono); color:var(--hud-hp);">${report.resolved.length}</div>
            <div style="font-size:12px; color:var(--hud-text-dim);">resolved (has effect data)</div>
          </div>
          <div>
            <div style="font-size:28px; font-family:var(--font-mono); color:var(--rank-a);">${report.unresolved.length}</div>
            <div style="font-size:12px; color:var(--hud-text-dim);">unresolved (named, no effect data)</div>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${report.unresolved.map((m) => `<span class="pill unverified">${m}</span>`).join("")}
        </div>
      </div>

      <div class="hud-panel">
        <h3>Known Data Quirks</h3>
        <ul style="font-size:13px; color:var(--hud-text-dim); line-height:1.8; padding-left:18px; margin:0;">
          <li><b style="color:var(--hud-text);">"Item grade" vs "ACV rank" are two different things.</b>
              Each weapon has a <code>Class</code> field (D/C/B/A/S) that's its overall
              quality/grade tier — used to look up refining cost, enhancement cost, and
              sell value via the Class Table. Separately, each of STR/DEX/AGI/INT has its
              own ACV rank, which is what actually drives stat scaling and what the in-game
              equip screen's "ACV" box shows. A weapon can be grade D overall while having a
              DEX ACV rank of B — confirmed directly: Steel Sword is <code>Class: RankB</code>
              but shows ACV ranks D/B/D/D in-game, matching our data. The toolkit now labels
              these separately everywhere instead of showing one number as "the rank."</li>
          <li><b style="color:var(--hud-text);">Weapon category tab icons are an inferred mapping.</b>
              We've confirmed <code>WeaponTypeID</code> 1–6 corresponds to OneHandedSword /
              Rapier / Dagger / Mace / TwoHandedSword / Axe directly from the data. We have
              <i>not</i> confirmed which <code>T_ItemCategoryIcon_W{n}</code> icon file the
              game actually displays for each category — no JSON wires icon filenames to
              WeaponTypeID. The current W6/W4/W1/W5/W2/W3 mapping is a best guess based on
              icon shape (W6 looks like a one-handed sword, W3 looks like an axe, etc.) and
              may not be exactly right. Hover any weapon type tab to see this caveat in its
              tooltip.</li>
          <li>Every weapon's embedded <code>ThumbnailTexture</code> field points at a placeholder
              (always <code>IconID: "1"</code>) — the app derives real per-weapon icon paths
              from the <code>{prefix}{id}</code> naming convention instead, verified against
              every file on disk (127/127 resolve).</li>
          <li>Only one full 3D model render exists per weapon <i>category</i>, not per item —
              e.g. a single <code>T_Item_WTS1.png</code> stands in for every Two-Handed Sword.
              This is used as a fallback image, not a unique render.</li>
          <li>ACV rank can shift between enhancement tiers on some weapons (e.g. DEX RankB → RankA
              past a certain +N). The calculator reads the per-tier rank array, not a fixed value.</li>
          <li>Each stat's ACV contribution is floored to a whole number <i>before</i> summing —
              confirmed against Steel Knife's in-game ACV of "+40" where raw DEX contribution
              is 33.5 (floors to 33, not rounds to 34).</li>
          <li>EX-MOD ATK bonus is now a real picker (up to 4 slots, sourced from
              <code>ExtraModificationData</code>'s 26 modification types), not a free-typed
              number. Only the <code>BonusATK</code> type feeds the Total ATK calculation —
              the other 25 types are real in-game effects (Sprint Speed, Stamina Consumption,
              etc.) but don't affect ATK, so they're shown for reference without changing the
              number. The demo only seems to roll tiers 1–4 of each type's 10-tier range
              (e.g. ATK bonus 20/25/30/35, not the full 15–60) — that restriction is applied
              to every type as a best-guess default, but only confirmed for ATK specifically.</li>
          <li>All 26 EX-MOD types now have a display label AND format string (+{v}, +{v}%,
              -{v}%) confirmed directly from the official localization export
              (<code>AttributeModName_EX_{type}</code> in <code>Game.json</code>), in every
              language — up from 9/26 confirmed-by-screenshot before this update (ATK, SP,
              Normal/Extra Attack Damage, Sword Skill Damage, Slash Damage, Combo SP Increased,
              Stamina Consumption, Sprint Speed), with the other 17 previously inferred from
              the enum name alone. The picker's ⚠ marker for unconfirmed labels should no
              longer appear on any type as a result.</li>
          <li>Some resolved mod effects are partial. E.g. <code>SlashRecovery</code> ("Slash
              Recovery" in-game) resolves to a numeric <code>+10% Slash damage</code> effect,
              but its in-game description also mentions restoring SP on Slash damage — that
              second effect isn't captured anywhere in the numeric data, so it won't appear
              in the mod callout even though the mod itself is "resolved."</li>
          <li><b style="color:var(--hud-text);">Armor (Upper/Lower/Glove/Shield) has no enhancement
              system at all</b> — confirmed by absence: none of the four item maps contain an
              enhancement array or EX-MOD slots anywhere in the export, unlike weapons. Def is a
              single flat value with no scaling. Shields specifically have no <code>Def</code>
              field whatsoever, in any of the 12 shield entries.</li>
          <li>Upper/Lower/Glove textures are gendered (<code>_Male</code>/<code>_Female</code>
              suffix); Shield and weapon textures are not. The toolkit's armor browser includes
              a Male/Female toggle for the gendered categories.</li>
          <li>Shield's thumbnail/full-render filename prefix is <code>S</code>
              (<code>T_Item_Thumbnail_S3.png</code>), but its <i>database</i>-size thumbnail
              prefix is <code>Shield</code> (<code>T_Database_Thumbnail_Equipment_Shield3.png</code>)
              — a real inconsistency in the game's own export between its two icon systems, not
              a bug in this toolkit's path derivation.</li>
          <li><b style="color:var(--hud-text);">Armor category tab icons are visually identified, not
              data-confirmed.</b> T_ItemCategoryIcon_A1/A2/A3 are unambiguous by shape (a torso/collar
              silhouette, two leg shapes, and two hand/mitt shapes respectively) and mapped to
              Upper/Lower/Glove on that basis. <i>Corrected once already</i> — an earlier pass had A1
              and A3 swapped (mistook the torso shape for a glove and vice versa) until a user caught
              the mismatch in-app. The armor <code>Category</code> field values (6/7/8/9 for
              Upper/Glove/Lower/Shield) don't align numerically with the icon suffixes, so this mapping
              can't be cross-checked against data the way weapon names were — it's a visual call, now
              double-checked, but still a call rather than a confirmed data fact.</li>
          <li><b style="color:var(--hud-text);">Equipment icon border color is rank-based, confirmed for 2 of 5
              ranks.</b> Pink/red (RankB) and white/grey (RankD-equivalent context) borders were directly
              sampled from screenshots; RankC/A/S use this toolkit's existing class-badge palette as a
              best-guess extrapolation, not separately confirmed. See
              <code>Content/ROD/animation-config.json</code> → <code>rankBorderColors</code> to correct
              any of these once verified in-game.</li>
          <li><code>ItemName_Shield_99</code> ("Proto-Veil Shield") is confirmed by a different evidence
              path than the other 8 names added this round — not read directly off a screenshot showing
              that name, but inferred from its Unique MOD showing "None" in-game (matching the screenshot)
              combined with every other category's id-99 item confirmed to be that category's "Proto-"
              starter piece. Recorded with a distinct source note in the localization file.</li>
          <li><b style="color:var(--hud-text);">Shield compatibility per weapon type is inferred,
              not confirmed.</b> No field anywhere in the data states which weapon categories
              block shield equipping. The armor browser's Shield tab notes a guess (Two-Handed
              Sword, Mace, Axe can't equip a shield) based on category naming convention alone —
              treat it as unconfirmed until checked in-game.</li>
        </ul>
      </div>
    `;
    container.appendChild(wrap);

    const revealBtn = wrap.querySelector("#revealAesKey");
    if (revealBtn) {
      revealBtn.addEventListener("click", () => {
        const keyEl = wrap.querySelector("#aesKeyValue");
        const isHidden = keyEl.dataset.hidden === "true";
        if (isHidden) {
          keyEl.textContent = keyEl.dataset.fullKey;
          keyEl.dataset.hidden = "false";
          revealBtn.textContent = "Hide";
        } else {
          keyEl.textContent = "•".repeat(20) + " (click Reveal to show)";
          keyEl.dataset.hidden = "true";
          revealBtn.textContent = "Reveal";
        }
      });
    }
    const copyBtn = wrap.querySelector("#copyAesKey");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const keyEl = wrap.querySelector("#aesKeyValue");
        try {
          await navigator.clipboard.writeText(keyEl.dataset.fullKey);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1200);
        } catch {
          copyBtn.textContent = "Copy failed";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1200);
        }
      });
    }

    const reopenDisclaimerBtn = wrap.querySelector("#reopenDisclaimerBtn");
    if (reopenDisclaimerBtn) {
      reopenDisclaimerBtn.addEventListener("click", () => {
        DisclaimerModal.showIfNeeded(true); // force=true: always show, regardless of a prior "don't show again"
      });
    }

    const openBudgetTrackerBtn = wrap.querySelector("#openBudgetTrackerBtn");
    if (openBudgetTrackerBtn) {
      openBudgetTrackerBtn.addEventListener("click", () => {
        BudgetTrackerModal.show();
      });
    }

    this.loadMappingFileStatus(wrap);
  },

  /**
   * Fetches /api/mapping-files/status and patches each mapping file's
   * "Direct" button from its initial disabled/checking state -- done
   * as a separate, non-blocking async step AFTER the synchronous
   * render above, rather than making the whole page's render() async,
   * so Data Coverage's much larger set of sections isn't held up
   * waiting on this one small, independent network call. Failure
   * (server unreachable, endpoint missing on an older deployment) is
   * treated the same as "nothing found" -- Direct stays disabled
   * rather than throwing or leaving it stuck on "Checking…" forever.
   */
  async loadMappingFileStatus(wrap) {
    let status = {};
    try {
      const res = await fetch("/api/mapping-files/status");
      if (res.ok) status = await res.json();
    } catch (e) {
      // Server unreachable or endpoint missing -- Direct buttons stay
      // disabled, exactly as if nothing had been found locally.
    }

    wrap.querySelectorAll("[id^='directBtn-']").forEach((btn) => {
      const type = btn.dataset.type;
      const found = status[type];
      const versionPill = wrap.querySelector(`#directVersion-${type}`);
      if (found) {
        btn.disabled = false;
        btn.classList.remove("disabled");
        btn.title = `${found.filename} (v${found.version})`;
        btn.addEventListener("click", () => {
          window.open(`/api/mapping-files/download/${type}`, "_blank");
        });
        if (versionPill) {
          versionPill.textContent = `v${found.version}`;
          versionPill.style.display = "";
        }
      } else {
        btn.title = "No local file found under mapping-files/ for this type yet";
      }
    });
  },

  renderLanguageBreakdown() {
    const manifest = DataStore.localizationManifest;
    if (!manifest) return "";

    const codes = Object.keys(manifest).filter((k) => !k.startsWith("_"));
    const rows = codes.map((code) => {
      const m = manifest[code];
      const isCurrent = code === DataStore.currentLanguage;
      return `
        <tr style="${isCurrent ? "background:rgba(64,207,216,0.08);" : ""}">
          <td style="padding:4px 10px; font-family:var(--font-mono); font-size:12px;">${escapeHtml(code)}${isCurrent ? " ←" : ""}</td>
          <td style="padding:4px 10px; font-size:12px;">${escapeHtml(m.label)}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${m.verifiedCount}/${m.totalCount}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${m.describedCount ?? "—"}/${m.totalCount}</td>
          <td style="padding:4px 10px; font-size:12px;">${m.hasOfficialSource ? '<span class="pill verified">official</span>' : '<span class="pill unverified">none</span>'}</td>
        </tr>
      `;
    }).join("");

    return `
      <div style="margin-top:16px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; margin-bottom:6px;">Per-Language Breakdown</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--hud-border);">
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Code</th>
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Language</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Named</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Described</th>
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Source</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${manifest._gameLaunchDate ? `
          <p style="font-size:11px; color:var(--hud-text-dim); opacity:0.7; margin-top:8px; margin-bottom:0;">
            All entries sourced from official data are marked verified unconditionally
            through ${escapeHtml(manifest._gameLaunchDate)} (game go-live) — after that date,
            individual entries can be hand-flagged unverified if their in-game status
            becomes genuinely uncertain (e.g. a possible future-content placeholder).
          </p>
        ` : ""}
      </div>
    `;
  },

  renderMonsterCategoryBreakdown() {
    const catIndex = DataStore.monsterCategoryIndex;
    if (!catIndex) return "";

    const rows = Object.keys(catIndex).map((catKey) => {
      const meta = catIndex[catKey];
      const monsters = DataStore.monstersByCategory[catKey] || [];
      const namedCount = monsters.filter((m) => DataStore.isMonsterNameVerified(m)).length;
      return `
        <tr>
          <td style="padding:4px 10px; font-size:12px;">${escapeHtml(meta.label)}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${namedCount}/${meta.count}</td>
        </tr>
      `;
    }).join("");

    const allMonsters = DataStore.getAllMonstersFlat();
    const totalNamed = allMonsters.filter((m) => DataStore.isMonsterNameVerified(m)).length;

    return `
      <div style="margin-top:16px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; margin-bottom:6px;">Per-Category Breakdown (current language)</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--hud-border);">
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Enemy Type</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Named</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="border-top:1px solid var(--hud-border);">
              <td style="padding:4px 10px; font-size:12px; font-weight:600;">Total</td>
              <td style="padding:4px 10px; font-size:12px; font-weight:600; text-align:right;">${totalNamed}/${allMonsters.length}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  },

  renderItemCategoryBreakdown() {
    const catIndex = DataStore.itemCategoryIndex;
    if (!catIndex) return "";

    const rows = Object.keys(catIndex).map((catKey) => {
      const meta = catIndex[catKey];
      const items = DataStore.itemsByCategory[catKey] || [];
      const namedCount = items.filter((i) => DataStore.isItemNameVerified(i.itemKey)).length;
      const flavorCount = items.filter((i) => DataStore.isFlavorTextVerified(i.itemKey)).length;
      const missingThumbCount = (meta.missingDatabaseThumbnails || []).length;
      const missingStatsCount = (meta.missingFromItemDataAsset || []).length;
      return `
        <tr>
          <td style="padding:4px 10px; font-size:12px;">${escapeHtml(meta.label)}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${namedCount}/${meta.count}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${flavorCount}/${meta.count}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${missingThumbCount > 0 ? `<span class="pill unverified">${missingThumbCount}</span>` : "0"}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${missingStatsCount > 0 ? `<span class="pill unverified">${missingStatsCount}</span>` : "0"}</td>
        </tr>
      `;
    }).join("");

    const allItems = DataStore.getAllItemsFlat();
    const totalNamed = allItems.filter((i) => DataStore.isItemNameVerified(i.itemKey)).length;
    const totalFlavor = allItems.filter((i) => DataStore.isFlavorTextVerified(i.itemKey)).length;

    return `
      <div style="margin-top:16px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; margin-bottom:6px;">Per-Category Breakdown (current language)</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--hud-border);">
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Category</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Named</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Has Flavor Text</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Missing Thumbnail</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Missing Stats</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="border-top:1px solid var(--hud-border);">
              <td style="padding:4px 10px; font-size:12px; font-weight:600;">Total</td>
              <td style="padding:4px 10px; font-size:12px; font-weight:600; text-align:right;">${totalNamed}/${allItems.length}</td>
              <td style="padding:4px 10px; font-size:12px; font-weight:600; text-align:right;">${totalFlavor}/${allItems.length}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  },

  renderRecipeCategoryBreakdown() {
    const catCounts = (DataStore.recipeCategoryIndex && DataStore.recipeCategoryIndex.categoryCounts) || null;
    if (!catCounts) return "";

    const rows = Object.keys(catCounts).map((catKey) => {
      const recipes = DataStore.recipesByCategory[catKey] || [];
      const namedCount = recipes.filter((r) => DataStore.isRecipeNameVerified(r.itemKey)).length;
      return `
        <tr>
          <td style="padding:4px 10px; font-size:12px;">${escapeHtml(catKey)}</td>
          <td style="padding:4px 10px; font-size:12px; text-align:right;">${namedCount}/${catCounts[catKey]}</td>
        </tr>
      `;
    }).join("");

    const allRecipes = DataStore.getAllRecipesFlat();
    const totalNamed = allRecipes.filter((r) => DataStore.isRecipeNameVerified(r.itemKey)).length;

    return `
      <div style="margin-top:16px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; margin-bottom:6px;">Per-Category Breakdown (current language)</div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--hud-border);">
              <th style="padding:4px 10px; text-align:left; font-size:11px; color:var(--hud-text-dim);">Category</th>
              <th style="padding:4px 10px; text-align:right; font-size:11px; color:var(--hud-text-dim);">Resolved</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="border-top:1px solid var(--hud-border);">
              <td style="padding:4px 10px; font-size:12px; font-weight:600;">Total</td>
              <td style="padding:4px 10px; font-size:12px; font-weight:600; text-align:right;">${totalNamed}/${allRecipes.length}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  },

  renderDevReference(devRef) {
    if (!devRef) {
      return `
        <div class="hud-panel" style="margin-bottom:16px;">
          <h3>Reverse-Engineering Reference</h3>
          <p style="font-size:13px; color:var(--hud-text-dim);">
            Content/ROD/dev-reference.json failed to load.
          </p>
        </div>
      `;
    }

    const mappingLinks = (devRef.mappingFiles || []).map((m) => {
      const hasDownloadUrl = !!(m.url && m.url.trim());
      return `
        <div class="dev-ref-mapping-row">
          <span class="pill" style="background:rgba(64,207,216,0.15); color:var(--db-cyan-bright);">${escapeHtml(m.label)}</span>
          <span style="font-size:12px; color:var(--hud-text-dim); flex:1;">${escapeHtml(m.description)}</span>
          <span class="pill" id="directVersion-${escapeHtml(m.type)}" style="font-size:11px; opacity:0.6; display:none;"></span>
          <button class="toggle-btn disabled" id="directBtn-${escapeHtml(m.type)}" data-type="${escapeHtml(m.type)}"
                  style="padding:6px 12px; font-size:12px;" title="Checking for a locally-hosted file…" disabled>
            Direct
          </button>
          <a href="${hasDownloadUrl ? m.url : "#"}" target="_blank" rel="noopener"
             class="toggle-btn${hasDownloadUrl ? "" : " disabled"}" style="text-decoration:none; padding:6px 12px; font-size:12px;"
             title="${hasDownloadUrl ? "External link (Discord CDN)" : "No download link set for this file"}">
            Download ↗
          </a>
        </div>
      `;
    }).join("");

    return `
      <div class="hud-panel" style="margin-bottom:16px;">
        <h3>Reverse-Engineering Reference</h3>
        <p style="font-size:13px; color:var(--hud-text-dim); margin-top:0;">
          Kept in <code>Content/ROD/dev-reference.json</code> — a standalone file,
          separate from the rest of the app's data pipeline, so it can be
          updated directly without touching anything else (e.g. when a
          Discord CDN link's signature expires and needs regenerating).
        </p>

        <div style="margin-bottom:14px;">
          <div style="font-family:var(--font-display); font-size:13px; font-weight:600; margin-bottom:6px;">AES Encryption Key</div>
          <div style="display:flex; align-items:center; gap:10px;">
            <code id="aesKeyValue" data-hidden="true" data-full-key="${escapeHtml(devRef.aesEncryptionKey)}"
                  style="flex:1; background:rgba(0,0,0,0.3); border:1px solid var(--hud-border); border-radius:4px; padding:8px 12px; font-family:var(--font-mono); font-size:12px; color:var(--db-cyan-bright); word-break:break-all;">
              ${"•".repeat(20)} (click Reveal to show)
            </code>
            <button class="toggle-btn" id="revealAesKey">Reveal</button>
            <button class="toggle-btn" id="copyAesKey">Copy</button>
          </div>
        </div>

        <div>
          <div style="font-family:var(--font-display); font-size:13px; font-weight:600; margin-bottom:6px;">Mapping Files</div>
          ${mappingLinks}
          <p style="font-size:11px; color:var(--hud-text-dim); opacity:0.7; margin-top:8px; margin-bottom:0;">
            <b>Direct</b> serves whatever's been placed on this server's own <code>mapping-files/</code> folder
            (greyed out when nothing's there yet) — always the latest version documented, no link maintenance
            needed. <b>Download</b> is the manually-set external link below, independent of Direct either way.
            ${escapeHtml(devRef.mappingFiles?.[0]?.url?.includes("ex=") ? "Discord CDN links include expiring signature params — if a download fails, the link needs to be regenerated and pasted back into dev-reference.json." : "")}
          </p>
        </div>

        <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--hud-border); display:flex; gap:8px;">
          <button class="toggle-btn" id="reopenDisclaimerBtn">View Disclaimer</button>
          <button class="toggle-btn" id="openBudgetTrackerBtn">Budget Tracker</button>
        </div>
      </div>
    `;
  },
};
