# TRANSCRIPT.md - ROD Database Toolkit Development History

**Last updated:** 2026-06-28T18:01:47Z

## Purpose

This document records the complete development history of the ROD
Database Toolkit -- every reverse-engineering finding, every design
decision, every bug found and fixed, and the reasoning behind each one.
It exists so that:

1. Anyone picking up this project later (including a future instance of
   the assistant working on it) can see *why* something is built the
   way it is, not just *what* it currently looks like.
2. Claims about the game's data can be traced back to their evidence --
   what's confirmed by the actual data files, what's confirmed by an
   in-game screenshot, what's inferred from a pattern, and what's still
   an open question.
3. Mistakes are preserved, not erased -- several values in this project
   were wrong at one point and got corrected after testing. Knowing
   that history helps catch the *next* mistake faster.

## Summary

Starting from a folder of raw Unreal Engine game-file exports (JSON data
tables, PNG textures) for "Echoes of Aincrad," a Sword Art Online-styled
game, this project built an offline HTML/JS toolkit that:

- Reverse-engineers and validates the game's combat math (ACV stat
  scaling formula, total ATK formula) against empirical reference data
  and in-game screenshots, achieving exact pixel-for-pixel matches.
- Presents a browsable database of all 127 weapons and 70 armor pieces,
  styled to match the game's own "Database" menu and equipment-screen
  UI, including a working ACV/ATK calculator with enhancement levels
  and an EX-MOD slot picker.
- Tracks data confidence transparently: every name, color, and mapping
  is labeled as either confirmed-by-data, confirmed-by-screenshot,
  confirmed-by-official-source, or inferred/guessed -- with the
  reasoning preserved, not just the conclusion.
- Supports ongoing updates as more game data becomes available
  (multi-language localization, new game-version exports) without
  requiring a rebuild from scratch each time.

---

## 1. Initial build: weapon database and ACV/ATK formula

### What was provided
- `ROD_Database_Specification.md` / `ROD_Database_Reference.csv`: an
  earlier planning document (created with ChatGPT) describing the
  expected data structure.
- `EOA-SAO-Weapons-Updated.xlsx`: hand-collected empirical reference
  data -- weapon names, icon associations, ACV values at specific stat
  combinations, and ATK values at enhancement tiers 0-4, gathered by
  the user from the game's Demo build before the raw game files were
  available.
- `EOA-GamefileAndStructure.zip`: the actual raw Unreal Engine export --
  ~180MB of JSON data tables and PNG textures under a `Content/ROD/...`
  path structure.
- Five screenshots of the in-game equipment screen and Database menu,
  used as the visual design reference.

### Key finding: the ACV formula
The most significant reverse-engineering result of the whole project.
By cross-referencing the xlsx's empirical ACV values (e.g. "Bronze Rod
at STR=37 shows ACV=181") against the raw `AbilityScoreDataAsMap` table
(which gives a D/C/B/A/S rank's multiplier at ability-value breakpoints
1/31/61), the formula was reconstructed as:

```
contribution(rank, statValue):
  m0, m1, m2 = AbilityScoreTable[rank] at tiers 1/31/61, each /100
  if statValue <= 30:  floor(statValue * m0)
  if statValue <= 60:  floor(30*m0 + (statValue-30)*m1)
  else:                floor(30*m0 + 30*m1 + (statValue-60)*m2)

ACV = sum of contribution(rank_i, stat_i) for STR, DEX, AGI, INT
```

This was validated against **all 12 empirical test points** in the
xlsx's `ACV_Research` sheet, then independently cross-checked against
two in-game screenshots showing the live ACV breakdown -- Decapitator's
DEX-RankB contribution of 181 at DEX=37, and Steel Knife's DEX-RankD
contribution of "+40" at DEX=37 (where the raw calculation gives 33.5,
confirming the game **floors each stat's contribution individually
before summing**, not after -- a detail that would have been missed
without the screenshot cross-check).

### Key finding: total ATK formula
```
TotalATK = BaseWeaponATK[enhancementTier] + ACV + EX-MOD bonus ATK
```
Validated pixel-for-pixel against three screenshots:
- Decapitator at +0, DEX37, EX-MOD ATK+15 -> 232 (36+181+15)
- Annealed Blade at +4, DEX37, EX-MOD ATK+35 -> 292 (75+182+35)
- Steel Knife at +4, DEX37, no EX-MOD -> 79 (39+40+0)

### Key finding: the real base ATK source
The weapon item's own `WeaponAttack` field is **vestigial/unused** --
the actual base ATK comes from a separate `WeaponEnhancementDataAsMap`
entry's `BaseWeaponATK` array (one value per enhancement tier 0-20).
This was caught by comparing Decapitator's `WeaponAttack: 30` against
the enhancement map's `BaseWeaponATK[0]: 36`, and confirming `36` was
the value actually shown in-game.

### Texture path discovery
The `ThumbnailTexture.AssetPathName` field embedded directly on each
weapon item is **broken** -- every weapon in a category points at the
same placeholder (`IconID: "1"`). Real per-weapon icons exist on disk
following a `{prefix}{id}` naming convention
(`T_Item_Thumbnail_WTS3.png` etc.), confirmed present for all 127
weapons. The app derives texture paths from this convention rather
than trusting the embedded field. One exception found: a single
generic 3D model render exists per weapon *category*, not per item --
used only as a fallback, not presented as a per-item render.

### Initial naming approach (later superseded -- see section 4)
The raw game data has no string table; every item name is a key like
`ItemName_WOS_1`. The xlsx provided human names, matched to game IDs by
cross-referencing rank signature (D/C/B/A/S per stat) + base ATK. This
matching had a **known failure mode**: several weapon pairs share an
*identical* rank+ATK signature (e.g. Bronze Sword and Steel Sword are
both D/B/D/D at ATK 30), so signature alone couldn't disambiguate them.
Where a second piece of evidence existed (the weapon's Unique MOD name
visible in a screenshot, e.g. "Slash Recovery" = `SlashRecovery`), it
was used to break the tie. Where no second piece of evidence existed,
the name was left unset rather than guessed -- tracked in an "ambiguous
name pairs" list surfaced in the Data Coverage report.

**This approach was later proven correct for every weapon it
successfully matched** (zero conflicts once an official source arrived
-- see section 4) but left a few pairs genuinely unresolved, which the
official source then resolved.

---

## 2. Visual design and platform fixes

### SAO-style theme
Built from direct pixel sampling of the provided screenshots: dark
teal/cyan "Database" holographic theme for navigation/browsing, warm
dark "HUD" theme for the equip/stats panels, with specific colors
sampled for HP/Stamina/SP/ATK/ACV/MOD readouts. See DESIGN.md for the
full token table.

### Node/Express server (Dockge deployment fix)
The first delivered package only included a Python `serve.py` script.
When deployed to a Dockge stack configured with `command: [npm, start]`
on a `node:24` image, this had nothing to start -- `npm start` had no
`package.json` to read. Fixed by adding `server.js` (a minimal Express
static file server) and `package.json` with a `start` script, **with
`node_modules` pre-installed directly into the shipped package** so
`npm start` alone works with no `npm install` step -- important since
the Dockge compose only runs that one command.

### UX fixes from first round of user testing
- **Category icons were emoji placeholders.** Replaced with the game's
  actual `T_CategoryIcon_*` (sidebar) and `T_ItemCategoryIcon_W*`
  (weapon type tabs) textures, with a `brightness(0) invert(1)` CSS
  filter applied since the source icons are dark grey line art that's
  invisible against the dark UI background without it.
- **No way to see weapon icons clearly.** Added a zoom lightbox
  (click any icon -> large modal view), plus a dedicated zoom button on
  grid tiles.
- **Enhancement level reset to 0 on every weapon selection.** This was
  a straightforward state-management bug -- fixed by removing the reset
  call, letting `enhancementTier` persist in app state across selections
  the same way ability stats already did.
- **Typing/dragging inputs lost focus after one keystroke/tick.** Root
  cause: every `input` event was triggering a full `innerHTML` rebuild
  of the surrounding panel, destroying the very input element the user
  was mid-interaction with. Fixed by splitting rendering into a
  one-time full render (on weapon selection) and a lightweight
  "patch only the numbers" update function (on every keystroke/slider
  tick) that never touches the DOM nodes the user is actively using.
- **"Item grade" (Class field) was being shown as if it were the same
  thing as "ACV rank."** These are two unrelated fields -- Class is the
  item's overall quality tier (used for refining/enhancement costs);
  ACV rank is per-stat and drives the actual stat-scaling math shown on
  the equip screen. Confirmed distinct by direct evidence: Steel Sword
  is `Class: RankB` but shows ACV ranks D/B/D/D in-game. Fixed by
  labeling both separately everywhere in the UI rather than showing one
  number as "the rank."

---

## 3. Armor, EX-MOD picker, and animation system

### Armor (Upper/Lower/Glove/Shield)
Added a parallel data pipeline for the four armor categories. Key
findings, all confirmed by data absence/presence rather than assumed:
- Armor has **no enhancement system and no EX-MOD slots** anywhere in
  the export -- Def is a single flat value, no scaling arrays exist.
- **Shields specifically have no `Def` field at all** in any of the 12
  shield entries -- the app shows an explicit "no Def field exists"
  message rather than a fake 0.
- Upper/Lower/Glove textures are **gendered** (`_Male`/`_Female` file
  suffix); Shield and weapon textures are not. Added a Male/Female
  toggle for the gendered categories.
- Shield's thumbnail/full-render filename prefix is `S`, but its
  *database*-size thumbnail prefix is `Shield` -- a genuine
  inconsistency in the game's own export between its two icon systems,
  not a bug in this toolkit.
- **Shield-vs-weapon-category compatibility is NOT stated anywhere in
  the data.** The app shows a clearly-labeled inference (Two-Handed
  Sword/Mace/Axe probably can't equip a shield, based on category
  naming convention) rather than presenting a guess as fact.

### EX-MOD picker
Replaced an earlier free-typed "EX-MOD ATK bonus" number input with a
real 4-slot picker sourced from the game's actual `ExtraModificationData`
table (26 distinct modification types, each with a 10-tier value
array). Key findings:
- Only the `BonusATK` type affects the Total ATK calculation; the other
  25 types (Sprint Speed, Stamina Consumption, etc.) are real in-game
  effects but don't feed the ATK formula, shown for reference only.
- The demo build's observed roll range for ATK is tiers 1-4 of the
  10-tier array (values 20/25/30/35), **not tiers 0-4** as first assumed
  -- corrected after re-reading the user's exact wording ("20-35 in
  increments of 5"). This range is applied as a best-guess default to
  all 26 types, but only confirmed for ATK specifically.
- Only 9 of 26 type display labels are confirmed against an actual
  screenshot; the other 17 are inferred from the enum name alone and
  marked with a warning icon in the picker.

### Animation system, first pass
Added a "scan frame" treatment to every equipment icon -- teal scanline
background, angular corner-cut border -- based on a single reference
screenshot showing this on a standalone item icon. **The border color
was initially set to a fixed yellow-green** matching that one
screenshot, not yet understood to be rank-dependent.

### Dev reference panel
Added a standalone `Content/ROD/dev-reference.json` holding an AES
encryption key and two mapping-file download links (USMAP/IDA), with
reveal/copy UI on both the Data Coverage and JSON Inspector pages. Kept
deliberately separate from the rest of the data pipeline so it can be
hand-edited (e.g. when a Discord CDN link's signature expires) without
touching anything else.

---

## 4. Official localization data arrives; naming overhaul

### What was provided
The user located the game's actual localization files -- a ~9570-line
table spanning 13 languages (en, de, es-419, es-ES, fr, id, it, ko,
pt-BR, ru, th, zh-Hans-CN, zh-Hant-TW), of which the English weapon
names and descriptions section was pasted directly into chat (121 named
entries).

### Validation against prior work
Every name previously verified through the rank+ATK-signature-plus-
mod-name method matched this official source **exactly, with zero
conflicts** -- strong external validation of that earlier methodology.
Both previously-unresolved ambiguous pairs (`WMA_6`/`WMA_33` and
`WAX_3`/`WAX_10`) were resolved by the official table: `WMA_6` = "Iron
Hatchet", `WAX_3` = "Annealed Sledgehammer" (confirming the earlier
elimination-based guesses for their siblings, `WMA_33` = "Big Bopper"
and `WAX_10` = "Iron Scythe", were also correct).

### Architecture change: multi-language support
Rebuilt the localization system from a single `en.json` file to a
**per-language file architecture**:
- `Content/ROD/DataAssets/Items/Localization/{lang}.json` -- one file
  per supported language (13 total).
- `_manifest.json` -- lists every supported language, its display
  label, verified/total counts, and whether it has real source data.
- `build_pipeline.py`'s `build_localization()` now loops over a
  `SUPPORTED_LANGUAGES` dict, looking for
  `raw-export/Content/ROD/Localization/weapon_names_{code}.json` per
  language. English is the only one with real data so far; the other
  12 produce full placeholder skeletons (`{itemKey: {name:"", ...}}`)
  ready to populate the moment a source file is dropped in -- no code
  changes needed for additional languages.
- The old xlsx/screenshot-based armor seed table is kept as an
  **English-only fallback**, since the official source so far only
  covers weapons.
- Added a language selector dropdown in the sidebar (next to the
  animation toggle), showing each language's verified count and
  switching `DataStore.localization` live via `DataStore.setLanguage()`.

### Bugs found during this round of user testing

**Armor category icons swapped (Upper <-> Glove).** The original visual
identification of `T_ItemCategoryIcon_A1/A2/A3` (done at small/quick
glance) mistook the torso/collar silhouette (A1) for a glove and the
two-hand-shape icon (A3) for a jacket. Caught by the user testing the
live app. Fixed by re-examining each icon at 3x zoom: A1 is clearly a
torso/collar shape with shoulder pads (Upper), A3 is clearly two
hand/mitt shapes (Glove). A2 (two leg shapes, Lower) was correct from
the start. **Lesson**: visual icon identification at native small size
is unreliable; always zoom in before committing a shape-based mapping.

**Rank border colors wrong for D and A.** The scan-frame border color
was sampled from a single screenshot showing a white/grey border,
assumed to represent RankD, and a gold border assumed to represent
RankA (reusing the existing badge palette). Direct in-game testing by
the user established the *actual* colors: RankD is **green**, RankA is
**purple** -- the white/grey screenshot sample was likely showing a
different UI state entirely (possibly an empty-slot placeholder, not a
real ranked item), not a true RankD border. RankC (blue), RankB (red),
and RankS (gold) were already correct. Fixed both
`animation-config.json`'s `rankBorderColors` and the matching
`--rank-d`/`--rank-a` CSS variables used elsewhere in the UI (rank
chips, badges) for consistency.

**Animation toggle "appeared to do nothing."** Root cause investigation
found the toggle mechanism itself was working correctly (verified: body
class toggles, `display:none` applies, label text updates) -- the actual
issue was that `animation-config.json`'s default `randomizeStart` is
already `true`, so cycling from "Default" to "Randomized" produces
*no visible change*, since both states are the same randomized
behavior in that configuration. This looked like a bug but wasn't one.
Fixed by: relabeling the middle state "Forced Random" (clearer than
"Randomized"), adding a dynamic tooltip explaining exactly which
behavior is currently active and why, and adding a brief color-flash
animation on every click so there's always an immediate, obvious visual
confirmation that the click registered -- even on the visually-identical
transition.

### Loading skeletons
Added `app/js/loading-skeleton.js` with reusable pulsing placeholder
shapes for the weapon/armor grid, detail panel, and stats panel. Wired
into weapon/armor category tab switches (a ~160ms skeleton beat before
the real grid renders) and the language switch (a skeleton during the
actual async fetch of the new language's JSON file) -- deliberately
*not* applied to every keystroke or filter change, to avoid the effect
becoming visual noise.

### Animated database background, full rebuild
The first-pass background was a single static radial gradient. Rebuilt
from four reference screenshots of the in-game Database menu background
into three independent animated layers:
1. Rotating SVG ring arcs (three concentric rings, alternating
   clockwise/counter-clockwise, different speeds) -- identified by
   comparing arc-gap positions across the four reference frames and
   confirming they rotate frame-to-frame.
2. Sliding edge lines (top/bottom, randomized direction/speed/position)
   -- identified by comparing line positions/lengths across frames.
3. Randomly "powering on" monitor-style boxes (point -> line ->
   rectangle, then reverse) -- identified from faint rectangular
   outlines visible at different sizes/positions across frames,
   matching the user's verbal description of a "monitor screen"
   opening/closing effect.

### Documentation
Created this file (TRANSCRIPT.md), DESIGN.md, and rewrote README.md
for accuracy, per explicit request -- to support workspace cleanup
(freeing up upload space for the full localization zip) without losing
the reasoning behind any design or data decision made so far.

---

## 5. Monsters, Items, World > Lore, and Characters/Partners/Customization

Four new top-level database categories were added in sequence, each
becoming the working precedent for the next. The overarching lesson
across all four: **never assume a previous category's localization
wiring, ID scheme, or data shape holds for a new one — check the
actual source file every time.**

### 5.1 Monsters (Beast/Demi-Human/Plant-Insect/Demon, 120 total)
Sourced from `DT_MonsterDatabase.json`. Deliberately thin: confirmed
by direct search that no per-monster combat stats (level/HP/ATK/DEF)
or image/texture reference exist anywhere in this export — monsters
are a live rotating 3D model in-game, not a 2D icon. Coverage is low
(27/120 named); unnamed monsters show their raw EnemyType + numeric ID
with a "Named only" toggle to hide them, mirroring weapons/armor's
existing pattern. Description text resolves against
`ST_DatabaseLocalizeList` (a different table than the name, which uses
`ST_GeneralLocalizeList`) — the first confirmed instance of a category
needing two different string tables for its two fields.

### 5.2 Items (Consumables/Materials/Key Items, 148 total)
Sourced from `DT_ItemDatabase.json` — confirmed to be the in-game
Database menu's OWN list (matching 3 reference screenshots exactly),
cross-referenced with `ItemDataAsset.json` for per-item stats. Two
real exceptions were found and handled honestly rather than smoothed
over: "Hand Mirror" exists in the inventory system but isn't
registered in the Database menu at all (shown anyway, flagged); 5 Key
Items including Teleport Crystal are the OPPOSITE — in the Database
menu but with no stats record anywhere in this export (rank/stack/
buy-sell left blank, flagged, rather than guessed). The second case was
caught only because the list was sourced from the Database menu file
rather than the inventory file — an earlier draft would have silently
dropped exactly the items the user's own reference screenshots showed.
Items also introduced a genuinely two-paragraph description structure
(general effect text + an optional Database-menu-only flavor-text
paragraph, present on 60/148 items, from a different string table than
the main description).

### 5.3 World > Lore (177 total)
Sourced from `DT_WorldViewDatabase.json` — the first SINGLE FLAT LIST
category (no sub-tabs at all; confirmed `SubCategory` is unused on
every row, and the reference screenshots show one flat scrollable
list). Coverage is the best of any category (177/177 named and
described). Also the first category confirmed to use
`ST_GeneralLocalizeList` for BOTH name AND description — checked
directly (zero matching keys in `ST_DatabaseLocalizeList`) rather than
assumed from the monster/item pattern holding here too; it didn't. 40
of 177 entries (a clean ID block, 5001-5040 — confirmed by name to be
written notes/messages, not landmarks) have no thumbnail anywhere;
shown with a placeholder and an honest flag.

A real bug was caught and fixed here: `openIconZoom()` was hardcoded
to resolve display names via the weapon/armor localization map, which
would have silently shown a raw key instead of "Man-Made Goddess
Statues" for Lore specifically (Lore has its own separate localization
namespace). Fixed by adding an optional `resolvedDisplayName` parameter
that callers with their own namespace must pass explicitly — all 6
prior call sites kept working unchanged since they simply don't pass
the new argument. See DESIGN.md §8 for the resulting contract.

### 5.4 Characters / Partners / Customization
`DT_CharacterDatabase.json` (22 total) introduced a FOURTH distinct
localization pattern: the description resolves directly from the row's
top-level `DescriptionKey` field, with no `DatabaseInfo[]` lookup step
at all (that slot is empty on every row here). Coverage is the lowest
of any category (9/22 named). 7 of the 22 are also "Partners" —
confirmed by which codes actually have a dedicated
`DT_Partner_{code}.json` 200-level stat table, not assumed from the
reference screenshots' 7 names alone. The Partners tab got an
interactive level slider built by directly reusing the Weapons section's
enhancement-slider pattern (live in-place DOM patching on `input`,
never a full re-render — see DESIGN.md §8.7).

Character Customization (face parts, voices, 6 color palettes, 21
presets, from `AvatarCustomizeDataAsset.json`) is the first category
with NO name field anywhere at all for any of its data — pure visual
swatches, confirmed for every part type and even the one field
(`LocalizeKey` on voices) that looked like it might resolve to a name
and didn't.

An early version of the Partners weapon-type/skill investigation
concluded no such data existed in the export available at the time —
checked thoroughly (the stat table itself, the shared
`PartnerData.json` fields, `PartnerStatusParameters.json`) before
reaching that conclusion. A LATER content upload included
`DT_PartnerList.json` (explicit `WeaponCategory`/`WeaponID` per
partner, resolved to the real weapon name via the SAME prefix map
weapons/armor already use) and `DT_CombinationSlash.json`/
`DT_SupportSkill.json` (named techniques for 3 of the 7 partners).
The toolkit was updated to reflect the new data once it arrived — the
original conclusion wasn't a mistake, it was accurate for what existed
at the time, and the lesson preserved here is to say so explicitly
rather than letting an old "doesn't exist" claim quietly become wrong
once new data shows up.

---

## 6. Items > Recipes (245 total, 11 categories)

Sourced from 11 separate recipe maps in `ItemDataAsset.json` — NOT in
any in-game Database menu file, confirmed by searching every Database
file before building anything here. Built as its own top-level tab
within `ItemsBrowserView` (Catalog vs. Recipes), since Recipes has a
genuinely different shape (its own 11 sub-categories, materials list,
cost, a produced-item cross-reference) rather than being a 4th flat
category alongside Consumables/Materials/Key Items.

The central technical problem: recipe name/description strings are
dynamic substitution TEMPLATES in the game's own export (e.g.
`"{Rep_ItemName_WOS_1} Blueprint"`), not plain text. A formula-based
shortcut was tried first — deriving the produced item's ID directly
from the recipe's own numeric `ItemId` — validated against 6 samples,
then checked against ALL 245 recipes before being trusted, and found to
be category-specific and unreliable (Upper/Lower/Glove encode the
produced ID as `realId×1000+1`; Shield uses the plain ID with no
encoding; Usable's `ItemId` happens to equal the recipe's own key, not
the produced item's ID at all). The formula was abandoned in favor of
parsing the template string directly every time, which is unambiguous
and substitutes in the produced item's REAL, already-localized name
per language (verified for both English and German, the German case
confirming the substitution happens inside a genuinely different
sentence structure, not just a translated copy of the English result).

Coverage: 236/245 resolve a produced item. The 9 that don't were
checked individually rather than assumed to share one explanation —
6 are recipes for already-known unnamed weapon `*_37` slots, 2
reference armor IDs that don't exist in the armor catalog at all
(`Upper_21`/`Lower_21`), and 1 (`OneHandedSwordRecipe_99`) has no
recipe-name localization key at all even though the weapon it would
produce IS named (`WOS_99`, "Proto-Shortsword") — a genuinely
different kind of gap from the other 8, documented separately rather
than glossed over as the same issue.

A bug was caught and fixed before shipping: the recipe detail panel's
source footnote initially reused the existing `.mod-source-tag` CSS
class, which is scoped to require a `.mod-callout` ancestor (a
display:flex header) — the Recipes panel isn't one, so it would have
rendered with zero styling. Added a dedicated standalone
`.source-footnote` class instead. See DESIGN.md §8.5.

---

## 7. Wwise Audio browser + the source-attribution UI fix

### 7.1 Wwise Audio (4449 events, 30 categories)
A new content upload included `ROD_AvatarAudio.json` (clean Wwise
event references for combat music/movement sounds) and a full
`WwiseAudio/Events/` folder (4449 individual `AkAudioEvent` JSON files
— the actual event catalog those references point to). These don't
fit DT Inspector's DataTable/DataAsset model at all (single tiny
records, no `Rows`/`Properties`), so a dedicated browser was built
instead, organized by the REAL folder structure the Wwise project
already uses (SFX_Enemy, Music_W1/W2/W3, VO, UI, etc.) rather than an
invented categorization. Event names are kept exactly as exported, not
algorithmically shortened, since the full name is what someone modding
audio would search for in the actual game files. Every event's
`.bnk` soundbank path and every physical `.wem` media file is shown,
broken out per language where an event has more than one — confirmed
VO events specifically carry separate physical files per language
(English/Japanese), which matters directly for "find and replace this
voice line."

A real bug was caught and fixed before shipping: the new
`WwiseAudio/Events/` folder was initially being walked by DT
Inspector's own directory scan too (it scans all of `raw-export/`),
flooding its index with 4449 "unrecognized shape" entries. Fixed by
adding `WwiseAudio` to the same directory-exclusion set `Localization`
already used.

### 7.2 The same upload resolved the Partners weapon/skill gap
Digging into `SFX_PartnerSkill` event names (`CombinationSlash`,
`ReversalSlash`) led directly to the `DT_PartnerList.json` /
`DT_CombinationSlash.json` / `DT_SupportSkill.json` files described in
§5.4 above — a good example of one investigation (audio cataloging)
surfacing a real, substantial gameplay-data find that wasn't being
looked for.

### 7.3 Mod callout: key + source attribution
The user asked, while reviewing the weapon preview panel, "where did
the Bonus ATK +3 for Basic Sword Art actually come from?" Tracing this
precisely surfaced the §"23 mods with multiple effect groups" finding
recorded in the Lessons Learned section below. Separately, the
investigation led to a concrete UI fix: every Unique MOD callout now
shows its raw key directly under the translated name (e.g.
`BasicSwordArt` under "Basic Sword Art" — same visual register as
`.preview-itemkey`), plus a small source tag to the right (out of the
main reading flow) showing where the NAME came from and, separately,
where the NUMERIC EFFECTS came from (the literal
`PeculiarModificationData["{key}"]` lookup path, not just a generic
file name). The underlying `source`/`descriptionSource` fields had
been stored on every mod localization entry since it was first built,
but had no getter exposing them until this round. Recipes reuse the
same convention for their own sourcing. See DESIGN.md §8.5 for the
CSS-scoping lesson this surfaced.

---

## 8. A long, instructive debugging session: "I don't see Recipes listed"

After the Recipes tab shipped, the user reported seeing only
Consumables/Materials/Key Items — no "Catalog"/"Recipes" bar above
them at all. This took an unusually long debugging thread to resolve,
and the sequence of wrong turns is worth preserving precisely, since
each one was a reasonable hypothesis that turned out wrong for a
specific, checkable reason:

1. **First hypothesis: a logic bug in `items-browser.js`.** Re-read
   the code repeatedly, traced it by hand, found nothing wrong.
2. **Second hypothesis: a hand-rolled Node DOM mock was lying.** Built
   several increasingly careful fake-DOM test harnesses in Node to
   simulate the render call. Every one of them either passed cleanly
   or threw on an UNRELATED mock limitation (e.g. forgetting to stub
   `addEventListener` on a fake button) — never on anything resembling
   the user's actual symptom. This was a real methodological miss: a
   hand-rolled mock that doesn't auto-parse `innerHTML` into real child
   nodes the way a browser does can pass when the real code is broken,
   or fail when the real code is fine, and several rounds were spent
   trusting it anyway before reaching for `jsdom` (a real DOM
   implementation) instead.
3. **Third hypothesis: browser/server caching.** The user ruled this
   out exhaustively and quickly — incognito window, deleted and
   reloaded, re-copied the zip into the Docker container fresh,
   restarted the container. All before being asked twice to do so,
   which in hindsight should have been a strong signal to stop
   suspecting caching much sooner than it actually stopped being
   suspected.
4. **Fourth hypothesis: a Content-Security-Policy violation in the
   console.** The user did see a real CSP warning about blocked
   `eval`/`new Function` calls — but a direct search confirmed zero
   uses of either anywhere in the shipped `app/` code (they only ever
   existed in Claude's own Node testing scripts, never in application
   code), and the app's `server.js` never sets a CSP header at all.
   This warning was real but unrelated to the symptom — likely from a
   browser extension's own injected script. Worth remembering: a real
   console error is not automatically THE relevant error; check whether
   it could plausibly originate from the page's own code before
   chasing it.
5. **What actually confirmed the real cause**: asking the user to grab
   the literal page HTML directly (via DevTools "Elements" panel,
   later via fetching the raw `.js` file URL directly) rather than
   continuing to reason about what the code SHOULD produce. The raw
   file the user's browser had received was confirmed, byte for byte,
   to be the OLD pre-Recipes version of `items-browser.js` (343-ish
   lines, no `activeMainTab` anywhere) — despite the zip Claude had
   built and independently re-verified (via fresh extraction + `diff`)
   containing the correct, new 603-line file with an identical MD5 to
   the working copy. The deployed file and the packaged file were
   simply different, for reasons outside what Claude could observe
   (something in the user's own copy/extract-to-Docker pipeline).
6. **The fix**: a freshly-built zip under a NEW filename (not a
   re-delivery of the suspect one), with the exact MD5 of the correct
   file stated explicitly so the user could verify it on their own
   host filesystem BEFORE touching Docker again. This worked.

This sequence is preserved in full because the actual lesson isn't
"the bug was X" (there was no bug in the application code at any
point) — it's **get the literal artifact the other system actually
has, as early as possible, rather than spending many rounds proving
your own copy of the code is correct in increasingly rigorous ways.**
Every test Claude ran on its own files was accurate; none of them were
capable of detecting a mismatch between Claude's files and the user's
deployed files, because that mismatch lived entirely outside what
those tests could see.

---

## 9. Disclaimer Modal, a real Coverage page bug, and the Build Dashboard

### 9.1 Disclaimer Modal
A legal/scope disclaimer was added, shown on first load and
re-openable from Data Coverage's Reverse-Engineering Reference
section. Persists "don't show again" via localStorage using the same
safe try/catch pattern the sidebar-collapse preference already used.
Full lifecycle (first-show, dismiss-without-remembering re-shows next
time, dismiss-with-remembering suppresses it, force=true always
overrides) tested against a real DOM engine (jsdom) rather than just
read by eye.

### 9.2 A real, pre-existing Coverage page bug, unrelated to the Disclaimer
The user reported Data Coverage rendering as a completely blank page
and suspected the Disclaimer work caused it. The actual cause was
unrelated and pre-existing: `DataStore.getAllCharactersFlat()` was
called from FOUR places across two files (`coverage-report.js` and
`characters-browser.js` itself) but had never actually been defined in
`data-loader.js` -- confirmed by a `grep` across the whole `app/js/`
tree turning up zero definitions. This means the Characters page
itself had likely been silently broken too, just not yet noticed.
Fixed by adding the missing getter (one line, matching the existing
`getAllLoreFlat`/`getAllTownsFlat` convention exactly), then verified
against REAL data through the actual render path (not a mock) for both
affected pages before considering it resolved. The user's exact
browser console error (`coverage-report.js:185:86`) was the single
most useful piece of information in this whole exchange -- asking for
it directly, rather than continuing to reason about what the code
"should" do, is what actually found the bug.

### 9.3 Build Dashboard
The user described a detailed design: a new section below Data
Coverage showing, per expected raw export, a green-check/red-X for
whether the file exists and a separate "Schema" check for whether it
would actually build; drag-and-drop ZIP upload validated against the
expected folder structure before extracting; the ability to upload
just 1-4 loose JSON files without zipping everything; an
unrecognized-files tray for investigating new content. The user
explicitly clarified this should NOT be a parallel/separate system
from `build_pipeline.py` -- "It's not that we are getting rid of
`build_pipeline.py`... the idea is to give a more thorough method to
upload the necessary files to the portal... The Dashboard should flow
in the same fashion as the pipeline... It shouldn't require rework."

This led to refactoring `main()`'s flat sequence of 23 function calls
into an explicit, ordered `PIPELINE_SECTIONS` list (same calls, same
order, same arguments -- confirmed BYTE-IDENTICAL output across all
5,400+ generated files before and after, both immediately after the
refactor and again after extensive flag/endpoint testing) plus a
`PipelineRunner` that threads context between sections the same way
local variables used to flow through `main()`. New `--only=<key>` /
`--from=<key>` / `--status` CLI flags were added on top of this, all
tested against real dependency chains (including confirming a
sub-range run correctly fails loud, not silently, when a real
prerequisite from an earlier section is missing).

Three new `server.js` endpoints (status, rebuild, upload-zip,
upload-files) shell out to the real pipeline and to the system
`unzip` binary -- no new npm dependency was added (no `multer`; ZIP
bytes are accepted as a raw body via `express.raw()`, loose files as
plain JSON). All three were tested against a REAL running server with
REAL HTTP requests (not just code review), including the actual safety
checks: path-traversal rejection, invalid-JSON rejection, and
ZIP-structure-validation rejection, each confirmed to actually reject
what it claims to reject.

Two real bugs were found and fixed DURING this work, both caught only
by actually running the code, not by reading it:

1. **A status-check `--status` mode bug**: every builder's own
   `print()` calls (progress lines, coverage notes) were writing to
   stdout right alongside the final `json.dumps()` result, corrupting
   the JSON for any caller trying to parse it. Fixed by redirecting
   stdout during the status run and restoring it before printing the
   final report.
2. **A genuinely wrong `rawInputs` entry**: `AbilityScoreTable.json`
   and `ClassTable.json` were listed as raw inputs for the `weapons`
   section, when checking `build_weapons()`'s actual code showed these
   are OUTPUT paths it WRITES, not files it reads (the real input,
   `ClassTableDataAsMap`, is a field already loaded as part of
   `ItemDataAsset.json`). This caused the `weapons` section's Export
   check to fail, which cascaded into every later section depending on
   `all_weapons` failing too, for a reason that had nothing to do with
   those later sections at all. Caught by noticing the cascade pattern
   and tracing it back to its actual root rather than treating each
   failure as independent.
3. **A glob-to-regex bug in the loose-file upload's basename matcher**,
   found through three iterations, each one tested before being
   trusted: the first version converted `*` to `.*` WITHOUT escaping
   the literal `.` already in most patterns (e.g. `*.json`), so a
   completely unrelated test filename incorrectly matched the Wwise
   Audio section's pattern. The first fix attempt escaped in the wrong
   order (tried to find an already-escaped `\*` that was never
   created, which is itself invalid regex syntax some of the time --
   confirmed by the literal "Nothing to repeat" error). The second fix
   correctly escaped everything except `*` first, then substituted the
   bare `*` last -- but this alone still let `*.json` match nearly any
   filename, since a 5-character fixed suffix with no real fixed
   PREFIX is still too generic to safely guess a destination from. The
   final fix requires at least 3 fixed characters BEFORE the first `*`
   in a pattern, which correctly lets `Town_*.json` match `Town_003.json`
   while correctly rejecting an unrelated upload against
   `WwiseAudio/Events/**/*.json`'s effectively-bare `*.json` basename.

A separate investigation during final verification turned out to be a
false alarm worth recording: a stale baseline hash comparison initially
looked like it showed `Content/ROD/DataAssets/Town/DT_TownList.json`
(a legitimate DT-Inspector mirror-copy of the raw file, by design --
see DESIGN.md section 7 on the DT Inspector's "copy every raw datatable
file as-is" behavior) had been corrupted by testing. The file was
deleted twice based on this theory before properly checking: the ACTUAL
difference was just `\r\n` vs `\n` line endings in the raw source file
at different points in this project's history, and `save_json()` always
normalizes to `\n` on write regardless of the source -- there was never
a content difference, let alone a bug. Re-establishing a FRESH
baseline (rather than continuing to compare against a stale one from
much earlier in this session) and confirming true idempotency against
it is what actually resolved this, not the deletions.

---

## 10. Documentation gap, then Characters > Player (build simulator)

**A real gap, recorded rather than silently patched over**: this
document's session log jumps from §9 (Disclaimer Modal / Build
Dashboard) straight to this entry, but the actual shipped toolkit (per
direct inspection of `app/js/views/` at the start of this session) also
already includes a DT Inspector exclusion fix, a BP Inspector, an Asset
Inspector (Materials/Meshes), World > Towns and World > Quests, a UI/UX
pass (mobile drawer breakpoint, list-pane scroll containment, the
`.wl-id` overflow fix), and a `getAllCharactersFlat()` Data Coverage
crash fix — none of which has its own §10/§11/etc. entry here. The
work is real and verified (confirmed by the code itself, by file
counts matching prior session summaries, and by this session's own
`--status` check showing every section passing) — what's missing is
specifically this document being updated at each of those points, not
the work itself. Recorded here honestly rather than backfilling
invented blow-by-blow detail for sessions this instance wasn't present
for.

### What was built this session: Characters > Player

A new 4th tab under Characters — a player-build SIMULATOR (level, stat
allocation, and equipped gear all freely chosen by the user), not a
save-file viewer, since no player save data exists anywhere in any
export checked.

**Data investigation, in order:**
- `DataAssets/Games/InGame/...` (checked first, per the user's own
  lead) turned out to be per-town day/night lighting config, not
  player-stat data — a real, useful finding to rule out, not a wasted
  detour.
- `DataAssets/Parameters/Hero/GrowPointCurve2.json` — a `RODCurveFloat`
  with a pre-baked `IntegerCache` array, one entry per level (0-200).
  Summing entries 0-15 gives exactly 36, matching the user's own
  in-game screenshot ("Lv. 15", "Growth Points: 0/36") precisely. Used
  directly; no interpolation needed.
- `DataAssets/Parameters/Hero/CT_GrowthParam.json` (VIT/END/MND) and
  `HeroStatusParameters.json` (MaxHealth/MaxStamina/MaxSoul/ATK/DEF) —
  two genuinely different curve shapes. The former is hypothesized to
  be keyed by the STAT'S OWN RAW VALUE (not character level, based on
  its 1/30/60/90 tier breakpoints closely mirroring the already-
  confirmed `AbilityScoreTable`'s 1/31/61 ACV tiers) rather than
  asserted as fact from the start. The user's own screenshot then
  independently confirmed this for all three simultaneously: at floor
  stats (VIT=END=MND=1), the curve's Time=1 values (200/200/150) match
  the screenshot's HP 200/200, Stamina 200/200, SP 150/150 exactly.
  This is a stronger confirmation than a single-value match — three
  independent curves agreeing with three independent screenshot values
  at once — though the curve's behavior away from the floor (its
  30/60/90 breakpoints) remains an extrapolation, not independently
  verified, and is labeled as such in both `PlayerConfig.json`'s own
  `_confidence` field and the live UI.
- `SwordSkillPointCurve.json` ("Weapon Proficiency" in the reference
  screenshot) — real curve data exists, but nothing in the export ties
  weapon use to a point rate or confirms it affects ATK. Shipped as an
  honest, purely informational slider, deliberately never wired into
  the ATK calculation.

**Engine reuse, not a new formula**: Total ATK is computed by calling
the EXACT SAME `simulateTotalATK()` function the Weapons section's own
calculator already uses, fed the player's allocated STR/DEX/AGI/INT.
Verified end-to-end: selecting Annealed Blade at +4 with DEX=37 (no
EX-MOD) gives ATK 257 = 75 base + 182 ACV — exactly matching
`acv-engine.js`'s own pre-existing, already-validated docstring example
(which adds a +35 EX-MOD on top to reach the screenshot's 292), proving
the reuse is wired correctly rather than silently diverging.

**Def** is a flat sum of equipped armor's existing `def` field (the
same field the Armor section already shows) — all 12 Shields in this
export have `def: null` (a real, confirmed absence from earlier
session work, not new), so equipping a Shield contributes 0 with an
honest on-screen note, not a silently-wrong 0.

**Visual layout**: deliberately not a literal recreation of the
reference screenshot's circular/radial character sheet (see DESIGN.md
§8.7a for the full reasoning) — restructured into this project's
existing flat `.hud-panel` idiom while preserving the same grouped
information architecture (header → vitals → ATK/DEF → stats →
progression), reusing the already-confirmed-in-game HUD stat colors
(`--hud-hp`/`--hud-stamina`/`--hud-sp`/`--hud-atk-label`) rather than
picking new ones.

**Tested** end-to-end against the real running server (not mocks) via
jsdom: initial floor-stat render matches the screenshot's HP/Stamina/SP
exactly; level-15 Growth Points total matches exactly (36); a real DOM
click on a stat `+` button correctly increments the stat and decrements
the remaining-points counter; the floor decrement button is correctly
disabled at 1; opening the weapon picker renders exactly 127 rows
(every weapon, across all categories) and a real click-to-select
correctly updates both state and the displayed slot name; equipping a
Shield alongside a normal armor piece correctly sums only the
non-null piece and shows the honest null-Shield note.

---

## 11. Build Dashboard: 4-phase overview + downloads

Extended the existing Build Dashboard (built in §9) with a summary
panel at the top of the page and two new download capabilities, per
direct user request rather than a self-initiated addition.

**The 4 phases**, each backed by something already real rather than a
new invented metric:
- **Phase 1 (raw export structure)**: folder-structure check, plus the
  curated `rawInputs` present/missing counts every section already
  computed individually, now aggregated. Also added a genuine
  filesystem walk of `raw-export/Content/ROD/` to find `.json` files
  no section claims at all — a real, useful discovery aid distinct
  from the curated list.
- **Phase 2 (schema)**: counts derived from the same real per-section
  build attempt `get_pipeline_status()` already performed. Fixed
  during this round: a section skipped because its raw input was
  simply missing (`schemaOk is None`) wasn't counted in either the
  valid or invalid bucket — under-reporting real problems. Now counted
  as invalid, since "would fail to run through the pipeline" is true
  either way.
- **Phase 3 (data points generated)**: required adding `expectedOutputs`
  to all 32 `PIPELINE_SECTIONS` entries — extracted programmatically
  by regex-scanning each builder's actual `save_json()` calls, then
  independently verified by checking all 41 resulting paths actually
  exist on disk, rather than trusted from the extraction alone.
- **Phase 4 (live application + per-category counts)**: deliberately
  computed client-side from `DataStore`, not server-side, since this
  view only runs inside the already-loaded app — reading the same
  state the rest of the toolkit displays makes drift between this
  panel and the actual app impossible by construction.

**A real bug caught by distrusting a too-clean result**: the first
version of Phase 1's "unclaimed files" check used a basename-suffix
heuristic to decide if an on-disk file was already claimed by some
section's glob-pattern `rawInputs`. This is the exact same bug class
already fixed once before in the dashboard's upload-side
`guessRelativePath()` (§9) — a pattern like
`.../Equipment/Shield/*.json` has the bare basename `*.json`, which
strips to `.json`, a suffix nearly every JSON file on disk ends with.
The check initially reported `unclaimedJsonFilesOnDisk: 0`, which
looked clean but was wrong — it was silently treating the ~300+
already-documented-as-unsurveyed Town NPC files as claimed. Caught
specifically because that file family was already a named, known open
item elsewhere in this project's own history, making a suspiciously
perfect `0` worth checking against a known answer rather than trusting
at face value. Fixed by replacing the heuristic with real
`glob.glob()` matching (the same mechanism the Export check itself
already uses) — re-verified afterward and found 1184 genuinely
unclaimed files, a much more plausible and honest number.

**Last-build tracking**: added `.last-build-status.json` (project
root), written by `build_pipeline.py`'s own `main()` on every real run
— not only ones triggered through the dashboard — so it stays accurate
for terminal/cron use too. Needed a small but real fix to
`PipelineRunner`: its `results` list was local to `run()`, so after an
exception there was no way for `main()` to know which section had
failed without fragile string-matching against the exception's own
text (which usually doesn't mention the section at all). Fixed by
storing it on `self.last_results` as it's built, verified by
deliberately triggering a missing-prerequisite failure (`--only` on a
section whose dependency wasn't run first) and confirming the correct
section key now shows up, where it previously came back `null`.

**Downloads**: `GET /api/pipeline/download-zip` zips
`raw-export/Content/` via the `zip` CLI (no new dependency, matching
how uploads already shell out to `unzip`) and streams it back as
`Content.zip` — tested end-to-end: valid archive, correct
`Content/ROD/...` internal structure, passes `unzip -t`, and the
server's temp file is confirmed cleaned up after the download
completes. `GET /api/pipeline/download-file?path=...` streams one raw
file individually, with the same `..` path-traversal rejection as the
existing upload-files endpoint — tested for both a successful download
and the traversal-rejection case. Every section's status-grid row now
shows individual download links for its present, literal (non-glob)
raw input files.

---

## 12. Weapons stat-input cap raised, Build Dashboard wording pass

**Weapons ability inputs were capped at 99**, both the `<input
max="99">` attribute and a matching `Math.min(99, v)` JS clamp — an
artifact of the calculator's original design, not anything the
underlying ACV formula actually requires (its third tier, stat value
> 60, is genuinely open-ended: `30*m0 + 30*m1 + (v-60)*m2`, scaling
linearly forever). The Player tab's own Growth Point economy can
already push a stat well past 99 (a level-200 build with every point
in one stat reaches exactly 356 — confirmed directly from
`PlayerConfig.json`'s own `growPointsCumulativeByLevel[200]`, not an
arbitrary guess), so 99 was an inconsistency between two calculators
that should agree, not a real limit. Raised both the attribute and the
clamp to 356, with a `title` tooltip on the input explaining exactly
where that number comes from. Verified via real DOM `input` events:
300 passes through unclamped, 500 correctly clamps to 356, and 356
itself passes through exactly at the boundary.

**Build Dashboard wording pass**, per direct request to simplify and
put more visual weight on the counts themselves: stat labels shortened
to one or two words (`"JSONs identified — present"` → `"Present"`,
`"Missing (expected if everything was uploaded)"` → `"Missing"`), with
the trimmed nuance moved into `title` tooltips rather than dropped —
still available on hover, just not competing with the numbers for
attention. The count numbers themselves grew (22px → 28px, tighter
letter-spacing). The "last build" line switched from a full
`toLocaleString()` timestamp to a compact relative-time format (`"2m
ago"`), verified against a real just-triggered rebuild. The intro
paragraph and upload-zone copy were both trimmed to one line each.

---

## 13. Budget Tracker modal

A second Data Coverage popup, requested by direct example: reuse the
Disclaimer modal's visual language (which the user specifically said
they liked) but for a different purpose — an on-demand estimate of the
professional-team hour/dollar value represented by this toolkit,
rather than a legal/scope acknowledgment.

**Process, not just output**: rather than build straight from the
user's initial framing, the actual content was drafted and presented
in chat FIRST, per explicit request ("before building any additions
what would you put in the Budget Tracker... provide me exact wording
and value"). This produced two real revisions before any code was
written: the user's own supplied numbers (608MB/8,912 files/839
folders, 31 build sizes, a specific $60/hr rate and phase-date
breakdown) were explicitly offered as guidance, not fixed inputs — the
actual hour estimates (1,065 hrs / $63,900 current, +900 hrs /
~$117,900 projected) were derived independently, broken into 5
disciplines (RE/data analysis, backend, frontend, QA, coordination),
and presented for review before building. The user then asked to drop
an "Actual Cost" (AI subscription price) comparison line entirely,
specifically because real money is now being spent on this project and
a side-by-side against a $20/month subscription would undercut the
value being communicated — a legitimate framing request, not a request
to hide or misrepresent anything, since the AI-cost figure was never
inaccurate, just no longer wanted in this specific context. Current
Claude Pro pricing ($20/mo, $17/mo annual) was verified via web search
before drafting, rather than assumed from training data, specifically
because a stale/wrong subscription price would have undermined the
one section of the estimate that didn't need to be an estimate at all.

**Structurally distinct from the Disclaimer it's modeled on**: the
Disclaimer is a one-time acknowledgment gate (deliberately no
backdrop-click or Escape-to-close, since an accidentally-dismissed
disclaimer defeats its own purpose). The Budget Tracker is a
repeatable content viewer, so it deliberately DOES support both
backdrop-click and Escape-to-close (matching the icon-zoom modal's UX
instead), with no persistence at all — every open is a fresh render.
Verified via real DOM events: open/close through the close button,
backdrop click, and Escape key all work; a double-open call is a
no-op; a click INSIDE the box (not the backdrop itself) correctly does
NOT close it; the real Data Coverage page's button genuinely opens the
real modal with the real content, not just the standalone module in
isolation.

---

## 14. Equipment > Sword Skills

A new 3rd Equipment sub-tab, per direct request, alongside context
about 4 adjacent-but-distinct systems (Support Skills, Combination
Slash, Active Skills, Status Ailments) provided specifically to avoid
confusing Sword Skills with them while building.

**Investigation confirmed two of those four already existed**:
Combination Slash and Support Skill were already built under
Characters > Partners (from earlier session work) — an initial grep
search for them came back empty due to a case-sensitivity mismatch in
the search terms, not an actual gap; re-checked with the correct
variable names (`combo`/`support`, not literal
`combinationSlash`/`supportSkill` strings) and confirmed present and
working. Active Skills and Status Ailments genuinely aren't built
anywhere — recorded as known future items, not built this round, per
the user's own framing ("wanted to notate them to not be confused",
not a build request).

**Data, verified in order**: `DT_SwordSkillList_{Category}.json` (one
per `WEAPON_CATEGORIES` key, confirmed by the files' own ID-prefix
convention exactly matching that dict's category order) gives each
skill's `WeaponProficiency` (0-10, a real per-category unlock tier —
confirmed as genuinely separate from the Player tab's own informational
Weapon Proficiency slider, per the user's direct explanation) and
`Decrease_Soul` (SP cost). Names/descriptions resolve from
`SwordSkillName_{id}`/`SwordSkillDescription_{id}` in
`ST_GeneralLocalizeList` — 60/60 coverage, matched 1:1, no orphans.

**A real bug, caught by testing rather than trusting a first pass**:
the initial "real skill vs. unused padding" filter assumed a fixed
numeric range (`*_001` through `*_010` always real, `*_011`+ always
padding). Verifying the actual output against independently-computed
numbers found this wrong for Axe specifically — its real skill set is
`*_001`-`*_005` plus `*_007`-`*_011` (11 rows, not 10), because
`*_006` ("Aftershock") is genuinely real (a confirmed icon exists,
`T_SwordSkill_WAX6.png`) but has no official name anywhere, breaking
the assumed clean range. A second issue surfaced fixing the first:
TwoHandedSword's "Counter" skill (always present at ID `*_000` in
every category) uses the internal codename "NoNameTHS00" — which,
under a purely name-pattern-based filter, would be indistinguishable
from a true placeholder and wrongly excluded. The final rule combines
both signals: ID `*_000` is always included regardless of its internal
name, and every other row is included unless its name starts with
"PlaceHolder" or "NoName". Re-verified against an independently
computed count (67 total, 60 named) before trusting it, matching
exactly.

**A second real bug, in the localization manifest shape**: the first
version of `build_sword_skill_localization()` wrote a manifest with a
custom `{"_languages": {lang: {...}}}` shape that doesn't match every
other category's established flat, `file`-field-bearing structure —
would have silently failed to load in the frontend (missing the `file`
field the JS loader needs to even find the language's data). Caught by
directly reading Lore's actual, real manifest file byte-for-byte
before trusting the shape from memory, and rewritten to match exactly,
including adding proper English-fallback handling the first version
was missing entirely.

**A third round of bugs, in the frontend's CSS class usage**: the list
row's icon used `.gear-slot-icon`, a class only ever styled when
nested under `.player-gear-slot` (from the Player tab) — used here
standalone, it would have rendered completely unstyled. The detail
panel's icon wrapper used a guessed name, `preview-icon-wrap`, instead
of the real, already-established `preview-img-wrap` Weapons/Armor both
use — caught by grepping the actual CSS file for the guessed name and
finding zero matches, rather than assuming a plausible name was
correct.

**Rich-text description rendering**: descriptions carry a small,
CONFIRMED CLOSED set of tags (verified by scanning all 60 official
descriptions for every distinct tag before writing the renderer) —
4 attack-type color tags plus one inline ATK-icon tag. Rendered by
escaping the whole string first, then re-opening only the exact,
already-escaped, already-known tag patterns back into real markup, so
no unexpected source text can ever be interpreted as HTML. The 4
colors reuse existing HUD stat-color variables rather than introducing
new ones. Embedded formula placeholders (`{BaseATK_1}`,
`{ATKModifier_1}%`) are left as literal text — confirmed no numeric
source data resolving them exists anywhere in this export, rather than
fabricated.

**Tested end-to-end against real production data** via jsdom against
the live server: 67 total skills confirmed; 11 rows for
OneHandedSword's category tab (10 named + 1 counter); Sharp Nail's
description correctly renders colored spans, the honest unresolved
`{BaseATK_1}` placeholder, and the ATK-icon replacement; the unnamed
CounterSlashSword and the unnamed-but-real Aftershock both show their
distinct honest-gap messages correctly, with Aftershock's real icon
present and CounterSlashSword's correctly absent; search filtering
works through real DOM input events.

---

## 15. AES key question (declined feature), and versioned mapping-file Direct downloads

**AES key extraction — explained, but not built.** Asked whether the
toolkit could accept an uploaded game executable and compute/extract
its AES decryption key automatically, as a supplement to the existing
static "Reveal"/"Copy" display (which just unmasks an already-known
value someone typed into `dev-reference.json` by hand, during the
human-only research phase — nothing in this codebase computes it).
Explained the general, publicly-known category of technique (the key
has to exist somewhere the running game can reach it, typically a
static byte array in the binary or assembled in memory just before
use, which is why such keys get found via binary/memory analysis and
then shared once known) without providing a working method. Declined
to build the upload-and-compute feature itself: the meaningful
difference from what already exists is that the current key is one
specific, already-vetted value supporting data already reviewed into
this toolkit, while an upload-and-extract feature would be a general
tool any user could point at any copy of the game's executable to
unlock its FULL encrypted asset library — real uplift toward bypassing
the game's content protection, not lessened by being framed as a
"one-time check." The user accepted this distinction directly and
moved on to the second request.

**Versioned mapping-file Direct downloads — built.** A second,
independent button ("Direct") added next to the existing "Download"
button on each Mapping Files row in Data Coverage. Direct serves
whatever's been placed on the server's own filesystem at
`mapping-files/{major:8}/{minor:8}/{patch:8}/{build:8}/{usmap|ida}/`
(zero-padded 8-digit version segments, e.g. version 1.2.4.1's IDA file
at `.../00000001/00000002/00000004/00000001/ida/...`) — greyed out
when nothing's there. Download stays exactly the pre-existing
manually-set Discord link, also now greyed out when blank. The two are
fully independent by design: neither one's presence disables or
replaces the other.

Two server-side helpers do the real work: `listVersionSegments()`
lists only exactly-8-digit numeric subdirectory names (tolerating
stray non-numeric folders without crashing, since this tree is
populated by hand outside the app), and `findLatestMappingFile(type)`
walks version segments from highest to lowest, independently per type,
skipping any version folder that exists but hasn't had a file dropped
into it yet (rather than treating an empty folder as "found" just
because it's the highest-numbered one). Verified against a deliberate
test case with `usmap` at a newer version than `ida` — confirmed each
type's "latest" is found independently rather than both being pinned
to whichever version folder happens to be highest overall. Also
verified: the empty-folder-skip case, the "mapping-files/ doesn't
exist at all" case (the real default state for a fresh deployment,
confirmed to return `null` for both types rather than crash), and path
traversal / invalid-type rejection on the download endpoint.

Frontend: `dev-reference.json`'s `mappingFiles` entries got an explicit
`type` field (`"usmap"`/`"ida"`) added for robust matching against the
backend's type keys, rather than string-matching the display label
(which could break if the label wording ever changed). The Direct
button renders in a disabled "checking…" state synchronously with the
rest of the page, then an async `loadMappingFileStatus()` call patches
it once `/api/mapping-files/status` resolves — deliberately not made
the whole Data Coverage page's own `render()` async just for this one
small, independent feature. Verified end-to-end via jsdom against the
live server: both buttons' initial/resolved states, the version label
patching in correctly, a real click on an enabled Direct button
triggering the right download URL, and the blank-URL Download-button
disabled case, using a directly-modified `DataStore.devReference` to
simulate it rather than editing the shipped file for the test.

No upload UI was built for the mapping-files tree, per direct
specification — these files are placed on the backend filesystem by
whoever manages the server, not through the app.

---

## 16. Fresh-instance bootstrap fix, and mapping-files diagnostics

Two real reports from actually deploying and testing the last round of
work, both traced to their actual root cause rather than patched at
the symptom.

**"Direct" still greyed out after adding files.** Reproduced the
user's EXACT reported folder structure and filenames (including the
literal `+++`/`+` characters in the filename — confirmed real, not a
transcription artifact, by reproducing them directly and getting
correct detection) in this environment. Detection worked correctly.
This strongly points to something environment-specific on the
deployment side (most plausibly a Docker volume/bind-mount not
covering the exact path files were placed at) rather than a bug in the
version-folder-walking logic itself — but rather than leave it at "works
for me," extended `/api/mapping-files/status` with `_scanPath` (the
exact absolute path the running server is scanning) and
`_scanPathExists`, so the user can directly compare "where the server
is looking" against "where the files actually are" in one request,
resolving the ambiguity without more guessing either direction.

**A genuinely more serious bug**: deleting `Content/` and `raw-export/`
to test rebuilding the pipeline from scratch produced `Failed to load
database — Unexpected token '<'... is not valid JSON`, with no way to
even reach Build Dashboard to fix it. Traced this all the way to its
real cause rather than accepting the user's own reasonable-sounding
workaround idea ("ship blank placeholder files") at face value:

- **The actual bug**: `server.js` had a static `app.get("*", ...)`
  fallback route from early in this project, added "in case the app
  grows client-side routes later" — it never did, confirmed there is
  no client-side routing at all. This silently served `index.html`
  for ANY unmatched request, including a genuinely missing data file.
  `fetch()` expecting JSON got an HTML page back instead — exactly
  what produces that specific parse error. This is the actual, fixable
  root cause; blank placeholder files would have papered over it
  without fixing the underlying bug, and would have needed to stay
  perfectly in sync with every file `DataStore.loadAll()` ever expects,
  forever, to keep working.
- **Removed the fallback entirely.** A missing file now correctly
  404s.
- **The remaining real gap**: even with that fixed, a genuinely fresh
  backend legitimately HAS no data, so `DataStore.loadAll()` still
  correctly fails — the app needed to do something sensible with that,
  not just fail more accurately. `App.init()` now catches this
  specific case and enters a "degraded mode": every nav item except
  Build Dashboard gets disabled (reusing the exact `.disabled` class
  already used elsewhere), the user lands directly on Build Dashboard
  with an explanatory banner, and `renderFatalError()` is kept as a
  genuine last-resort safety net for anything actually unexpected
  elsewhere in the same sequence, not removed.

Verified end-to-end against a genuinely empty throwaway copy (code
only, no `Content/`/`raw-export/` at all) — critically, by fetching the
REAL served `index.html` over real HTTP and letting jsdom execute its
REAL `<script>` tags (`runScripts: "dangerously"`), not a hand-assembled
subset of scripts as most of this project's earlier tests used. This
matters here specifically because the bug being verified was in the
real bootstrap sequence itself, not in one isolated view — confirmed:
shell becomes visible, Build Dashboard is the active/rendered route,
11 of 12 nav items are disabled, the banner text is correct, Build
Dashboard's own upload/rebuild UI is genuinely present and usable, and
clicking a disabled nav item does nothing.

---

## 17. Real Content.zip end-to-end testing: three more real bugs found

A direct field report from testing the actual Build Dashboard against
the real, ~330MB Content.zip surfaced several distinct problems at
once. Investigated each to its real root cause rather than accepting
the first plausible-sounding explanation, using the real archive
throughout rather than a small mock (which, twice this round, was
proven to hide the actual bug).

**Bug 1 — WwiseAudio double-nesting.** The prior round's misplaced-
folder merge fix (§16) worked for Localization but produced
`Content/ROD/WwiseAudio/WwiseAudio/Events/...` for WwiseAudio
specifically. Traced through several false leads before finding the
real cause: `path.join(misplacedPath, ".")` was used to build the `cp
-r src/. dst` merge command, but `path.join()` silently normalizes
away a trailing `.` entirely (`path.join("/a/b", ".") === "/a/b"`,
confirmed directly in node) — without that trailing dot, `cp -r src
dst` copies `src` itself as a nested subdirectory of `dst` instead of
merging its contents. The isolated fix (plain string concatenation,
`` `${misplacedPath}/.` ``) was verified correct in a standalone Node
script — but STILL appeared to fail when tested through the actual
running server, with a resulting `WwiseAudio/WwiseAudio` folder whose
file timestamps showed a bizarre multi-minute gap inconsistent with
any single request. This turned out to be a testing-environment
artifact, not a real bug: background server processes started with
`&` don't reliably survive across separate tool invocations in this
environment, so a "genuinely clean" test was actually hitting stale
state from an earlier, incomplete run. Resolved by running start-
server + upload + verify + kill-server as one single atomic shell
command — the fix was correct the entire time.

**Bug 2 — textures never actually copied, ever.** A completely fresh
raw-export → full pipeline rebuild produced ZERO image files anywhere
in the output. Grepping every `.png`-referencing line in the pipeline
confirmed why: every single one only constructs a PATH STRING pointing
at where a texture should be — none of them copy the underlying file.
This means every icon that has EVER appeared correctly in this app,
across this entire project's history, only did so because it had been
copied in manually (via direct `cp` commands during earlier build
rounds), never through the actual automated pipeline. Added a new
`textures` section — first in `PIPELINE_SECTIONS`, since `build_items()`,
`build_lore()`, and `build_sword_skills()` all check texture existence
against the OUTPUT tree to set their own `hasOfficialIcon`-style flags,
and would incorrectly report "no icon" for everything on a fresh build
if this ran after them instead of before. Copies
`DataAssets/Items/Textures/` and `Widget/` wholesale from raw-export
(confirmed as the only two path prefixes any texture string in the
whole file ever constructs). Verified end-to-end: 1875 PNG files now
present after a fresh upload + full rebuild, both a weapon-texture and
a Sword-Skill-icon canary file confirmed present, idempotent across a
second rebuild.

**Bug 3 — `dev-reference.json`/`animation-config.json` never created
if missing.** Both are intentionally, permanently excluded from every
pipeline builder (so hand edits to the AES key, mapping links, or
animation timing persist forever) — but that guarantee also meant
nothing ever CREATED them on a genuinely fresh instance. Added
`ensure_standalone_files_exist()`, called once at the end of a real
build, using the actual current default content (the real AES key,
real mapping-file links, corrected rank colors) for each file ONLY if
it doesn't already exist. Verified the "never touched if it exists"
half specifically, not just "gets created if missing": hand-added a
custom field to `dev-reference.json` after one build, ran a second
real rebuild, and confirmed the custom field survived untouched.

**Also confirmed fixed from the prior round's work, not a new
report**: `/api/pipeline/download-zip` now correctly returns a valid
ZIP with `Content-Type: application/zip` rather than an HTML page —
directly attributable to §16's catch-all-route removal, verified here
against the live server rather than assumed.

All four fixes (WwiseAudio merge, textures, standalone files, plus the
Rebuild button/upload-progress feedback covered next) were verified
together in one final end-to-end pass: fresh instance → real upload →
real full rebuild → 35 sections, zero failures, 1875 textures, both
standalone files present, all 13 languages fully matched for
Lore/Quests/Monsters localization (resolving a separately-reported
symptom that turned out to share the same root cause as Bug 1 above) —
and idempotent across a second rebuild of the same data.

---

## 18. A real production crash, and two more upload bugs

A direct report from an actual running deployment: repeated container
restarts, then a genuine crash log —

```
Error: spawn zip ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:287:19)
...
Node.js v24.15.0
```

— alongside three other symptoms from the same session: sidebar icons
for World/Items/Equipment/Monsters/Characters not showing (weapon
category icons worked fine), WwiseAudio appearing under `raw-export/`
but not `Content/ROD/` after a rebuild, `download-zip` failing with a
browser-level "check internet connection" error, and Localization
files still appearing in "Unrecognized Files" despite the §17 merge
fix. Investigated each independently rather than assuming they shared
one cause.

**The nav icons — genuinely not a bug.** Searched the real
Content.zip three ways before concluding anything: direct filename
search for the exact paths in `index.html`, a broad keyword search
across every PNG in the archive for "World"/"Enemy"/"Character"/
"Equip", and a search of the actual Widget Blueprint JSON data for
real UE asset-path references to a main-menu icon. None of the five
files exist anywhere in the export; the real `WBP_Console_MainMenu`
Blueprint references its own icon as another Widget Blueprint
(`WBP_Console_MainMenu_MenuIcon`), not a flat texture, meaning there
may be no single PNG to extract at all. The user confirmed separately:
their own zip was genuinely missing these files, unrelated to the
pipeline. A real, if longstanding, gap in `index.html` predating this
project's later discipline of verifying every path against real data
— not something this session's fixes touched or broke.

**WwiseAudio "missing" from `Content/ROD/` — also not a bug.**
Confirmed directly: `build_wwise_audio()` was never designed to mirror
raw event files into the output tree at all, only to walk
`raw-export/Content/ROD/WwiseAudio/Events/` and summarize what it
finds into `Content/ROD/DataAssets/_WwiseAudio/{_index.json,
events.json}` — verified this is exactly what a real rebuild produces.
Also `wwise_audio` sits last (or near-last) in `PIPELINE_SECTIONS`,
after the already-slow DT/BP/Asset Inspector sections — checking
mid-rebuild would show this as the last piece still in progress, not
a stall.

**The real crash — root-caused, not just patched.** `zip` wasn't
installed in the reporting deployment's container image. That alone
would just be a missing feature; the actual bug was structural: none
of server.js's five `spawn()` calls had an `'error'` listener on the
returned ChildProcess, and Node's default behavior for an unhandled
`'error'` event on any EventEmitter is to throw — crashing the ENTIRE
server, not just the request that triggered it, which is exactly why
this looked like "the whole app stopped working" rather than "one
button doesn't work." Reproduced this directly rather than trusting
the theory: ran the server with a deliberately restricted `PATH`
excluding `unzip`, confirmed it crashed the same way, then confirmed
the fix (an `'error'` handler that resolves the wrapping Promise
instead) produces a clean HTTP 500 and leaves the server able to serve
completely unrelated requests immediately afterward.

Fixed two different ways, on purpose: every remaining `spawn()` call
now has an `'error'` guard (the minimum fix, needed regardless of
which binary might be missing where), and `download-zip` stopped using
`zip` entirely, replaced with the `archiver` npm package — pure JS, no
external binary, streaming straight into the response instead of a
temp file. This is the first real npm dependency this project has
needed beyond `express`, added specifically because this exact pattern
(a missing system binary + an unguarded spawn) had just been shown to
take the whole app down in an environment this project doesn't
control.

**A bug inside the fix itself, caught before shipping**: `npm install
archiver` pulled v8.0.0 by default — a from-scratch rewrite with a
completely different, class-based ESM API, not the classic callable-
function API (`archiver('zip', options)`) the new code assumed. The
very first real test crashed immediately with `TypeError: archiver is
not a function`. Caught by actually testing the endpoint rather than
trusting a successful `npm install`; fixed by pinning to `archiver@^7`,
the long-stable major version with the documented API.

**"Unrecognized Files" — two bugs stacked, not one.** First: the file
list reported after upload was built from `unzip`'s own log, captured
BEFORE the misplaced-folder merge ran — still showing the pre-merge
path even though the actual file had already moved. Fixed by rewriting
each reported path for every folder the merge actually touched
(driven by the `movedFolders` list itself, not hardcoded names).
Second, deeper problem found once the first was fixed: NOTHING was
actually filtering the reported list against known sections at all —
every extracted file was flagged as "unrecognized" unconditionally.
The loose-file upload path already had real filtering
(`guessRelativePath()`); it was just never reused for ZIP uploads.
Added `isRecognizedRawPath()`, the direct-path counterpart (same
literal + glob matching, same over-broad-glob guard), and wired it in.
Verified against the real archive: 0 Localization files flagged
afterward (was 13), remaining flagged files are genuinely unclaimed
(`CHR/Humans/Heads/...`), confirming the fix distinguishes real gaps
from false positives rather than just emptying the list.

---

## 19. World > Areas (first section of the World expansion), the DA_InGame survey, and a dead-code fix

This session began the planned World expansion (Areas → Dungeons →
Gates, in that order, stopping to package after each). The raw export
grew substantially first: alongside the newest Content.zip (which
itself expanded the DT Inspector's catalog from 1,037 to 1,132
datatables and introduced the still-unclaimed `CHR/` folder), three
sibling archives were merged in for the first time —
**Content-DNG.zip** (dungeon module levels, 1.3 GB), **Content-ENV.zip**
(environment art, 345 MB), and **Content-Maps.zip** (world/persistent
levels, 858 MB), all correctly rooted at `Content/ROD/DNG|ENV|Maps`.
These are intended to be used TOGETHER with Content.zip in production;
during testing the raw export may be periodically wiped and
re-extracted per-archive, which is exactly why the new Areas section
treats them as a soft dependency (below).

### The survey (before any code)

Following the standing rule — check the data fresh, assume nothing
from prior categories — the survey turned up one central, previously
unexamined file: **`DataAssets/Games/InGame/DA_InGame.json`**, a
master gameplay data asset containing:

- **`WorldDatas`** — a per-floor teleport terminal registry: 192
  entries across floor indexes `Dungeon`/`First`/`Second` (70/73/49),
  each with an ID, a localization key, and a world coordinate (122 of
  192 non-zero). IDs split into exactly two families matching two
  separate art sets confirmed under `ENV/Theme/Elven/`: `SA_*`
  (Safe Area terminals, 170) and `WT_*` (Warp Terminals, 22 —
  `WT_TOB`'s display template embeds the Town of Beginnings' AreaTitle
  key; an initial assumption that it literally matched the Towns tab's
  `terminalID` field was checked during the Gates build in §20 and
  found WRONG — towns use a separate `TG_*` ID namespace).
  191/192 resolve to an official name (`WT_Mountaintop`'s key exists
  in no language — the single gap); 168 of the names are `{Rep_}`
  templates.
- **Procedural dungeon generation config** — `Ways` (71), `Rooms`
  (43, incl. boss chambers like `ERU_BOEROE_Boss`), `DungeonThemes`
  (56, with grid sizes / cell counts / elite + monster-house
  population params), and `SafeDungeonSeeds` (36 pre-validated seed
  sets). Reserved for the upcoming Dungeons section, recorded here so
  the next session doesn't re-derive it.

Other survey facts confirmed and recorded: 176 `AreaTitle_*` keys
exist in the official localization with an IDENTICAL key set in all
13 languages (checked per-language, not assumed from en); 17
`DungeonName_*` keys name the game's dungeons across 5 families
(ERU/HFO/HTE/MGK/NTR — matching the DNG/ folder codes);
`DT_InitPopAreaTable_WL01/WL02` genuinely have ZERO rows (recorded so
the future Monster Spawns section doesn't waste time on them — the
populated `DT_CharacterGroupTable`/`DT_SocketPopTable` are the real
candidates); and `DA_MapPiece_PL_WL01/02_WP.json` carries per-terminal
map-reveal piece data keyed by the same terminal IDs.

### "Golden Gates": an open question, deliberately not guessed

The user's planned section list includes Gates AND Golden Gates. The
term "Golden Gate" appears in exactly TWO official strings, both on
item `Usable_74` (an imperfect Healing Crystal: "Recovers 100 HP for
all party members. Can also open Golden Gates." / "…its true value
will only be revealed in front of a Golden Gate."). Nothing in any
file — actor class, asset name, data field — is named GoldenGate,
confirmed by exhaustive search. The user confirmed they don't know
what it refers to either and that it doesn't appear to be in the game
yet; the decision was to NOT build a Golden Gates section now, keep
the identification plan on record (the `SA_*` crystal-activated
safe-area gates are the leading but unconfirmed hypothesis), and let
a future export or in-game confirmation settle it. The Areas view and
Data Coverage both carry this open question verbatim rather than
silently picking an interpretation.

### World > Areas (build)

The first category whose LIST has no data-table source at all: the
official localization key set IS the registry (no `DT_AreaList` or
equivalent exists anywhere — searched, not assumed). `build_areas()`
therefore assembles 179 entries: the 176 official keys plus 3
`*_SA_02` keys referenced by level files' `BP_AreaTitle_Gimmick_Spawner`
actors but present in NO language's table — shown flagged
("unofficial key"), following Items' "Hand Mirror"
referenced-but-missing precedent. Per-area cross-references, each
from a confirmed source:

- **dungeonKey/dungeonCode** — 82 of 176 titles are
  `{Rep_DungeonName_*}` templates; parsed from the EN title, resolved
  per-language in `build_area_localization()` with the exact
  `_resolve_rep_templates` rule Lore/Towns/Quests already share. The
  linked dungeon's own localized name is stored per-language too
  (same convention `build_quest_localization` already uses).
- **terminals** — from `DA_InGame`'s registry, with TWO link kinds
  kept deliberately distinct: `destination` (the gate's own Key IS
  the area) and `nameRef` (the gate's display string embeds the area
  via `{Rep_AreaTitle_X}`). Zero coordinates are passed through as
  `null`, not a fake origin point. 109 of 179 areas link at least one
  gate.
- **spawnerLevels** — a raw-text scan of `Maps/` + `DNG/` `LV_*.json`
  files (1,477 files, ~15s) for spawner actors carrying each key; 26
  areas have placements. This is a SOFT dependency by design: those
  folders ship in separate archives, so the section's `rawInputs`
  deliberately lists only the two hard requirements
  (`DA_InGame.json`, en `Game.json`) — listing the level globs would
  make the dashboard's Export check report a Content.zip-only
  instance as broken when it isn't. `_index.json` records
  `levelScanAvailable` so the app can honestly say "not scanned"
  instead of implying "none exist" (the detail pane shows exactly
  that callout when Maps/DNG were absent at build time).
- **questRefs** — which `QST_`/`DA_QuestAsset_` files mention the key.

No image exists for any area anywhere in the export (the in-game area
title is a spawned banner widget, not a stored texture — searched),
so like Monsters there is no thumbnail handling at all. Areas sort
alphabetically by key — there is no numeric ID and no list file to
take an order FROM.

Front-end: `areas-browser.js` (4th World sub-tab, still the
`main.js` App-level `worldSubTab` pattern) composes Lore's text-only
rows, Towns' cyan level/instance callout, and the standard source
attribution tags; one new toolbar element, a filter `<select>`
(All / Dungeon-linked / No dungeon link / With teleport gates /
Unofficial keys). `data-loader.js` gains the standard
index/list/byKey/localization wiring + getters. Data Coverage gains a
full "Area Coverage" panel (including the Golden Gates open question
and the `WT_Mountaintop` gap). The World nav tooltip was updated
("Lore, Towns, Quests, Areas built; Dungeons and Gates coming
later").

Pipeline: two new sections registered — `areas` (after `quests`,
produces `all_areas`) and `area_loc` (after `quest_loc`, requires
`all_areas`) — 37 sections total, all passing export + schema checks
after a full rebuild against the merged 4-archive export.
`--only=areas` works standalone; `--only=area_loc` alone fails on its
missing prerequisite exactly like `--only=quest_loc` always has
(documented runner behavior, not a new quirk).

### A dead-code bug found and fixed while reading before writing

`build_quest_localization()` contained a full duplicated copy of
`build_wwise_audio()`'s body (~100 lines) after its own final
`print()` — an orphaned block from an earlier refactor that EXECUTED
on every quest-localization build, silently re-walking all 4,449
Wwise event files and re-writing the Wwise index a second time per
full build (and returning `events` from a function whose callers
expect nothing). Verified functionally identical to the real
`build_wwise_audio()` (diff showed only docstring/comment cosmetics)
before deleting it; full rebuild afterward confirmed the Wwise index
is still produced correctly by its real section and quest
localization output is unchanged.

### Build Dashboard Phase 4 correction

Phase 4's live counts had honestly documented that its "Areas" number
was actually Towns (10) — "the closest literal section to that word"
— from before a real Areas section existed. It now reads the real
World > Areas count, and Towns gets its own labeled count alongside
it.

### Standing plan going forward (user-confirmed this session)

Section order: World sub-tabs first (Areas ✔ → Dungeons → Gates),
then Monster sections (Spawns/Drops/Health/Levels), then Asset
Inspector tabs (Skeleton/Animation assets — the unclaimed `CHR/`
folder), then Shops + Chests under Items (note: `DT_ShopItemList.json`
and `DT_FixTBoxTable.json`/`DT_ItemLotTable.json` already exist in
this export), then NPCs/Ailments and similar under Characters. Stop
after EACH section and package new + changed app files for production.
The Content-DNG/ENV/Maps archives merge into the same raw-export and
are used together with Content.zip in production; all generated data
must remain buildable from the Build Dashboard + pipeline alone.


---

## 20. World > Dungeons and World > Gates (World expansion complete for this phase)

Built together in one round (both draw on the same `DA_InGame.json`
survey from §19), completing the Areas → Dungeons → Gates plan.
Four new pipeline sections (`dungeons`, `gates`, `dungeon_loc`,
`gate_loc`) — 41 total, all passing — and two new views as the 5th
and 6th World sub-tabs.

### World > Dungeons

Same registry situation as Areas, confirmed before building: no
dungeon data-table list file exists anywhere — the 17
`DungeonName_*` keys (identical set in all 13 languages, verified
per-language) ARE the list, across 5 families matching the `DNG/`
folder codes. The shared `DUNGEON_CODES` constant and
`_GATE_DUNGEON_PATTERN` regex live at module level so Dungeons and
Gates attribute by the SAME rules. Per dungeon:

- **Gate chain** parsed from the `{WT|SA}_{code}_F{n}{s|e}[_NNNNN]`
  terminal ID pattern — the `_NNNNN` numeric suffixes are instanced
  end-gate variants (the base form exists alongside them). 69 of 192
  gates match a named dungeon; 13/17 dungeons have a chain;
  ERU_OKU / HFO_Ruin / HTE_FI / MGK_Test genuinely have no registered
  gates (shown as such, not as a lookup failure). Exactly one
  dungeon-floor gate matches nothing (`SA_ERU_WAY_BOEROE_01`) and is
  left unattributed.
- **Linked areas** come from `all_areas` (the section is the first to
  `require` another category's produced context), so the Dungeons and
  Areas tabs can never disagree about the template link.
- **Generation config**: the dungeon's slice of `DA_InGame`'s
  DungeonThemes/Ways/Rooms (38/56, 47/71, 31/43 prefix-match a named
  dungeon) and SafeDungeonSeeds (36/36 match) with per-set seed
  counts. Non-matching entries (debug/test/default/common —
  `HSD_Test*`, `DBG_Debug`, `HFO_COMMON_*`, and the `NTR_Twilight_*`
  vs `NTR_TWI` near-miss, a plausible alias deliberately NOT assumed)
  live in the index's `generationUnassigned` bucket, surfaced in Data
  Coverage.
- **Module levels**: DNG/ level files attributed by exact path-token
  match of the dungeon's sub-code within its family folder (1,339
  files scanned this build, 618 attributed, 721 left family-shared
  rather than misattributed — e.g. all of NTR's files stay shared
  because none carry a "Blue"/"Demi"/"Lime"/"TWI" token). Soft
  dependency on Content-DNG.zip, same `dngScanAvailable` honesty flag
  as the Areas level scan.

### World > Gates

Flattens the full 192-gate registry, one row per gate: type
(SA 170 / WT 22), floor, nameKey (both kinds kept distinct —
`TerminalName_*` display strings vs `AreaTitle_*` destination keys,
the latter linking straight into World > Areas), real coordinates
(zeros passed through as null), dungeon attribution, and map-reveal
piece data from `DA_MapPiece_PL_WL01/02_WP.json` (117 of 192 gate IDs
have pieces; the files ship in the core Content.zip but are loaded
defensively). Gate localization is keyed by nameKey, NOT gate ID —
multiple gates share one key (e.g. two gates both keyed
`AreaTitle_BlueDropCaveLowermost`), so keying by the localization key
dedupes naturally (164 distinct keys × 13 languages).

### A wrong assumption caught mid-build (recorded per standing rule)

§19 recorded the working assumption that `WT_TOB` "matches the Towns
section's existing terminal IDs." While wiring the Gates view's town
join, this was CHECKED against the real Towns data and found wrong:
towns' `terminalID` is a separate `TG_*` namespace
(`TG_001` for Town of Beginnings), and no gate ID ever literally
matches it. The real, confirmed tie is the gate's own display-string
template embedding the town's `AreaTitle` key
(`TerminalName_WT_TOB` → `{Rep_AreaTitle_TownofBeginning}`). Fix:
`build_gates` now emits `nameRefAreaKeys` (AreaTitle keys parsed from
the gate's EN template), the view joins `town.nameKey` against that
(plus `destinationAreaKey`), and the §19 wording was corrected
in-place with a pointer here. Verified end-to-end: `WT_TOB` →
`['AreaTitle_TownofBeginning']` → Town 001.

### Front-end + coverage

`dungeons-browser.js` and `gates-browser.js` follow the Areas view's
composition exactly (purple callouts for cross-category links, cyan
for registry/level data, `.pill` mono chips for generation keys,
`<select>` filters — family for Dungeons; floor + SA/WT type for
Gates). Every cross-tab join goes through the same loaded `DataStore`
lists the sibling tabs render from. Data Coverage gained a combined
"Dungeon & Gate Coverage" panel (unassigned generation bucket, the
four gate-less dungeons, the BOEROE oddball, the town-namespace
correction, the `WT_Mountaintop` gap, and the standing Golden Gates
open question). The World nav tooltip now reads "World (Lore, Towns,
Quests, Areas, Dungeons, Gates)".

World's planned first phase is complete. Next per the standing plan:
Monster sections (Spawns/Drops/Health/Levels — starting from
`DT_CharacterGroupTable`/`DT_SocketPopTable`, NOT the confirmed-empty
`DT_InitPopAreaTable_*`), then Asset Inspector tabs for the unclaimed
`CHR/` folder, then Shops + Chests under Items, then NPCs/Ailments
under Characters.

---

## 21. Monsters > Spawns and Drops, why Health/Levels were NOT built, and Focus Builds fixing a real 504

### The survey

The spawn data lives in three populated per-world tables under
`DataAssets/WorldAdmin/` — `DT_SocketPopTable` (pop configs: wave
count/delay ranges), `DT_CharacterGroupLotTable` (weighted lotteries),
`DT_CharacterGroupTable` (compositions) — chained Pop → Lot → Group.
`DT_InitPopAreaTable_WL01/02` (zero rows, recorded in §19) stayed
untouched. The loot data is two global tables: `DT_RewardLotTable`
(242 reward rows, including explicit "None" no-drop entries and
per-`QuestRewardID` sets) chaining into `DT_ItemLotTable` (1,013
weighted item pools — only 104 referenced by rewards; the rest serve
other systems like chests/gathering, foreshadowing those future
sections).

The load-bearing discovery is the **confirmed code link**: enemy
Blueprint classes are `BP_E{6 digits}_C` and the Monster database's
`titleKey` is `EnemyName_{same digits}` — an exact code match, not
name inference. Reward keys reuse the same codes (68 of 242,
sometimes with `_NN` variant suffixes); named keys like `Boar01` and
encounter keys stay deliberately UNLINKED because a name-similarity
guess is exactly that.

### Why "Monster Health" and "Monster Levels" were NOT built (on purpose)

Per-enemy Level/PopNum are `-1` ("inherit/default") in 2,941 of 2,950
WL01 composition slots (3,344 of 3,353 with WL02 counted), and
per-enemy HP/stat/level defaults live in the game's enemy Blueprints
— **this export contains NO `Blueprints/` folder at all** (searched:
the only status parameters anywhere in DataAssets are Hero/Partner
ones). Building those two tabs now would mean fabricating data, so
they were skipped and the finding recorded in Data Coverage instead.
The two genuine level-related curves that DO exist
(`CoefFixedLevelExperiencePointCurve`: XP coefficient 1.0 → 0.5
across the level gap; `EnemyLevelCoefDamageCurve`: flat 1.0 across
levels 1–100 in this snapshot) are exported into the Spawns
`_index.json` for reference. Spawn placement geometry is also mostly
absent from the exported levels (4 `RODInitPopAreaVolume` + 36
`RODSpawnPointsComponent` actors in all of Maps/) — Spawns is the
spawn LOGIC, deliberately not a spawn map.

### The build

Three pipeline sections: `monster_spawns` (Groups/Lots/Pops flattened
per world with REVERSE indexes — which lots roll a group, which pops
roll those lots — so the view walks the chain from any anchor),
`monster_drops` (the first section to `require` TWO other categories'
context: `all_weapons` + `all_armor`, so equipment drop slots resolve
through the data's real `ItemKey` fields with no pattern guessing;
all other categories use the `ItemName_{Cat}_{Id}` pattern, verified
against the EN table first; `Cost`/`Col`/`Invalid` slots — 419 —
resolve to nothing by either route and are shown raw), and
`monster_drop_loc` (161 distinct item keys × 13 languages). Every
percentage anywhere in Drops is a weight-derived share of its own
pool's total, labeled as derived — the tables store weights, not
printed rates.

The Monsters route became a tab-of-tabs (Monsters / Spawns / Drops,
`monstersSubTab` in main.js — the same App-level pattern World uses),
with `MonstersBrowserView` itself untouched. Views join monster names
through a lazy `getMonsterByTitleKey` map over the SAME loaded
Monsters list. Data Coverage gained a "Monster Spawn & Drop Coverage"
panel carrying the Health/Levels finding verbatim.

### Focus Builds (and the 504 they fix)

At 44 sections plus the Maps/DNG level scans, a full pipeline run
grew from "a few seconds" (true when the dashboard was built, and
documented as such in server.js) to several minutes — and the
dashboard's original run-to-completion-in-one-request rebuild
endpoint produced a REAL 504 from a real deployment. Two changes,
both keeping the single full run unchanged:

1. **Focus builds in the pipeline.** A `FOCUS_GROUPS` registry
   (world/monsters/items/equipment/characters/inspectors/audio/
   textures) + `resolve_selection()`, which transitively expands any
   selection with its prerequisite PRODUCER sections via the existing
   requires/produces graph and runs the result in pipeline order via
   the new `PipelineRunner.run_selected()`. Auto-inclusions are
   PRINTED ("Auto-including prerequisite section(s): armor, weapons"),
   never silent. This also upgraded `--only=<key>` — previously it
   failed outright on any section with `requires` (a limitation
   documented since the dashboard was built); now `--only=dungeon_loc`
   auto-runs `areas` → `dungeons` first. "Retaining previous
   calculations" falls out of the pipeline's existing design:
   sections only write their own outputs, so a subset run leaves
   everything else on disk untouched. Verified timings:
   `--group=monsters` 2.6s, `--only=dungeon_loc` 51s (it re-runs the
   Maps/DNG scans inside `areas`), full run minutes.

2. **Background build jobs in the server.** `/api/pipeline/rebuild`
   now starts the run (`python3 -u` for genuinely live output) and
   returns immediately; a concurrent request gets a 409 with the
   running job's id (never two pipelines racing over the same output
   files). New `/api/pipeline/rebuild-progress` serves the captured
   log (capped, newest kept) + running/exit state. The dashboard's
   `triggerRebuild` polls it every ~1.2s into a new live-log panel,
   keeps the elapsed-time button labels, and refreshes status on
   completion. Focus-build buttons render from the `groups` object
   now included in `--status` — the same FOCUS_GROUPS registry the
   CLI runs, per the dashboard's introspect-don't-duplicate
   principle. Verified end-to-end: job start returns instantly,
   concurrent start correctly 409s, progress serves the live log,
   monsters group completes in ~5s through the server.

### One workspace note (not a code bug)

A background full-rebuild launched during this session appeared to
"crash" — in fact the process was lost between sandbox command
sessions and its log was empty due to Python stdout buffering. Rerun
in the foreground with `-u`, the identical build completed cleanly
(EXIT=0, all sections). No pipeline or app code was at fault; the
`-u` lesson made it into the server's job spawner anyway, where it
genuinely matters for live logs.

---

## 22. Cached status checks (fixing the page-load 500), and the background v2 (lens rings + filled boxes)

### The 500, measured

After Focus Builds shipped, the dashboard's page-load status request
started returning 500. Root cause measured, not guessed: `--status`
really runs every section (that's what makes its Schema check honest
— "would building it right now actually succeed, found by really
running it"), and at 44 sections + the Maps/DNG level scans a fresh
status computation now takes **~220 seconds** — the same growth that
504'd the old synchronous rebuild endpoint, hitting the status
endpoint one release later.

### The fix: cached checks + on-demand refresh

The user's requirement drove the design directly: "show the metrics
from whatever the previous run was, without having to run a new fresh
full pipeline build."

- `--status` now stamps its report with `generatedAt`, tags it
  `cached:false`, and SAVES it to `.last-pipeline-status.json`
  (sibling of the existing `.last-build-status.json`).
- New `--status-cached` returns that saved report instantly (tagged
  `cached:true`). On a fresh instance with no cache it does NOT fall
  into the minutes-long fresh path — it returns an instant, honest
  `neverComputed` report (empty sections, null overview, but real
  focus groups, since `resolve_selection` is instant) so the page
  loads fast and SAYS no checks exist yet instead of hanging.
- `/api/pipeline/status` serves `--status-cached` by default; new
  `POST /api/pipeline/refresh-status` runs the real `--status` as a
  background job through the same single-job machinery rebuilds use
  (409 while anything runs), and the pipeline's own cache-save means
  the dashboard just re-fetches cached status when the job exits.
- Dashboard: the 4-phase HUD renders instantly from the cache with a
  "Checks from <timestamp> (cached)" note + a "Re-run checks" button
  (elapsed-time label while running); the neverComputed state gets
  its own explicit panel with a "Run checks now" button. Phase 4's
  live counts were never part of the problem — they were always
  computed client-side from the running app's own DataStore.

### Background v2 (direct user feedback, with two in-game screenshots)

Two changes, edge lines explicitly confirmed good as-is:

1. **Monitor boxes filled.** The open/close animation was right but
   outline-only read as unfinished — boxes now carry a translucent
   vertical-gradient wash (slightly brighter than the page, faint
   inset glow), still fully see-through, matching the game's own
   monitor rectangles. One CSS change; the JS spawner untouched.
2. **Ring arcs → "digital retina" lens.** The three plain concentric
   arc rings "had the general idea but didn't look appealing." Rebuilt
   against the screenshots as: a dark sphere core (radial gradient),
   a soft glow ring (gaussian-blurred wide stroke + crisp 2px edge at
   r=268), and SEVEN broken arc rings (r 340→55, 17 arcs total) with
   deliberately irregular arc lengths and mixed 2-5px stroke widths —
   uniform dashes read as a loading spinner, not a lens. Direction
   alternates per ring (CW/CCW/CW…) and speed rises toward the center
   (110s → 20s), the camera-lens motion from the reference images.
   Hand-placed arc endpoints drifted up to 9px off their radii and
   visibly bowed — every endpoint was programmatically snapped onto
   its circle and re-verified (17/17 within 2px). The
   `prefers-reduced-motion` guard was updated to cover all seven ring
   groups via a single `.bg-rings g` selector.

---

## 23. Characters cluster: NPCs, Active Skills, Ailments (and the roadmap reshuffle)

The user reordered the plan this session: the Asset Inspector tabs
(Skeleton/Animation assets, the `CHR/` folder) move to the END of the
section work, just before the Modding Guide, with new sidecar-download
requirements recorded for when they're built: **psk/fbx/blend** files
downloadable alongside skeleton/mesh JSONs when uploaded to the same
folder paths, **psa/ueanim** alongside animation JSONs, and per-texture
**PNG downloads** for materials/material instances. Next after this
session: Shops and Chests under Items. This session took the "quick
win" cluster — NPCs, Active Skills, Ailments — as three new Characters
tabs (7 total now), each delegating to a fully separate view file from
the existing tab bar (the keep-each-tab-separate reasoning from
DESIGN §8.6, applied to a view whose tabs are internal rather than
App-level).

### NPCs (183)

The ~200-file `DataAssets/Character/NPC/` tree, unsurveyed since it
appeared in the unclaimed tray, has four parts: per-town roster
tables `DT_NPC_001..006` (ID lists ONLY — single-field rows,
confirmed — numbered to match the six towns with detail files, plus a
shared 8-row MoveSpeed table), 114 `NPCData_*` definitions (NameKey,
appearance PartsID, sequences, look-at; folder `009_FacialCheck` is a
debug set), 128 `NPCParts_*` appearance files (Head/HeadGear/Body
skeletal-mesh paths into `CHR/` — a direct forward reference to the
future Skeleton Assets tab — plus one shared AnimData asset), and 65
`NPCAction_*` placed action scripts (move types, gesture animation
montages).

The load-bearing honest finding: **NPC names do not resolve.** Every
NPCData carries a `NPC<id>`-style NameKey, and 0 of 114 exist in ANY
of the 13 languages' tables — generic townsfolk are unnamed in this
export. So NPCs are shown by ID with the raw NameKey labeled
unresolvable, and there is NO npc localization section (nothing to
build — the honest opposite of faking names). The three sources only
partially overlap and the section shows the union with every mismatch
visible: 69 roster IDs with no data file (IDs 4-13 etc.), 102 data
files in no roster (the 9xxx debug set and others), 74 orphan parts
files, and 38 referenced PartsIDs whose files don't exist (the debug
set references parts never exported).

### Active Skills (10)

`DT_ActiveSkillList.json` — §14's deliberately-unbuilt table, now
surfaced at the user's request with the original caveat carried over
(ActiveSkill1's in-game trigger was never confirmed). What it
genuinely carries: ID, soul cost, cooldown seconds, and icons (all 10
`T_ActiveSkill*.png` present). Names (Recovery, Search, …) are
**internal developer strings** — no `ActiveSkillName_*` key family
exists in any language (searched), so no localization builder exists
and the view labels every name "internal". A simple single-table view,
no list/detail split needed at 10 rows.

### Ailments (9)

No status-effect data table or enum exists anywhere in DataAssets —
searched exhaustively; the only `*State*` enum in the entire export
is `EVoiceState`. Mechanics live in unexported Blueprints, the same
situation as monster HP. What the export DOES officially provide: the
tutorial localization pairs (`TutorialTitle_<code>` +
`TutorialDetailwindow_<code>_01`) for exactly nine status effects —
Burn, Blind (Darkness), Fatigue, Freeze (Frost), Instant Death,
Paralysis, Poison, Sleep, Daze (Vertigo) — key parity verified across
all 13 languages, giving official names AND effect descriptions; plus
the general "Status Effects" overview stored under the reserved
`_general` code. The state-icon inventory (9 bad / 9 good / 5 generic
/ up+down arrows) is shown as an unpaired strip: nine bad icons for
nine ailments is a suggestive count match, but NO data maps icon
numbers to ailment codes, so pairing is deliberately not done. The
localized name keeps the FULL official title ("Status Effects: Burn")
— stripping the prefix per-language would mean guessing at 13
languages' separator conventions.

### Pipeline

Four new sections — `npcs`, `active_skills`, `ailments` (after
`player_config`) and `ailment_loc` (after `monster_drop_loc`) — 48
total, all passing a fresh full status run. All four joined the
`characters` focus group, which builds them in seconds. The status
cache from §22 did its job during this session's own development: the
dashboard stays instant while fresh checks run as jobs.

---

## 24. Items > Shops and Chests, and the Cost-token discovery that fixed Drops

### Shops sell recipes (confirmed, not inferred)

`DT_ShopItemList.json` is a single-row table: one "Shop" row carrying
a ShopList of six shops (keys "1".."6"), each a plain stock list —
and every single entry is Category **Cost**. Digging into what Cost
items ARE produced the session's load-bearing discovery: every
`*Recipe*` map in `ItemDataAsset` defines its recipe's purchase token
as `ItemData {Category: Cost, ItemId: N}`, the ids are globally
unique across all recipe maps (59 ids, 0 duplicates), and **all 59
shop stock entries resolve 1:1** to a recipe's real ItemKey. Shops
are recipe vendors. The view joins those keys client-side against the
same loaded Recipes data the Recipes tab renders (names, Col costs,
categories — one source, can't disagree).

Deliberately NOT done: shop→town assignment. Six shops and six towns
(the same 001–006 numbering DT_NPC uses) is a suggestive count match,
but no field links a ShopList key to a town — shops display as
"Shop 1".."Shop 6" with the caveat visible.

### The discovery retroactively fixed Monsters > Drops

Drops originally shipped with 419 item slots resolving to no display
name, 393 of them Cost — which are now known to be recipe purchase
tokens. The pool-resolution logic was extracted from
`build_monster_drops` into a shared `_build_resolved_item_pools()`
(+ `_load_cost_recipe_map()`), upgraded with the Cost branch, and
both Drops and the new Chests section resolve through it — **Drops'
unresolved slots fell 419 → 32** (Col currency amounts, Invalid, and
a handful of armor-recipe keys genuinely absent from the string
tables), and recipe drops now show their real recipe names. Sharing
one resolver also guarantees a pool can never resolve differently
between the two tabs.

### Chests (526)

`DT_FixTBoxTable.json` (the FixTBoxTable `DA_InGame` points at): 526
fixed treasure boxes, each up to five ItemLotTable keys (3 referenced
keys are missing from the table — listed per chest, not hidden). This
is where most of the ~900 pools Drops flagged as
serving-other-systems live. Chest keys are `TB_{location}_{n}`, and
the location fragment is the SAME naming the gate registry uses after
its SA_/WT_ prefix — **522/526 chests match a registered gate's
fragment exactly** (checked before building), so each chest gets real
location context via a client-side join against the loaded Gates
list. No chest placement coordinates exist in the exported levels
(searched) — the gate link is context, deliberately not a map
position.

### Structure

Items became a four-tab view (Catalog / Recipes / Shops / Chests),
the new two delegating to separate view files — the same pattern the
Characters tabs set in §23. Pipeline: `shops`, `chests` (requires
`all_weapons`+`all_armor`, same as Drops) after `recipes`, and
`chest_loc` after `ailment_loc` — 51 sections total; all three joined
the `items` focus group (which now auto-includes weapons/armor and
builds in seconds). Data Coverage gained a Shop & Chest panel
carrying the Cost-token discovery, the Drops fix, the unconfirmed
shop→town mapping, and the 522/526 gate-match stat.

---

## 25. Modding Guides (user content, new section above Data Coverage)

The Asset Inspector expansion is on hold while the user prepares an
11+ GB asset export, so the Modding Guide section moved up. This is
the toolkit's first USER-content feature — deliberately outside the
pipeline (no section builds or overwrites guides): plain Markdown
files in `guides/`, screenshots in `uploads/<guide-id>/`, both under
the statically-served project root, managed by five new `/api/guides`
endpoints in server.js (list+config, get, create, save, delete, plus
image upload). Like the Build Dashboard, it needs the Node server;
the static build shows an explanatory empty state instead of failing
silently.

### Configurable limits (guides/manifest.json)

Auto-created with the requested defaults on first boot, every value a
plain editable number: `maxGuides` 20, `maxImagesPerGuide` 20,
`maxImageSizeMB` 25, `maxGuideFileSizeMB` 10, and `allowEditing`
(default `true` — `false` turns the entire section read-only: no
create/edit/delete/upload, browsing still works, and the UI says the
manifest is why rather than just disabling buttons). The server
merges a hand-edited manifest over the defaults so a missing key
never becomes `undefined`. Limits are enforced server-side (413/409/
403 with the manifest path in the message) AND shown in the UI banner
up front.

### The editor

A themed textarea + Preview toggle (kept deliberately simple per the
request). Screenshots: paste from the clipboard or drag & drop an
image file — the file uploads to that guide's uploads folder
(server-generated names, extension allowlisted, guide id
strict-slug-sanitized since it's a filesystem path component) and a
standard `![screenshot](uploads/<id>/<file>)` line is inserted at the
cursor / drop point, so images appear exactly where they were added.
The Markdown renderer is minimal and escape-first — ALL text is
HTML-escaped before any transform, so guide content can never inject
markup — supporting headings, lists, bold/italic, inline + fenced
code, links, images, blockquotes, and rules. Missing screenshot
files render as dashed placeholder boxes via the image error path.

### Seeded example

`guides/getting-started-installing-unreal-engine.md` — a six-step
Unreal Engine install guide with a screenshot placeholder per step
(the placeholder boxes teach the mechanic: open Edit, delete the
placeholder line, paste the real screenshot in its place). Shipped as
the user's review example before they write their own.

### Verified end-to-end

Create → image upload (returns the relative URL, count enforced) →
save → delete (removes the guide AND its uploads folder) all
round-tripped against the running server; the manifest auto-created
with the defaults; the seeded guide lists with its title parsed from
the first heading.

---

## 26. Guides Init focus build (a real Docker EACCES), and the mobile stacking fix

### Guides Init (user-reported EACCES from a real deployment)

The user's Docker deployment logged repeated unhandled
`EACCES: permission denied` throws from the guide endpoints —
`/home/node/app` was owned by root while node ran unprivileged, so
the lazy server-side folder/file creation failed at REQUEST time with
raw stack traces and bare 500s. Two-part fix, per the user's own
suggestion of a focus build:

1. **`guides_init` pipeline section** (+ `guides` focus group, one
   Build Dashboard button for free): creates `guides/`, `uploads/`,
   `guides/manifest.json` (the default limits), and the seeded
   Getting Started guide (embedded in the pipeline as a constant so a
   fresh instance needs no file to copy from — verified byte-identical
   to the originally shipped file). STRICTLY create-only: re-running
   can never overwrite a user's edited manifest or guide (verified by
   running it twice, then against a scratch state). It's the only
   section whose outputs live at the project root — expectedOutputs
   grew a documented `//` prefix convention resolving against
   PROJECT_ROOT instead of Content/ROD. 52 sections total. If the
   init itself lacks permissions, it fails loudly AT INIT TIME with
   the chown/volume fix in the message — not at a user's first save.
2. **Server hardening**: every guide write path (create/save/delete/
   image upload) now catches filesystem errors and returns a clean
   JSON error; EACCES/EPERM/EROFS specifically name the fix (chown or
   writable volumes for the node user, or run the Modding Guides Init
   focus build in a context that can write).

Also fixed here: the previous session's `guides_init` registration
had broken PIPELINE_SECTIONS with an unclosed dict literal (the
insertion script consumed the previous section's closer) — caught by
`ast.parse` before anything shipped, repaired, and both the guides
group and `--status-cached` re-verified.

### Mobile stacking (user-reported with three phone screenshots)

Sections like Items > Catalog and Equipment > Weapons stacked their
preview under the list on phones; newer sections didn't and were
hard to navigate. Root cause, found in one grep: `.equip-layout` has
always had a `@media (max-width: 1100px) { grid-template-columns:
1fr; }` stacking rule — but 26 views set `grid-template-columns` as
an INLINE style, and inline styles beat stylesheet media queries, so
every view that sized its list pane inline silently opted out of
stacking. The older sections stacked precisely because they never
customized the column width.

Fix: column widths are now CSS custom properties. The base rule reads
`var(--list-col)` / `var(--side-col)`, views set
`class="equip-layout two-col" style="--list-col: 360px;"` (or
`side-right` for the Characters > Player reversed layout), and the
media query re-declares `grid-template-columns` directly — inline
custom properties only FEED the base rule, so the stacking rule now
always wins on small screens. All 22 views with overrides were
converted mechanically and syntax-checked; a bonus rule caps stacked
list panes at 42vh so the preview isn't a long scroll away. No
desktop layout changed: the var defaults reproduce the old widths
exactly.

---

## 27. Asset Inspector: Skeletons & Animations tabs, sidecar downloads, and the Monster Stats unlock

### The exports land (9 zips, ~11,600 new files, a full disk)

Content-ANM/-ANM2/-Blueprints/-Costumes-1/-Costumes-2/-Enemies/
-Humans/-ITM/-NPCs merged into raw-export by MOVE (disk was too tight
to copy: 4.2 GB free, 3.8 GB extracted). Two UI nuances from the
previous round's stacking fix were repaired first: the JSON/DT
Inspectors walked off the right edge (classic grid blowout — a grid
item's default `min-width:auto` let long mono strings widen the 1fr
column past the viewport; fixed with `.equip-layout > * { min-width:
0 }` + `overflow-wrap` on the two detail panes), and the BP/Asset/
Wwise list panes painted over the preview when stacked (their
`.list-pane-self-managed` OUTER box got the 42vh cap while the inner
`.hud-panel` kept its own taller JS max-height — the cap now targets
the inner scroll element for self-managed panes).

Mid-session, the first inspectors rebuild after the merge **filled
the disk to 0 bytes and died**: `build_dt_inspector_index` mirrors
every classified JSON into Content/ROD, and the new asset trees would
have added ~2 GB of duplicated metadata. The DT Inspector now
excludes ANM/CHR/ITM/Blueprints (the Widget-exclusion precedent —
they're the Asset Inspector's domain), the partial mirror was
deleted, and downloads stream from raw-export directly.

### Skeletons tab (494) and Animations tab (5,418)

`asset_skeletons` catalogs SK_ skeletal meshes across CHR/ + ITM/,
grouped with same-folder companions by the user-documented, tree-
verified conventions — `{stem}_Skeleton` (128), `PHYS_{rest}` (174)
AND `{stem}_PhysicsAsset` (26; both conventions are real),
`{stem}_MorphData` (28) — plus SM_ static meshes (17) as their own
kind, discovered when the pskx census (33) didn't match the first
catalog pass (22): 11 pskx live in StaticMesh/ subfolders.
`asset_animations` catalogs the ANM/ tree (+ costume-side sequences
in CHR/), kinds by verified prefix: A_/AS_ AnimSequence (3,030),
AM_ AnimMontage (2,199), BS_ BlendSpace (88), AC_ AnimComposite
(101). 54 sections total; both joined the inspectors focus group, and
the combined `_index.json` carries both summaries.

### Sidecar downloads (zero server changes)

The user's requirement: psk/pskx/uemodel (+ blend when uploaded)
downloadable for meshes/skeletons, psa/ueanim for animations. The
existing `/api/pipeline/download-file` endpoint already serves any
raw-export path with traversal protection, so the tabs just render
`<a download>` buttons per file. Sidecars are detected same-folder
same-stem (417/420 match, verified before building; the 3 orphans are
listed in the index), and ALSO on the `_Skeleton` companion stem.
Every download button states what it is; assets with no sidecar yet
say so instead of hiding the row — blend buttons appear automatically
once files land next to the JSONs.

### The Monster Stats unlock (recorded for the next section)

The new `Blueprints/` tree carries **174 enemy Blueprints** whose
`Default__BP_E{code}_C` objects hold EnemyLevel, AttackPower,
DefencePower, WeaponExperiencePoint, EnemyCharacterID, EnemyType, and
per-difficulty `DifficultyLevelRewardLotKeys` (a CONFIRMED, richer
drops link than the reward-key inference), with each `ParameterTable`
pointing at a per-enemy `CT_E{code}` curve table whose rows —
MaxHealth, MaxStability, AttackPower, DefencePower, ExperiencePoint,
PartyExperiencePoint, WeaponExperiencePoint, Col — are LEVEL CURVES
(Time = level, 1..301). Monster Health/Levels, long recorded as "not
in the export," is now fully buildable and is the next section on the
roadmap.

### Pipeline registration bug, third time

Both this session's section insertions initially broke
PIPELINE_SECTIONS with an unclosed dict (the insertion consumed the
previous section's closer) — the same failure mode as §26's
guides_init insert. Caught by `ast.parse` both times before anything
ran. Lesson reinforced: paste section dicts complete with their own
closers and verify with ast.parse immediately.

---

## 28. World > Map (interactive) and Monsters > Stats (the "inherit" fix)

Two features from one asset drop: a `Content-Map.zip` export plus
three in-game map screenshots as reference, and the earlier
Blueprints export finally getting used for its other purpose.

### Decoding the map coordinate system (verified, not assumed)

`DA_MapPiece_PL_{WL}_WP.json` gives each gate a list of map pieces
with a `PiecePosition` and a `TexturePerPixel` (80). Two hypotheses
for what PiecePosition anchors — corner vs. center — were tested
against real data before committing to either: every DA_InGame
terminal coordinate was checked for containment in a rect built both
ways. Center-anchored rects contained the terminal in every close
case; corner-anchored rects scattered misses across areas that
otherwise looked fine. Screen axis direction (+Y down) was confirmed
against the floor-map widget's own canvas offsets (TOB's high-Y
sits at the bottom, matching its actual southern position). Piece
texture files (`T_MapPiece_{WL}_{location}{letter}.png`) match their
`MapPieceDataDetails` array by index-to-letter order with zero
mismatches across every area that has textures exported (7 of 72 in
WL01 currently — Forest2/Plains1/Plains3/Town).

The terminal registry also incidentally answered an OPEN question
left in World > Gates: the SA_/WT_ prefixes are the game's own
legend — Safe Area and Warp Terminal — confirmed by the reference
screenshots' icon legend, not inferred from naming convention alone.

### `world_map` section and the World > Map tab

New section (55 total) builds `WorldMap.json`: per-area composite
maps (pieces positioned in a shared local coordinate space, bounds
computed from piece extents) with markers for every terminal whose
coordinates fall inside, plus the floor overview's overlay rectangles
read straight from `WBP_Map_FloorMap_WL01`'s CanvasPanelSlot offsets.
Chests attach via the SAME confirmed location-fragment join Items >
Chests already established — listed per area, never pinned, since no
chest coordinate exists anywhere in the export. New view
`world-map-browser.js`: an overview stage (floor image + clickable
overlays) and a per-area stage (composite pieces + pan/zoom via
pointer-drag and wheel-zoom around the cursor) with a click-to-toggle
legend. Layers WITHOUT coordinates in the export — Bosses, Monster
Spawns, Materials, Mission Objectives — render as disabled legend
rows with the specific reason checked directly (DT_SocketPopTable and
DT_NatureItemGroupDataTable carry spawn/gather logic but no
positions; quest files carry map DISPLAY params, not objective
coordinates), rather than being silently omitted.

### Monsters > Stats: resolving "inherit"

The Blueprints export unlocked what Monster Spawns' docstring had
recorded as a genuine absence: `build_monster_stats` (new section,
joined to the `monsters` focus group) reads all 174 enemy
`Default__BP_E{code}_C` objects for EnemyLevel/EnemyType/Attack/
DefencePower/WeaponExperiencePoint and per-difficulty
`DifficultyLevelRewardLotKeys` (spot-checked against
`DT_RewardLotTable` -- e.g. `Mob_Beast_S`, `Sphere_Mob` both resolve),
plus each enemy's own `CT_E{code}` curve table for real level curves
(1-301) on 8 stats. 169 of 174 have a curve; 5 don't and are listed,
not interpolated. New tab Monsters > Stats, new view
`monster-stats-browser.js` with dependency-free inline SVG sparkline
charts (the app has no charting library anywhere else, so none was
introduced for a single view).

Explicitly NOT changed: Monsters > Spawns still shows `-1` as
"inherit" for its own Level field, because that IS what
`DT_CharacterGroupTable` says — the two tables are allowed to
disagree, and Spawns' docstring, UI tooltip, and the corresponding
Data Coverage paragraph were all updated to point at Stats rather
than claim the data doesn't exist anymore.

### Verification

`--group=monsters` and `--group=world` both rebuilt clean (55
sections). Output spot-checked directly: `WorldMap.json` produces 124
areas / 122 terminal coordinates / 26 markers / 8 floor overlays;
`MonsterStats.json` produces 174 entries with the expected curve
shape. A fresh full `--status` run completed clean afterward: 56
sections, all passing.

---

## 29. Known issue logged: World Map piece alignment

User feedback with two screenshots: composite area maps show visible
gaps between adjacent pieces rather than a seamless jigsaw, and one
screenshot's pieces look disconnected in a way the in-game reference
screenshots don't. User's own hypothesis: piece images may need to be
centered ON their PiecePosition for the CSS box itself, rather than
the current top-left-corner placement math. Recorded for a future
session rather than debugged now, per explicit direction to move to
the API work first. Worth re-checking when returned to: the session
28 center-vs-corner test only validated that TERMINAL points fall
inside a piece's rect under a center-anchored hypothesis -- it never
validated PIECE-TO-PIECE adjacency/tiling, which is a different
property and could fail even with the anchor point itself correct
(e.g. if pieces are meant to overlap by a fixed margin, or if a
piece's image itself isn't centered on its own texture bounds the way
`px/2` assumes).

## 30. Read-only REST API layer (`/api`) + APIRouting.md

Built exactly as scoped, as two deliberately separate pieces from the
existing toolkit:

**`tools/build_api.py`** (standalone script, NOT a `PIPELINE_SECTIONS`
entry): reads already-built `Content/ROD/` files and reshapes them
into the requested folder layout --
`api/{items,monsters,datatables,structs,functions,localization,skills,tutorials}/`.
Two folders required an honest reshape rather than a literal match to
the originally-sketched example names: **structs/** indexes DataTable
row FIELD SIGNATURES (this UnrealPak JSON export carries no standalone
struct header definitions, so "struct" here means "distinct field
list", grouped by which tables share one -- inventing a named
`FWeaponData.json` that appears nowhere in the source would misrepresent
it); **functions/** only covers Widget Blueprints, which the BP
Inspector already catalogs with real function lists -- gameplay
Blueprints (`BP_E001001` etc.) are `Default__*_C` property data in this
export, not decompiled function graphs, so they're excluded rather
than listed with a fake empty function array. Verified end to end: ran
the script against the current build, spot-checked every output file.

**`api/routes.js`** (standalone Express router, mounted with exactly
one line in `server.js`): implements every endpoint from the original
list plus the collection/search routes needed to support them, GET-only,
consistent `{ data, meta }` / `{ error: { code, message } }` envelopes,
200-with-empty-data (never a crash) when `api/` hasn't been generated.
All 16 route groups tested live against a running server, including a
bug catch-and-fix: `/api/monster/:id`'s Blueprint-stat enrichment
initially assumed a nonexistent `enemyCode` field on monster records;
fixed to derive the code from the confirmed `titleKey` pattern
(`EnemyName_{6 digits}` -> `E{6 digits}`) before shipping, re-verified
live afterward. Confirmed the mount doesn't shadow the existing
`/api/pipeline/*` and `/api/guides/*` routes (Express matches in
registration order; those are declared earlier in `server.js`).

**`APIRouting.md`**: full endpoint spec, the response/error envelope,
stated limitations (search is plain substring matching, no ranking;
no pagination yet; stat enrichment can be null), and a Roadmap table
mapping every one of the requested future "executions"
(`search_datatable()`, `generate_lua()`, `package_mod()`, the
Blender-side operations, etc.) to either an existing endpoint or an
explicitly out-of-scope future execution runner -- generation/
authoring/Blender operations are deliberately NOT part of this
read-only layer.

---

## 31. World Map: the real root cause found (piece-ordering bug), plus real masks and icons

The first seam-risk pass (this section, originally) treated the
visual misalignment as purely a thin-overlap/no-blend-mask issue and
shipped a seam-risk indicator plus a synthetic CSS feather. The user
then sent a THIRD round of screenshots showing a "low seam risk" area
(57% minimum overlap -- should have composited cleanly) still visibly
wrong, which meant that diagnosis was incomplete. Investigated from
scratch again rather than patched further:

**The actual bug**: `MapPieceDataDetails`' array order does NOT match
alphabetical piece-letter order. Confirmed directly by reading a raw
entry: `SA_Plains1_1_01`'s array is `[c, a, b]`, not `[a, b, c]`. A
census across all 7 currently-textured areas found EVERY SINGLE ONE
had non-alphabetical order (`[a,c,b]`, `[b,a]`, `[c,b,a,...]`, etc.).
`build_world_map`'s original piece-loading loop constructed each
piece's filename from its ARRAY INDEX
(`chr(ord("a") + i)`) rather than reading the real filename the entry
itself names -- silently pairing every `PiecePosition` with the WRONG
texture whenever a gate's array wasn't already alphabetical. This is
the actual, full explanation for "chunks positioned wrong relative to
each other": the positions were right, but the images drawn at those
positions were shuffled.

**Fix**: read `PieceTexture.AssetPathName` directly from each entry
instead of reconstructing a filename from array position. Verified:
re-fetched `SA_Plains1_1_01` post-fix and confirmed the mask/texture
pairing is now self-consistent (previously mask "c" was attached to
texture "a", etc. -- a visible symptom of the same underlying bug,
since mask resolution was already correctly tied to its own `det`
object and only the texture lookup was wrong). Rendered the corrected
composite locally (PIL) and visually confirmed a single, connected,
sensibly-shaped landmass matching the reference screenshot's overall
topology.

**Bonus discovery while investigating**: this session's asset re-drop
finally included non-empty `PieceMaskMaterial` data (empty for every
area checked in the earlier round) -- real per-piece mask PNGs
(`T_MapPiece_Mask_*`) exist for all 7 textured areas now.
Investigated the mask's actual pixel encoding rather than guessing:
its alpha channel is flat 255 (not itself a mask), and the real
per-pixel crop information lives in the R/G color channels, which
trace a boundary-curve shape (visually a coastline-like line) rather
than a broad gradient -- almost certainly a directional cut line, one
channel per neighboring piece. No shader graph is exported for
`M_MapPiece_Mask`, so the exact R/G combination formula can't be
recovered with certainty from JSON metadata alone -- stated honestly
in both code comments and Data Coverage rather than presented as
pixel-exact. Applied via a standard CSS luminance `mask-image`, which
blends R/G/B by perceptual weighting -- a defensible, real-data
improvement over the earlier synthetic radial-gradient feather it
replaces, skipped for genuinely thin-overlap ("high seam risk") areas
for the same reasoning as before (eroding an edge with little real
neighbor coverage would shrink content, not help it).

Also found: `Widget/3DMapCapture/MapIcon/IconImages` -- real,
correctly COLORED map icon PNGs (Safe Area, Warp Terminal/Teleport
Gate, Treasure/Chest, Boss Enemy, Enemy, Item, Other Gimmick), unlike
the white mask-tint textures under Cockpit/Minimap that were
previously assumed to be the only (unusable without a tint pipeline)
icon source. Wired into `WorldMap.json` as a small `icons` registry
built via file-existence checks (same honesty pattern as every other
asset-presence flag in this codebase), and into the view: real icons
now render for Safe Area / Warp Terminal markers and for every legend
row (including the disabled ones -- Bosses/Spawns/Materials/
Objectives now show their real in-game icon even though they have no
plottable coordinates), replacing the placeholder Unicode glyphs.

**What remains open**: genuine thin piece-to-piece overlap (a
property of how sparsely some areas' pieces were authored, unrelated
to the ordering bug) still means a real seam or gap can show in
"high" seamRisk areas -- `seamRisk`/`minPieceOverlapFraction` still
computed and surfaced honestly for that case, now on top of correct
texture-position pairing rather than compounding with it. If exact
per-pixel mask correctness matters later, the `M_MapPiece_Mask`
material's actual shader graph (not exported in this JSON format)
would be needed to confirm the true R/G combination rule.


---

## 32. World Map legend/color/mode expansion, and the AI Skill deliverable

### Icon color discovery and recoloring pipeline

Direct pixel sampling of `Widget/3DMapCapture/MapIcon/IconImages/*.png`
confirmed the user's hypothesis exactly: every icon's opaque pixels
are pure red (255,0,0) for the main shape and pure green (0,166,0-ish)
for a secondary shape -- unrecolored mask sprites meant for the game's
own UI material to tint at runtime, not final art. New
`build_map_icons()` (52 -> 58 sections with this and the two map
sections below) does real image processing with PIL: green pixels
become a soft, offset (4px down-right), Gaussian-blurred, semi-
transparent black drop shadow (the "make it look more 3D" request);
red pixels become a flat fill in the color explicitly given this
session -- white, stated as UNCONFIRMED rather than guessed, for the
four layers (Bosses, Monster Spawns, Materials, Mission Objectives)
with no assigned color. `MAP_ICON_COLORS` records both the color and
a `confirmed` boolean per icon key, which the `_index.json` reports
by count so the distinction is visible, not just in a comment.

### Legend expansion (4 -> 12 layers) and the town-shop colors

Legend now covers every layer the user listed: Safe Areas, Warp
Terminals, Treasure Chests, Waypoints, Arks, Seals, Magical Seals,
Side Quest Trinkets, Bosses, Monster Spawns, Materials, Mission
Objectives -- plus three town-specific icons (Smithy green, Chest
teal, Item Seller orange) resolved for a future Towns marker feature.
Icon-to-name mapping used the icon files' own names as the strongest
signal (`T_Mapicon_KeyArc` = Ark, `T_Mapicon_AmuletSeal` = Magical
Seal vs `T_Mapicon_Seal` = Seal, `T_Mapicon_Pin` = Waypoint,
`T_Mapicon_SubQuestNPC_Order` = Side Quest Trinket, `T_Mapicon_Treasure`
vs `T_Mapicon_Chest` distinguishing field chests from town shop
chests) -- a reasonable inference from filenames, not independently
confirmed by a data field, and left implicit rather than over-claimed.

### Waypoints: drag-from-legend pins

Implemented via native HTML5 drag-and-drop: the Waypoints legend row
is `draggable`, `dragstart` sets a marker payload, the map viewport
handles `drop` and converts the drop's pixel position back to world
coordinates using the same bounds/tpp math every other marker uses,
so a pin's position is consistent with everything else on the map.
Explicitly session-only (kept in `state.waypoints`, keyed per area/
world) -- no backend exists to persist them, and the UI says so
rather than silently losing pins on refresh without explanation.

### World View: the multi-area composite

The user asked whether there's "enough information" to line up
multiple areas' chunks like the big map. There was: every piece
already carries real, absolute world-space coordinates (verified
repeatedly this session), so plotting ALL textured areas' pieces on
ONE shared canvas needed zero new data -- just wider bounds computed
across every area in a world instead of one area's own. New
`worldComposites` field in `WorldMap.json`, new "World View" tab in
the view, sharing every rendering helper (`drawPieces`, `drawMarkers`,
`setupLegend`, pan/zoom) with the per-area Field Map view via a
refactor into shared methods rather than duplicated code.

### Towns and Dungeons: a different, simpler asset entirely

User-reported "missing" town/dungeon maps turned out to be a
different asset shape, not an omission: `Widget/MapTexture/TownMap/`
and `.../DungeonFloorMap/` hold single, already-composited images
(2048x2048 for the one exported town; 512x256 down to 64x32 for
dungeon floors) -- no piece math applies. New `build_static_maps()`
+ `StaticMaps.json` + two new view modes browse them as reference
images, with an explicit, unhidden limitation: no coordinate data
anywhere in the export is confirmed scaled to these images' own local
space, so no marker overlay is attempted (a fabricated pin position
would be worse than none). Dungeon floor suffixes (HTE1, NTR2, ...)
are NOT confirmed to map onto one specific same-prefix dungeon in
World > Dungeons (several dungeons share a 3-letter prefix) and are
labeled by their raw exported name rather than guessed.

### AI Skill: a downloadable Claude Skill package

Built a real Claude Skill (SKILL.md + scripts/ + references/,
following the skill-creator reference format) wrapping the toolkit's
own `/api` layer for use in Claude Cowork or any Skill-aware Claude
surface. Key design decisions, all direct answers to the request:
  - **Two different things, kept explicitly separate** in the skill's
    own instructions: the game's official site
    (bandainamcoent.com/games/echoes-of-aincrad) is NOT the toolkit,
    which is self-hosted per-instance with no fixed address -- the
    skill asks for a base URL in chat before doing anything.
  - **Connection testing**: `scripts/test_connection.py` hits
    `GET /api`, reports the schema version and live endpoint list, and
    fails loudly (never fabricates success) on network/DNS/non-JSON
    errors.
  - **Forward-compatible with new endpoints**: the skill is instructed
    to re-fetch `GET /api`'s own endpoint list before anything non-
    trivial and treat anything new it finds as usable (same REST
    shape as everything else), rather than being frozen to the
    endpoint list documented at the time it was built.
  - **api_client.py**: thin, dependency-free (stdlib `urllib` only)
    shortcuts for every documented endpoint plus a raw `get` escape
    hatch. Verified end-to-end against the actual running toolkit
    server this session: `discover`, `monster` (with Blueprint-stat
    enrichment), `search`, and a genuine 404 case (exit code 1,
    correct error envelope) all round-tripped successfully.
  - **Packaging**: validated and packaged with the skill-creator
    reference's own `package_skill.py` -- caught and fixed two real
    YAML frontmatter bugs along the way (a bare colon inside the
    unquoted `description` scalar breaks YAML mapping parsing; fixed
    by rephrasing rather than colons, twice, since the first fix left
    one colon remaining) and one description-length overage (trimmed
    under the 1024-char limit while keeping every trigger phrase).
  - Named `rod-eoa-toolkit`, shipped as
    `skill-downloads/ROD-EOA-Toolkit.skill` (a plain zip), verified
    downloadable through the running server at
    `/skill-downloads/ROD-EOA-Toolkit.skill` with the correct 4-file
    contents.

New **AI Skill** button in Data Coverage, matching the existing View
Disclaimer / Budget Tracker modal pattern exactly (same overlay
classes, same backdrop-click/Escape-to-close behavior, no persistence)
-- `ai-skill-modal.js` explains the game-vs-toolkit distinction, what's
in the package, and the Cowork load-in steps, with a download button
linking straight to the packaged `.skill` file.

---

## 33. Real-deployment crash: PIL/numpy missing, and the fix

User ran the "world" (or a group including map_icons) focus build on
their actual Docker deployment and hit a hard crash:
`ModuleNotFoundError: No module named 'PIL'`, which took down the
ENTIRE focus-group run -- including `armor`, `chests`, `weapons`,
sections with nothing to do with map icons, because they'd already
been auto-included as prerequisites by the time `map_icons`' builder
raised. This repo has no `requirements.txt` or `Dockerfile` of its
own, and my own sandbox happened to have Pillow/numpy preinstalled,
so this never surfaced until a real deployment without them hit it.

**Fix**: `build_map_icons()`'s `from PIL import ...` now sits behind a
try/except. On `ImportError`, it prints an actionable install command
(`pip install Pillow numpy --break-system-packages`), writes an EMPTY
`_index.json` (so `build_world_map`'s existence-check icon lookup
correctly resolves to "no icons available" rather than a missing or
half-written file), and returns cleanly instead of raising -- the
whole focus group now completes normally around it.

**Verified three ways**, not just read-through: (1) `sys.modules['PIL']
= None` + `sys.modules['numpy'] = None` (the correct way to force a
real `ImportError` in-process, unlike a meta_path finder which doesn't
reliably intercept already-resolvable stdlib-style imports) then
called `build_map_icons()` directly -- confirmed it returns `{}` and
writes the empty index without raising; (2) ran the FULL `world` focus
group under the same blocked-import condition end to end -- completed
normally, no crash, `map_icons` was the only section that skipped
work; (3) deleted the previously-generated icon PNGs first (to rule
out the check silently passing only because leftover files from an
earlier real run were still on disk) and re-ran `map_icons` +
`world_map` together under the blocked condition -- `WorldMap.json`'s
`icons` field came back `{}` on a genuinely icon-less, PIL-less run,
which the view already renders as text/symbol fallback markers
(that fallback path was already coded in `markerVisual`/`legendRows`/
`legendIconHtml`, just never exercised until now). Icons were then
restored with a normal `--group=textures` run with Pillow actually
present.

Added `requirements.txt` at the project root documenting Pillow/numpy
as OPTIONAL (the core pipeline needs zero installs; only
`map_icons` benefits from them), with the exact install command and
what happens if they're skipped.

---

## 34. Map icons "messed up again": padding/shadow tuning, and a distortion bug it exposed

User feedback after the color pass: icons on the map looked wrong
again. Investigated by measuring the composited PNGs directly rather
than guessing from a description -- the earlier version's shadow
offset (4px) and canvas padding (+6px) were tuned for a large preview
render, and at the actual marker size the map uses (26-28px), the
content only filled 67-71% of its own canvas, concentrated toward the
bottom-right (the shadow's offset direction) -- confirmed by measuring
each icon's opaque-pixel bounding box against its canvas size. At a
28px render, that reads as a shrunken, off-center blob, not a crisp
icon.

**Fix**: reduced the shadow offset (4px -> 2px) and blur radius
(2.2 -> 1.1) for something appropriate at small render sizes, and
added a tight crop to each composited icon's own alpha bounding box
(2px uniform margin) so the exported PNG is mostly icon, not empty
padding. Verified numerically before and after: bounding boxes now
touch within 2px of every edge on every icon checked.

**A second, related bug the crop exposed**: cropping to content
bounding box makes each icon's canvas a DIFFERENT aspect ratio
depending on its shape (an Ark glyph crops to 39x50, a Magical Seal to
52x52, etc.) -- but two of the three places markers render these
icons set BOTH `width` and `height` to the same fixed pixel value with
no `object-fit`, which would STRETCH/SKEW a non-square crop into a
square box. The legend's own icon rendering already had
`object-fit:contain` (added the very first time this feature was
built, before crops made it strictly necessary); the two marker-icon
render paths (`markerVisual`'s Safe Area/Warp Terminal icons and the
Waypoint pin icon) did not, and now do.

Rebuilt the `world` focus group and reran a fresh full `--status`
check after both fixes; all sections still pass.

---

## 35. Full icon catalog (26) + manual map markers for Towns/Dungeons

User feedback approved the World View / Field Map / Towns / Dungeons
structure and gave a complete icon list, confirming the red/green
mask-sprite theory from section 32 generalizes to every icon in the
folder. Also asked for a manual entry system (pick a pin, enter X/Y
scalers, submit, stored per area up to 999 entries) -- precisely what
Towns and Dungeons need, since neither has ANY exported coordinate
data.

### Icon catalog: 15 -> 26

Added Town, Dungeon Entrance, Search Terminal, Door, Elite Monster,
Player, and 6 Waypoint pin graphics (the classic pin + 5
"InstantPin_*" skins, all confirmed yellow -- same family as the
original Waypoint color, offered as different pin GRAPHICS a manual
entry can choose between, not different meanings) to
`MAP_ICON_COLORS`. Verified all 25 requested source files exist
before touching the registry. One correction along the way: an
earlier session's Side Quest Trinket mapping pointed at
`T_Mapicon_SubQuestNPC_Order`; corrected to `T_Mapicon_SubQuest` per
this session's explicit list.

**A real bug caught by cross-checking output, not just code review**:
after rebuilding, `WorldMap.json`'s `icons` registry still showed
only 15 keys, not 26. `build_world_map()` had its OWN hardcoded
`icon_keys` list, separately maintained from `MAP_ICON_COLORS`, never
updated when the catalog grew -- a classic duplicated-source-of-truth
bug. Fixed by having `build_world_map` iterate `MAP_ICON_COLORS`
directly instead of a second list; re-verified 26/26 keys present
afterward.

### Manual map markers (new user-content system)

Mirrors Modding Guides' own outside-the-pipeline pattern: new
`server.js` endpoints (`GET/POST/DELETE /api/map-markers/:mapType/
:areaKey`, mapType one of field/world/town/dungeon) store one JSON
manifest per map surface under `map-markers/*.json` at the project
root -- never touched by `build_pipeline.py`. Entries are `{id,
iconKey, x, y, label, createdAt}` with x/y NORMALIZED 0.0-1.0 against
that surface's own canvas -- deliberately not world coordinates, so
the exact same entry shape and rendering code works for Field Map/
World View (which have world coords, converted via wPx/hPx) and
Towns/Dungeons (which never will, using the image's own pixel
dimensions directly) without a special case. Capped at 999 entries
per manifest server-side; strict area-key sanitization since it's a
filename component. Verified end to end against the running server:
add/get/delete round-tripped correctly on all four map types,
including 400s for out-of-range coordinates and an invalid map type.

Frontend: a reusable "Add Marker" panel (icon dropdown covering the
full 26-icon catalog, X/Y number inputs, optional label, submit) on
every map surface, plus click-anywhere-on-the-map to auto-fill X/Y
(a click, not a drag -- pan-vs-click was disambiguated with a small
movement threshold so panning the Field Map/World View doesn't
accidentally set coordinates). Manual entries render alongside
automatic ones through the same marker-drawing pass and the same
legend, which now shows every icon key that EITHER has a curated
default for that surface OR an actual manual entry present -- nothing
placed is ever invisible in its own legend.

### Towns and Dungeons gain a real interactive stage

Previously plain `<img>` reference views; now an actual
position:relative overlay (`renderImageMarkerStage` +
`setupImageMarkerStage`, shared between both) supporting click-to-set-
coordinates and rendered/removable manual markers directly on the
image, with per-surface curated legend defaults matching the user's
own examples (Smithy/Shop/Chest for Towns; Safe Areas/Warp Terminals/
Boss/Treasure Chest/Materials for Dungeons).

Rebuilt the `world` focus group and reran a fresh full `--status`
check after all fixes; 58/58 sections still pass.

---

## 36. Manual marker UX fixes: refresh bug, live placement preview, and a missing-icons diagnostic

User feedback with a screenshot: still seeing fallback symbols (a
plain white triangle, diamond outlines) instead of real icons, no
visible way to remove a marker after adding one, and no indication of
where a marker will land while adjusting X/Y before submitting.

### The delete-list refresh bug (real, confirmed)

`renderAddMarkerPanel`'s `onChange` callback, wired at all four map-
surface call sites, only re-drew the map's PINS -- it never re-invoked
the panel that shows the existing-markers delete list or the count. A
marker added successfully WOULD appear on the map, but the sidebar
list a person needs to find the delete button in never updated to
show it, so there was genuinely no reachable way to remove what you
just added (or anything else) without a full page reload. Fixed by
splitting the panel into a static shell (`renderAddMarkerPanel`,
rendered once) and a refreshable list (`renderExistingMarkerList`,
re-rendered on every add/delete via a proper `onMarkerChange` that
does both the map redraw AND the list refresh) at all four sites
(Field Map area, World View, and the shared Towns/Dungeons image
stage) plus the on-map click-to-delete path for both marker kinds.

### Live placement preview

Added `updateMarkerPreview()`: a dashed, semi-transparent ghost pin at
the form's current icon/X/Y, rendered on the same stage as real
markers. Wired to fire on every icon-select change, every X/Y input
keystroke, and every click-to-set-coordinates action (map click for
Field Map/World View, image click for Towns/Dungeons) -- answers
"nothing represents where the marker will land" directly rather than
requiring a blind submit-and-check cycle.

### Icons still showing fallback symbols: a diagnostic banner, not a guess

Re-verified this session's own build produces all 26 recolored icons
correctly (confirmed via WorldMap.json's icons registry and a live
HTTP fetch through the running server), so the screenshot's fallback
symbols are not a bug in the shipped code as run in this environment.
The most likely explanation, consistent with a design decision from
section 33: `build_map_icons()` degrades gracefully (not a crash) when
Pillow/numpy aren't installed on the SERVING deployment, writing an
empty icon index -- exactly what produces plain-symbol fallbacks
everywhere, indistinguishable in the UI from "the feature is broken"
without an explicit message. Rather than guess further at a remote
deployment's package state, added a clear diagnostic banner to World
Map itself: whenever the loaded icon registry is empty, a banner
states plainly that Pillow/numpy are needed and gives the exact
install + rebuild command, so "old icons" reads as "not built on this
server yet" instead of a rendering defect.

Rebuilt the world/textures groups and reran a fresh full `--status`
check; 58/58 sections still pass. Server-side marker CRUD re-verified
against the running server after all frontend changes.

---

## 37. Icons still not showing after a rebuild: eliminated the dependency entirely

User confirmed the diagnostic banner from section 36 WAS showing ("no
recolored icons found") even after running a full rebuild from the
Build Dashboard -- meaning Pillow/numpy genuinely aren't installed on
that deployment, and (reasonably) there's no practical way to fix
that on their end: this repo ships no Dockerfile of its own to add a
`RUN pip install` to, and installing into an already-running container
by hand doesn't survive a restart. Asking for an install that isn't
practical for the environment wasn't a real fix.

**Real fix: removed the dependency.** Wrote a small pure-stdlib PNG
decoder/encoder (`_png_read_rgba` / `_png_write_rgba`, `zlib` + `struct`
only) after first verifying it's safe to scope narrowly: checked
EVERY ONE of the 26 source icon PNGs' actual IHDR chunk and confirmed
all are 8-bit RGBA (color type 6), non-interlaced -- the one shape the
codec implements, chosen because it's the one shape that's actually
present, not a guess. Implements all four PNG filter types (None/Sub/
Up/Average/Paeth) for decode and writes filter-type-None on encode
(larger output than adaptive filtering, irrelevant at icon sizes).
Added `_box_blur_alpha` (a plain two-pass separable box blur) as the
pure-Python stand-in for PIL's `GaussianBlur`, and
`_recolor_icon_pure_python` reimplementing the exact same red/shape
+green/shadow+crop-to-bbox algorithm as the existing PIL path
(extracted unchanged into `_recolor_icon_pil`) using plain bytearray
loops instead of numpy.

`build_map_icons()` now tries `import PIL/numpy` and uses them when
present (faster; identical algorithm), but falls back to the pure-
stdlib path automatically otherwise -- map icon recoloring no longer
requires ANY third-party package, on any deployment, ever. Updated
`requirements.txt` to say so plainly (Pillow/numpy are now an
optional speedup, not a requirement) and softened the diagnostic
banner's wording to match (points at re-running the build rather than
an install command that may not apply).

**Verified, not just written**: force-disabled PIL/numpy in-process
(`sys.modules['PIL'] = None`) and confirmed `build_map_icons()`
produces all 26 icons via the pure-Python path; opened the resulting
PNGs WITH PIL (proving they're valid, standard-conforming files, not
just self-consistent with my own decoder) and checked color/shadow/
crop correctness numerically -- white fill, black shadow alpha, tight
bbox, matching the PIL path's own output within a few pixels (the
size difference traced to PIL's Gaussian blur vs. this session's box
blur spreading faint alpha slightly differently before the bbox crop
-- a cosmetic difference only, and `object-fit:contain` already
handles varying icon aspect ratios in the view). Ran the ENTIRE
`world` focus group with PIL/numpy force-disabled end to end and
confirmed `WorldMap.json` still reports all 26 icons. Restored the
PIL-accelerated build for this session's own output and reran a fresh
full `--status` check; 58/58 sections pass.

---

## 38. Map fixes (hide-preview toggle, default pin), and Weapon/Armor/Item "Sources & Crafting" panels

### Two small World Map fixes

Added a "Hide preview"/"Show preview" toggle button next to the
click-to-set-coordinates hint, so the dashed ghost pin can be
dismissed once it's in the way of markers already placed nearby
(state flag checked at the top of `updateMarkerPreview`, which now
returns early and clears any existing preview element when hidden).
Changed the Add Marker form's default icon from `safeArea` to
`waypointPinCommon`, per request.

### Weapon/Armor/Item preview panels: "Sources & Crafting"

The user now has confirmed recipe/cost/material/chest/shop data (from
this session's earlier work) and asked for it surfaced directly on
item preview panels, with sourcing (which DataTable/DataAsset it
came from). Rather than re-scan Recipes/Chests/Drops/Shops in the
BROWSER on every render (526 chests x pools, 242 drop rows x pools),
built ONE server-side cross-reference pass, `build_item_sources()`
(new `item_sources` pipeline section, 58 -> 59 sections), combining
four sections that already existed:

  - `recipe_by_produced`: reverse-maps a recipe's `producedItemKey`
    back to the recipe itself (cost, materials, category).
  - `materials_used_in`: reverse-maps each crafting MATERIAL's itemKey
    to every recipe that consumes it -- the "used as a material in"
    direction nothing else in the toolkit currently surfaces.
  - `shops_by_recipe_key`: reuses the CONFIRMED Cost-token-is-a-
    recipe-purchase join from the Shops section to answer "which shop
    sells the recipe for this item".
  - `chest_hits` / `drop_hits`: one combined pass each over every
    chest's resolved pools and every monster reward row's resolved
    pools, building itemKey -> [locations] / itemKey -> [monsters]
    reverse indexes -- run ONCE here, not per-item, and not
    per-render in the browser.

A real dependency-graph fix was needed first: `shops`' section
declared `"produces": None`, meaning its return value (the actual
shop list) was never available to later builders via the requires/
produces mechanism, even though the function already computed and
returned it. Changed to `"produces": "all_shops"` -- a safe, additive
change since nothing previously depended on it. `item_sources`
declares `requires` on all seven upstream values it needs
(all_weapons, all_armor, all_items, all_recipes, all_chests,
all_monster_drops, all_shops); verified the pipeline's own dependency
resolver auto-included every one of them (weapons/armor/monster_drops
weren't even listed in the `items` focus group) when run via
`--group=items`.

Result, verified directly from the built output: 345 items
cross-referenced, 236 with a recipe, 163 with a chest source, 163
with a monster-drop source, 42 with no known source at all (shown
explicitly on those items' panels, not left blank).

### Frontend: one shared panel, three call sites

New `app/js/item-sources-panel.js` exports
`renderItemSourcesPanelHtml(itemKey)`, wired into the existing preview
panels in `weapons-browser.js`, `equipment-browser.js`, and
`items-browser.js` with a single line each (right after each view's
own mod-callout/exception block) -- avoiding three near-duplicate
implementations. Reuses existing `DataStore` getters
(`getRecipeMaterialsInfo`, `getRecipeDisplayName`, etc.) rather than
re-deriving display names; added `getItemSources()` (a plain dict
lookup, returns `null` -- not a fabricated empty shape -- when an
instance hasn't built this section yet) and
`getDropSourceMonsterName()` (resolves a drop hit's enemy name via
the SAME Monster-database join Monsters > Drops already uses,
falling back to the raw enemy code rather than fabricating a name).
Every sub-section states its own source file inline (e.g.
"Source: `DataAssets/Items/ItemDataAsset.json` (recipe maps)"), per
the request for source-DataTable/DataAsset visibility.

Verified end-to-end: fetched `ItemSources.json` and `_index.json`
through the running server, confirmed the JSON shape and a sample
recipe entry resolve correctly. New Data Coverage panel documents the
combined-source design and the honest 303/345 vs. 42/345 split.
Rebuilt the `items` focus group and reran a fresh full `--status`
check; 59/59 sections pass.

---

## 39. Sources & Crafting visual polish, and chest contents on the map

User feedback on section 38's new panel: "used in" lists for popular
materials could get very long, "found in"/"dropped by" nested scroll
boxes felt cramped inside an already-scrollable side panel, and
plain-text item names with no icon made the panel harder to scan.
Also asked for chest CONTENTS (not just chest IDs) on the World Map.

### Icons next to every cross-referenced item

New `DataStore.getItemIconPath(itemKey)`: a category-transparent
lookup checking weapons, then armor, then the catalog, returning each
collection's own icon field (`textures.icon` / `textures.iconSmallMale`
.../ `textures.iconDatabase`) -- returns `null`, never a guessed path,
for a key not found in any of the three. Every material, recipe, and
cross-referenced item row in the Sources & Crafting panel now shows an
18px icon via this lookup.

### Replaced nested scrollboxes with inline expanders

`renderLocationSection`/`renderDropSection`/the "Used As a Material
In" list all used a fixed-height `overflow-y:auto` box -- functional,
but a scrollbar nested inside the side panel's own scroll area is
easy to miss and feels cramped. Replaced with `expandableListHtml()`:
shows the first 5 rows inline, and a "+N more" toggle that expands
the rest in place (no nested scroll, panel height grows naturally,
toggle re-collapses via "Show less"). Applied uniformly to all three
list types so the panel behaves consistently regardless of which
section is long.

### Chest contents on the World Map (Field Map area view)

Previously the map's chest section only listed bare chest IDs --
useful for the *count*, but seeing what's actually inside required a
trip to Items > Chests. `build_world_map()` now embeds each area's
chests as an OBJECT (`chestId` + `contents: [{itemKey, num,
sharePct}]`), reusing each chest's own resolved pools already computed
by the Chests section as their SINGLE source (no separate resolution
logic) -- a new `chests` field alongside the existing `chestIds` (kept
for compatibility). The Field Map area side panel now renders each
chest's real contents with an icon, resolved name (via the same
`getChestItemName` Items > Chests itself uses -- can't disagree with
that tab), quantity, and weight-derived share percentage, scrollable
as a whole rather than per-chest.

Rebuilt `world_map` and reran a fresh full `--status` check; 59/59
sections pass. Verified the new `chests` field and its contents shape
through the running server via a direct HTTP fetch.

---

## 40. Treasure Chests vanished: a real regression, root-caused and fixed with a fallback

User feedback: the Treasure Chests list (and its contents) disappeared
from the World Map entirely after section 39's update. Root cause,
confirmed by reading the exact diff rather than guessing: section 39
changed the side panel's chest check from `area.chestIds.length`
(the field every prior build always had) to `area.chests.length` (the
new rich field with resolved contents) -- with NO fallback. Any
toolkit instance that applied the new frontend code without ALSO
re-running the `world_map`/`world` focus build still had the old
`WorldMap.json` on disk, where `area.chests` simply doesn't exist yet
-- `undefined.length` would throw, but the code defended against that
with `area.chests || []`, which silently produced an EMPTY array and
hid the whole section instead of erroring. The count faithfully went
to zero and the section vanished, with nothing telling the user why.

**Fix**: the side panel now checks `Array.isArray(area.chests)` to
decide which field generation it's looking at, falls back to the
older bare-ID list (`area.chestIds`) when the richer field isn't
present, and shows an explicit on-screen note ("Contents unavailable
-- this instance's World Map data predates chest-contents support.
Re-run the World focus build to see items here") rather than
silently degrading. Verified the fallback logic directly (a
stale-shaped area object with only `chestIds` correctly reports
`hasRichChests: false` and the right count), confirmed the CURRENT
build has both fields present and consistent, and reran a fresh full
`--status` check; 59/59 sections pass.

**Process note for future sessions**: any time a pipeline output's
JSON *shape* changes (a field renamed or added), the consuming
frontend code needs an explicit stale-data fallback, not just a
truthy-guard that quietly produces an empty result -- an empty list
and "the feature doesn't exist yet" look identical to a user unless
the code says which one it is.

---

## 41. Characters > Player: Bonus Modifiers, Sword Skills, After Modifiers calculator, and stat controls

### DA_AttributeModification survey

The requested data source. `DataAssets/Parameters/Shared/
DA_AttributeModification.json` turned out to be MUCH richer than just
`BonusModificationData` -- it also carries `ExtraModificationData`,
`BenefitModificationData`, `PeculiarModificationData`,
`ConditionalPeculiarModificationData`, `SupportSkillModificationData`,
`GiftPillarModificationData`, `PartnerModificationData`, and several
curve fields -- scope for this session stayed on `BonusModificationData`
per the specific request. It's keyed by `EGrowthType` (the exact 7
stats this toolkit's Player builder already tracks as
STR/DEX/AGI/INT/VIT/END/MND), each with a `LevelData` array of
`{TriggerLevel, Effects: [{Type, Value}]}` breakpoints -- confirmed by
reading every entry directly: 79 breakpoints total, 19 distinct
`EModificationType` values, all identified and labeled (BonusHealth,
CoefATK, EnhSlashDmg, CoefCol, etc.) -- none left unrecognized.

### Pipeline: build_attribute_modifications() (52 -> 60 sections this session, several additions)

New section extracts the 7 stats' breakpoints into a clean
`AttributeModifications.json`, with each effect tagged by a human
label AND a `quantifiable` field: 7 of the 19 effect types
(BonusHealth/BonusStamina/BonusSP/CoefATK/CoefDEF/CoefStamina/CoefSP)
map onto a stat this toolkit's Player builder ALREADY computes
(MaxHealth/MaxStamina/MaxSoul/ATK/DEF); the other 12 (sword-skill
damage buffs, dodge, sprint, economy) are real effects with no
existing numeric home here, and are marked `quantifiable: null` so
the frontend shows them for reference without silently folding them
into a total that would overstate precision. `ATTRIBUTE_MOD_EFFECT_INFO`
records this classification explicitly, checked against the full
19-type census before writing a single label.

### Frontend: three additions, one deliberately separated from existing logic

1. **Bonus Modifiers panel** (below Equipped Gear): categorized by
   stat, shows every breakpoint UNLOCKED at the stat's current
   allocated value (cumulative -- reaching 30 keeps 5/10/20's earlier
   unlocks too, matching how the source data itself reads). Refreshes
   automatically whenever a stat changes (a stat crossing a
   breakpoint can add/remove a whole row, not just update a number,
   so this is a real re-render, not a text patch).
2. **Sword Skills panel** (also below Equipped Gear): filtered to the
   CURRENTLY EQUIPPED weapon's category, split into unlocked/locked
   by comparing each skill's own `weaponProficiency` field against
   the Weapon Proficiency slider -- confirmed these are directly
   comparable (both 0-10 range) and NOT the same thing as the
   separate, already-flagged-informational `weaponProficiencyThresholds`
   curve the ATK question involves.
3. **After Modifiers calculator** (under Weapon Proficiency): per the
   explicit request to add this "without changing the current
   process or representation of existing data" -- `computeAfterModifiersTotals()`
   reads the EXISTING `computePlayerVitals()`/`computePlayerCombat()`
   outputs as an untouched baseline, then adds two independently-sourced
   deltas: the quantifiable Bonus Modifier totals, and a single
   EX-MOD picker's value (reusing the standalone Weapons page's own
   26-type EX-MOD pool and `formatExModValue()`/`renderModCalloutShared()`
   helpers rather than reimplementing them). Verified the arithmetic
   directly in Node against the real data before trusting it in the
   UI: hand-computed STR=50's unlocked ATK/DEF Coef total (8/13) and
   VIT=35's unlocked BonusHealth total (20, correctly excluding the
   30-breakpoint's EnhHealCrystal effect as non-quantifiable) both
   matched the code's own output exactly. Equipped Unique MODs are
   listed via the SAME shared renderer the Weapons/Armor pages use
   (can't disagree on wording) but are explicitly NOT summed into the
   table -- not every Unique MOD reduces to a flat/percent number this
   calculator could add without overstating confidence.

### Stat controls: +10/+100, Stat Reset, Reset

Added `+10`/`+100` (and matching `-10`/`-100`) buttons alongside the
existing `+1`/`-1`. Found and fixed a latent clamping gap while doing
this: the original `adjustPlayerStat` only checked "is remaining
already 0" before applying a delta, which was harmless at delta=1 but
would have let a `+100` click silently overspend Grow Points into
negative remaining. Fixed to clamp the applied delta to whatever
actually remains (or up to 1 on the negative side), so a `+100` click
with 7 points left applies exactly 7, not 100 or nothing.

Two reset buttons, scoped exactly as requested: **Stat Reset** (all 7
stats back to 1, level/gear/proficiency untouched, for reallocating
the same build differently) and **Reset** (the entire build back to
defaults). Both confirm before acting; Reset re-renders through the
existing tab-switch path (`renderActiveTab`, which clears the
container first) rather than calling `renderPlayerTab` directly,
which would have appended a second copy on top of the first instead
of replacing it -- caught before shipping.

### Verification

Rebuilt the `characters` focus group; `attribute_modifications`
produced 7 stats / 79 breakpoints / 0 unrecognized effect types.
Fetched the built JSON through the running server and independently
re-derived the unlock/sum logic in plain Node against it, matching
the in-app JS exactly. Reran a full `--status` check after two
earlier attempts were killed by the sandbox mid-run (an environment
quirk, not a pipeline issue -- the run that actually completed took
under 5 minutes); 60/60 sections pass.

---

## 42. 4 EX-MOD slots, simplified stat buttons, and DataTable/DataAsset CSV export

### Player Build: 4 EX-MOD slots, symbol-only stat buttons

User feedback: a weapon allows up to 4 EX-MODs, so the After
Modifiers calculator's single picker undersold what's actually
possible. `player.exModPicker` (one slot) became
`player.exModPickers` (an array of 4), with
`computeAfterModifiersTotals()` now summing every slot's delta
instead of reading one. The render/bind code moved from two fixed
element IDs to `data-ex-slot`/`data-ex-role` attributes so 4 (or any
number) of type+tier select pairs can share one delegated binding
pass rather than four near-duplicate listeners.

Also simplified the six stat delta buttons (+1/+10/+100, -1/-10/-100)
to show only "+" or "−" -- no numeric labels -- per the request that
position alone conveys magnitude; each keeps its exact delta in a
`title` tooltip for anyone who wants to confirm without clicking.

### DataTable/DataAsset -> CSV export (new Build Dashboard panel)

New `/api/pipeline/export-csv` (+ a cheap `/api/pipeline/export-csv-info`
pre-check) in `server.js`, converting a raw exported JSON file into a
CSV using UE's OWN DataTable CSV convention -- reimplemented from that
documented format, not guessed: nested struct fields become
`(Key=Value,...)`, arrays become `(Item1,Item2,...)`, and a cell gets
CSV-quoted whenever the encoded value itself contains a comma.
Verified against real, non-trivial rows before trusting it: a
DataTable row with plain nested structs
(`DT_CombinationSlash`'s `ThumbnailTexture` fields) round-tripped
correctly, and `DT_ItemLotTable` -- an array of structs containing
FURTHER nested structs (`Item`, `RelotNumAdjust`) -- produced exactly
1013 correctly-encoded rows plus a header, matching the table's own
known row count exactly.

Detects DataTable vs. generic shape from the FILE ITSELF (exactly one
top-level object carrying a `Rows` map) rather than trusting a
filename pattern. DataAssets (no `Rows` map -- a single Default
object's `Properties`) get a best-effort SINGLE-ROW export instead,
explicitly labeled `dataasset-best-effort` via an `X-Export-Kind`
header the frontend surfaces before download -- UE has no native
"import a DataAsset from CSV" workflow this could target, so it's
offered per the "wouldn't hurt to have it too" request without
implying it's an equally solid round-trip.

New Build Dashboard panel: lists all 75 real DataTables (reusing the
DT Inspector's own catalog -- never a fabricated table-name list),
searchable by path, one-click CSV download per table, plus a manual
path field that checks-then-offers export for anything else
(including DataAssets). Verified end to end against the running
server: the nested-struct and nested-array cases above, the
DataAsset best-effort path, the path-traversal guard (rejects `..`),
and a 404 for a nonexistent path all behaved correctly.

No `build_pipeline.py` changes this round (all three changes are
frontend + server.js), so the previous full pipeline `--status`
verification (60/60 sections) remains valid without a redundant
re-run.

---

## 43. First post-release export: layout churn, 3D models, live build progress

The game's first content update shipped, and the user uploaded 13 new
Content zips (DataAssets 1–4, Localization, six Widget families, and
ITM OneHandedSwords/Shields — the latter two carrying their recreated
psk/pskx/blend/**fbx** binaries). Reported symptoms: Partners didn't
update, some weapons/armor still nameless, localization counts off,
Maps showed 1 town and odd Field Map Overview placement, chests absent
from the map, FBX downloads missing, plus two feature asks — a
per-section build status indicator that survives page reloads, and an
in-app 3D model viewer.

Root causes, each verified against the real files before fixing:

- **Partners:** `PARTNER_CODES` was a hardcoded 7 while the new export
  has 22 in `DT_PartnerList`, 26 `Character/Partner/PersonalData/
  Partner_*.json` (a NEW location), and 21 thumbnails. Replaced with
  `discover_partner_codes()` (union of all three sources — none is a
  superset of the others) and a glob-driven `build_partner_stats`.
  Result: 7 → 21 partner entries, 20 with thumbnails and weapons.
- **Names/localization:** the new `Game.json` DOES contain the
  previously-missing names (`ItemName_WOS_37` → "Proto-Elucidator S",
  `Upper_30` → "Flutter Robes") **and two new languages (en-AU,
  ja-JP)** the fixed 13-language dict silently ignored. Language
  discovery is now dynamic from `Localization/Game/*/Game.json`;
  verified 15 languages × 197/197 equipment names after rebuild. The
  new shield is `Shield_37` (IDs jump 3–12 → 37), not `Shield_13`.
- **Quests:** Main grew 5 → 34 and two new folders appeared (`Sub/` 61
  with a delivery-`Accomplish` shape, `Free/` 94 generated repeatables
  referencing a parent quest, with no localization keys in any
  language — confirmed). Scan widened to all three with category-
  qualified IDs (Main_0001 and Sub_0001 both exist); the quests view
  gained a category filter; area/dungeon quest cross-refs widened.
- **Field Map Overview placement:** UE slot semantics again — with
  `Alignment (0.5, 0.5)` the WBP's Left/Top is each overlay's CENTER,
  not its top-left, so every piece drew shifted by half its own size.
  Pipeline now exports `alignX/alignY`; frontend subtracts
  `align × size` (default 0.5 for pre-field data).
- **Chests on the map:** still zero coordinates in the export, so each
  area's chests fan out in a dashed APPROXIMATE ring around the area's
  own gate marker, clickable through to resolved contents, limitation
  stated in tooltip/legend/panel.
- **"1 town":** a data reality, not a bug — the game ships exactly one
  town map texture (TOB). What the update DID add: `Widget/Dungeonmap`
  minimap module tiles (10 families, 190 tiles — backgrounds, boss
  chambers, corridor modules), now a browsable catalog under World ›
  Map › Dungeons; no assembled layout exists, so none is faked.
- **FBX (and the viewer's format):** `fbx`, `glb`, `gltf` joined the
  sidecar lists (`psa`/`ueanim` gained `fbx`/`glb` too). New
  `model_refs` section builds `Database/Models/Models.json` — 342
  entries (120 monsters from the game's own `Database_{id}.json` model
  definitions with mesh + idle anim + scale, 127 weapons, 69 armor
  incl. gendered costumes, 26 partners). Detail pages for all four
  kinds show a 3D MODEL panel; the in-app viewer (three.js, vendored,
  offline, ES-module bridged to the plain-script views via
  `window.ModelViewer`/`ModelPanel`) loads .glb/.gltf only — the
  documented Blender round-trip (import psk/pskx/fbx → export glTF
  Binary) is stated everywhere the limitation shows. End-to-end
  verified with a hand-built minimal GLB: sidecar indexed, button lit,
  then removed. The user's real 34 fbx + 68 psk/pskx/blend files all
  index correctly.
- **Live build progress:** the runner now writes
  `.pipeline-progress.json` (atomic, per-section pending → running →
  ok/failed/skipped, real builds only — never `--status` checks);
  `/api/pipeline/rebuild-progress` merges it; the dashboard renders a
  per-section chip strip that resumes after reload and shows
  terminal-launched runs. Verified against a real failed full run
  (4 ok / 1 failed / 56 skipped recorded correctly).
- **Latent focus-build crash found and fixed:** `mod_coverage`/
  `mod_loc`/`ex_mod_loc` read context in `prepare` without declaring
  it, so `--only=` on them raised `KeyError('resolved_mods')`. New
  `contextNeeds` key + `resolve_selection` expansion; verified
  `--only=mod_coverage` now auto-includes weapons/armor/peculiar_mods.

Local verification ran 37/63 sections clean — the other 26 need raw
files (SwordSkill DTs, DA_InGame, Parameters/Hero, CHR/, ANM/,
WwiseAudio) that exist on the deployment but weren't in these zips; on
the deployment a full run covers everything.

## 44. Second data drop: 54/63 sections live, Materials index, chest-coordinate readiness

Eight more zips (DataTables-DataAssets, Maps ×4, Story-Quests,
Gameplay-Blueprints, CelShaders) took local verification from 37 to
**54/63 passing sections** — sword skills, shops, world map (8 aligned
overlays), gates (122 with coordinates), areas (176), item sources,
monster spawns/drops/stats, player sim, and **25 partner stat tables**
all now build. Still missing from every upload so far:
`DT_ActiveSkillList.json` + `PlayerConfig.json` (Parameters/Hero),
`Character/NPC/Parts|Action`, `Widget/AvatarCustomize` WBPs, and the
whole `CHR/`, `ANM/`, `WwiseAudio/` trees (asset inspector + audio).

**Chest coordinates, answered with evidence:** FixTBoxTable rows are
loot-only; the World Composition tile levels contain zero gameplay
actors (checked object types); both persistent levels are World
Partition (`PL_*_WP`), so placed `BP_TBox*` actors live one-per-package
under `Content/__ExternalActors__/` — not yet exported.
`_scan_chest_actor_coordinates()` ships AHEAD of that data (tolerant
key/RelativeLocation matcher over `__ExternalActors__` + `Maps/`), the
chest/world-map builders carry a `coordinates` field, and the map view
plots solid pins for placed chests while keeping dashed approximate
gate-ring pins for the rest. Upload → rebuild → real pins.

**Materials:** new `materials` section indexes 658 assets (199
masters, 459 instances, 231 cel-family, 9 broken chains) with parent
chains, children, and chain-merged effective parameters — necessary
because the game's names lie (`M_CHR_Cel_Upper` is a
MaterialInstanceConstant; the true master is
`M_CHR_Cel_MaterialTypes`, 163 descendants). New Tools › Materials
view browses it. `tools/generate_ue_material_script.py --family <root>`
emits a UE 5.3.2 editor script creating parents before children with
full parameter scaffolding; two verified hard limits documented
everywhere: cooked exports strip the master node graph (0
MaterialExpression objects, empty CachedExpressionData), and
MSM_CelSf is a custom engine shading model (DEFAULT_LIT substituted,
warning logged). Emitted CelShader script: 7,415 lines, valid Python.

## 45. Third drop: 58/63 sections, real 3D render verified, per-monster joins, recreation ZIPs

Five more zips (NPCs, SignPosts, 3DRenders, Widget-MapTexture,
WorldData-PL). Findings, checked not assumed:

- **SignPosts carry NO coordinates** — they're BlueprintGeneratedClass
  definitions (SCS only). **NPC Action files DO carry world
  coordinates** (RootData Location X/Y/Z) — the npcs section now
  builds 208 NPCs with 169 appearance-parts and 154 placed actions.
  WorldData_PL_* are per-world spawn/boss wiring, no chest positions.
  Chest coordinates still = Content/__ExternalActors__ (both
  persistent levels are World Partition).
- **PlayerConfig.json is a GENERATED OUTPUT** of build_player_config
  (from the four Parameters/Hero curves), not a raw input — session
  44's missing-files list misclassified it; corrected.
- 58/63 sections now pass locally. Remaining: bp_inspector
  (Widget/AvatarCustomize WBPs), asset_skeletons +
  asset_inspector_index (CHR/**/SK_*.json mesh JSONs — the 3DRenders
  zip shipped E001001's psk/fbx/blend/glb binaries WITHOUT the mesh
  JSON), wwise_audio (WwiseAudio/ tree).
- **First real 3D render verified end-to-end**: the boar .glb indexes
  against 7 monster entries (shared mesh) — viewerReady, View 3D live.
- **Maps**: Widget-MapTexture took towns 1 → 6 (TOB, Hornca, Malome,
  Talan, Tolbana, Urbas), dungeon floors 10 → 25, and textured Field
  Map areas 7 → 114 (marker placements 26 → 437) — the deployment
  just needs the uploads + a World rebuild.
- **Characters**: all 22 DB rows named after rebuild (stale build on
  the deployment), AND 6 roster-only partner codes (ADN, IOF, MTO,
  NKA, VRT, YSN — 4 with full stat tables) were invisible because
  build_characters only read DT_CharacterDatabase. Now appended with
  hasDatabaseRow=false, honest callout, names where localization
  exists (Iori, Nika, Mito), raw keys where not.
- **Monsters detail** now joins Combat Stats, Drops, and Spawns
  inline by enemyNameKey (verified shared key across all three
  tables), lazy-loading the two big files once, with links to the
  full tabs.
- **Materials recreation is one click**: /api/materials/recreation-zip
  runs the generator server-side (family validated against the index,
  spawn with arg array — no shell) and streams recreate_<family>.py +
  INSTRUCTIONS.md + referenced-assets.txt. Tested: 200 on the
  163-asset cel family, 404 unknown family, 400 invalid input.

## 46. Modding platform: shields/textures bugs, chest-area links, RODSchema + Lua workbenches

Fixes first, each root-caused on real data: **shields had no 3D model
buttons** because shield AvatarParts use `ShieldMesh`, not
`MainWeaponMesh` (user's "looking in the wrong spot" hunch was exactly
right) — 13 shield entries now, with the user's real psk/blend/fbx
detected; SubWeaponMesh (dual-wield offhands) carried too. **"Maps
uploaded but not showing" was a real bug**: no focus group included
the `textures` copy section, so a world rebuild after the
Widget-MapTexture upload refreshed the JSONs (6 towns listed) while
every image stayed uncopied — broken links. All six content-facing
groups now start with `textures`. **PlayerConfig.json is a generated
output** of build_player_config, not a raw input (corrected from
session 44). Item pages now link each recipe/loot **chest to its Field
Map area** (world_map's new `locationToGate` join + `App.openMapArea`
deep link, chest pin pre-highlighted).

Then the modding platform. **RODSchema** (the user's PalSchema-
architecture UE4SS loader, 1,371 lines C++) is vendored under
`rodschema/`; its 4 signatures were extracted from RODSignatures.h
into a managed `signatures.json` (3 confirmed, 1 placeholder), edited
in the new Tools › RODSchema view and written back by
`tools_sync_signatures.py` at build time. The unified patch format
(one JSON, edits across many tables) validates against the REAL
export — tested: a bogus field and a nonexistent table both produce
specific, actionable notes — and splits into RawTableLoader
`raw/<Table>.json` files. Packaging streams source + signatures + mods
+ BUILD-INSTRUCTIONS.md (deps restored via git submodules; the DLL
builds on Windows/MSVC — RE-UE4SS can't be cross-compiled from this
Linux server, stated plainly rather than half-attempted). **Lua
Scripting**: new `lua_functions` section indexes 3,139 hookable BP
functions across 682 blueprints (Type=="Function" objects +
generated-class names, flagged when derived); the view searches them
and assembles mods from snippet families modeled on the three working
example mods, downloading an installable ue4ss/Mods folder ZIP. All
four new endpoints integration-tested against the live server.

## 47. Deployment truths, shop internals, WL02 overview, patch presets, skill transport

- **"Save failed: Unexpected token '<'" diagnosed**: Express's default
  "Cannot POST" HTML page — the RUNNING server.js predated the new
  endpoint. Frontends update on reload; the server only on restart.
  The save handler now says exactly that instead of the cryptic parse
  error, index.html is served no-cache, and all 46 script/css tags
  carry ?v= stamps so a stale page can't silently pin old JS again.
- **GameInstance class path CONFIRMED from the export**:
  BP_RODGameInstance's SuperStruct is Class'RODGameInstance' at
  /Script/ROD — RODSchema's "guess" was right; source comment updated.
  Remaining blocker for DataAsset-phase loaders is only the Init()
  vtable index (Windows debugger work, PalSchema-style). UDataTable::
  Serialize (confirmed) covers every raw DataTable edit; DataAssets go
  through the typed loaders at GameInstance init — they are NOT
  covered by the Serialize hook, which the view now states.
- **Shops**: the three "missing" lists are FIELDS of the single Shop
  row (each name appears exactly once — checked): YellCoinShopItems
  (direct items), MerchantCreateList (per-RANK recipe ids),
  BlacksmithCreateList (per-rank ERecipeKind → recipe ids). All three
  now build + render with raw ItemIDs shown everywhere (the values
  RODSchema patches reference). Shops.json became an object; the
  loader handles both shapes.
- **Field Map overview generalized**: the WL01 hardcode was stale —
  the newer export ships WBP_Map_FloorMap_WL02 + T_FloorMap_WL02.png.
  Now every world with both files gets an overview tab; WL02's own
  widget has ZERO piece slots (verified), so its floor renders with
  that stated rather than fake highlights.
- **Patch presets, cloned from reality**: /api/rodschema/patch-examples
  builds 5 presets at request time by CLONING REAL ROWS (weapon /
  item / shield / shop-stock / recipe), each listing every touchpoint
  the game's standard uses — including honest _limitations: stats are
  ItemDataAsset maps (typed loader), display names are StringTable
  localization RawTableLoader can't patch yet, per-category thumbnail/
  impostor tables (there is no generic DT_WeaponThumbnail — checked).
- **AI Skill transport root cause**: the skill fetched via sandbox
  urllib, and Claude's code sandbox has an egress ALLOWLIST — the
  user's duckdns domain is unreachable from there no matter how
  healthy the site is (NPM was innocent). SKILL.md reworked to
  web_fetch-FIRST with an NPM triage checklist; both scripts marked
  fallback-only. Budget Tracker updated to Jul 11 (18 working days,
  1,440 hrs / $86,400 at the stated $60/hr baseline); coverage
  report's 13-language / 7-partner era claims corrected.

## 48. The Game SDK: Dumper-7 dumps become a UE-project module

The missing half of the modding story arrived: the FModel exports show
the DATA, and a Dumper-7 dump shows the TYPES it's poured into. Both
dumps (release-1.0.3 and beta-1.0) are now first-class inputs.

- **Upload** (`/api/pipeline/upload-sdk-zip`, wired into the Build
  Dashboard's existing drop zone): validated by SHAPE
  (CppSDK/SDK/ROD_structs.hpp must be present -- that's what makes it
  THIS game's dump), extracted to `raw-export/GameSDK/<version>/` so
  versions coexist instead of overwriting, and the `.usmap` is also
  copied to `raw-export/Mappings/` where FModel/UE4SS users look.
- **Index** (new `game_sdk` section + `sdk` focus group): parses the
  ROD module -- **511 enums, 921 structs, 1,250 classes**, of which
  **93 are DataTable row structs** (deriving FTableRowBase) and **120
  are DataAsset classes**. `URODItemDataAsset` shows its real
  `TMap<int32, FUseItemData> UseItemDataAsMap` etc: the exact
  containers RODSchema's typed loaders patch.
- **Primary-dump selection**: prefer release over beta, then highest
  version, and only then mtime. (mtime alone picked beta-1.0 purely
  because it was copied in last -- an upload-order accident deciding
  which SDK the app describes.) **Version drift is reported**, which
  immediately paid off: 1.0.3 adds 6 structs and 1 enum over the beta,
  including `FSewingLotteryDataTable` -- a whole system the beta lacks.
- **UE-project SDK download** (Game SDK button on Data Coverage, next
  to AI Skill): Dumper-7's own headers CANNOT go into a UE project --
  raw offsets, Pad_ filler, DUMPER7_ASSERTS_*, no UHT macros. So the
  toolkit REGENERATES the same types as UHT-visible declarations
  (`UENUM`/`USTRUCT`/`UCLASS` + GENERATED_BODY + UPROPERTY), topo-sorted
  so supers/dependencies precede dependents, bitfields restored to
  `bool`, padding dropped, engine types left to Engine headers rather
  than redeclared (redeclaring them is what breaks naive SDK ports).
  Ships as a compilable module: `RODGameSDK/Public/*.h` +
  `.Build.cs` + the `.usmap`/`.idmap` + INSTRUCTIONS.md (copy to
  Source/, add to .uproject, regenerate project files, build).
  Verified end-to-end: 437 structs, 144 enums, 120 DataAsset classes.
  Layout note stated plainly in the header: offsets are NOT
  reproduced, because UE recomputes layout and editor-side authoring
  only needs field names and types to match -- they do.

60/64 pipeline sections now pass locally.

## 49. Closing the open loops: id spaces, shop roles, Lua presets, costume colors

Every item left pending is done, and one of them turned up a real bug.

- **Two different shop id spaces** (found by checking the ids, not
  assuming one resolver fit both): MerchantCreateList ids are **Cost
  tokens** (purchasable consumable-recipe items), but BlacksmithCreateList
  ids are **recipe-map KEYS scoped by ERecipeKind** (Upper #5001 =
  UpperRecipeDataAsMap["5001"]). The single-resolver code left **18 of 19
  blacksmith recipes unresolved**; now 19/19 resolve. Same number under a
  different kind is a different recipe -- which is exactly why the two
  "fill" presets are kept separate.
- **Shops view** restructured into four role-labeled tabs (Shop List /
  Merchant Create List / Blacksmith Create List / Yell Coin), with the
  player-confirmed roles stated as such -- Smithy = Blacksmith list,
  Item Seller = ShopList + MerchantCreateList -- and YellCoin left
  explicitly UNASSIGNED, because no export field names its consumer and
  a plausible guess would just be a guess wearing a lab coat.
- **ItemIDs everywhere**: numeric id chips on weapons/armor/catalog rows,
  and recipes now carry BOTH ids that matter -- the recipe-map key AND
  the new `costItemId` (the "buy #" token shops reference). 59/245
  recipes have a Cost token, matching the 59 shop entries exactly.
- **Lua Mod Presets tab**: four parameterized presets that package to
  installable ZIPs -- StackSizePlus (UseItemDataAsMap MaxStack 5 -> 99,
  verified vanilla value), InventorySlots, BattleHealing (simplified from
  the user's Kirito mod), CompanionBeQuiet (their multi-file mod packaged
  as-is). Verified end-to-end: templates fetch, tokens substitute (zero
  left over), server returns a valid mod ZIP.
- **The SDK answered a question the JSON exports couldn't**: there is NO
  inventory-capacity field in any export -- but the Dumper-7 dump has
  exactly one candidate, `URODGridListWidgetBase` (GridColumn/GridRow/
  GridItemMax). The InventorySlots preset therefore ships in **DUMP mode
  by default**: it logs the real live values first so they can be
  confirmed before anything is changed. Guessing and setting blind would
  have been the easy way to look confident and be wrong.
- **"Fill the shop / fill the smithy" are NOT Lua jobs** and the UI says
  so: they're DataTable edits (DT_ShopItemList's single Shop row), so
  they live in RODSchema as presets generated from the real export --
  59 consumable recipes into shop 1 + merchant rank 1, and all **186**
  equipment recipes across 10 ERecipeKind buckets into blacksmith rank 1
  (vanilla rank 1 is EMPTY -- that's what "at base level" means).
- **Costume Feature colors**: DT_CostumeColorList = 50 colors with hex,
  shown as real swatches on Upper/Gloves/Lower armor (ECostumeKind has
  exactly those three values -- confirmed in the SDK, matching what the
  player observed). It's ONE shared palette; nothing scopes a color to a
  piece, so the app says that instead of inventing per-piece subsets.
- **Sword Skill animations**: every skill's 5 per-level clip IDs
  (SkillLevel1..5ClipID) are surfaced, with the naming convention spelled
  out -- and the honest note that the AnimMontage assets themselves are
  absent from this export (the strings appear nowhere else, including the
  SDK's GObjects dump).

61/65 sections pass locally.

## 50. Naming the last four gaps (and making the dashboard say so)

The four sections that don't pass are all waiting on EXPORTS, not code:
BP Inspector (Widget/AvatarCustomize WBPs), Asset Inspector Skeletons
(CHR/**/SK_*.json -- the mesh METADATA; the .psk/.fbx/.glb already
uploaded are geometry), and Wwise Audio (WwiseAudio/Events). The
fourth, Asset Inspector Index, has NOTHING missing of its own -- it is
blocked purely by Skeletons, and the status report used to show it as
"Missing: (nothing)", which looked like a mystery failure. Status now
computes `blockedBy` by walking each section's requires/contextNeeds to
the section that actually lacks inputs, and the dashboard leads with a
"Still waiting on exports" panel naming, for each gap: the exact path
to export, how to get it out of FModel, and what it unlocks. A person
should never have to ask the tool why something is stuck.

## 51. Two SDK-upload bugs: "undefined files" and the missing focus button

Both reported immediately after shipping the SDK feature, both real:

- **"Extracted undefined files"**: the upload result was rendered by ONE
  template that assumed the content-zip response shape (`fileCount`),
  while the SDK endpoint answers with `version` / `sdkFiles` /
  `mappingsCopied`. Adding an endpoint without teaching the renderer
  about its shape is exactly the kind of seam that produces confident
  nonsense. The handler now branches and reports each upload for what it
  actually is ("Game SDK dump received — <version>, 1,402 SDK files
  extracted, mappings copied"), and points at the focus group to run next.
- **No Game SDK focus button**: the dashboard read its focus groups out
  of the CACHED status report -- and that cache is only refreshed by the
  multi-minute full check run. A group added after the last run was
  therefore invisible, which is a genuinely bad property for a registry
  that's supposed to be the single source of truth. Fixed at the root:
  `--focus-groups` (runs NO sections, milliseconds) + a
  `/api/pipeline/focus-groups` endpoint, and the dashboard always
  refreshes buttons from it. No new group can hide behind a stale cache
  again.

Verified against the real beta dump upload end-to-end.

## 52. The stuck-build trap (and what Refresh Status actually does)

Stopping the server mid-build left the dashboard permanently showing
"Build in progress…" with every build button disabled. The root cause is
worth naming precisely: the on-disk progress file still said
`running: true`, and the server BELIEVED it -- my own code comment even
said "the next real run overwrites it", which is true and yet useless,
because the only action that would have overwritten it was the action the
UI had disabled. A stuck state whose only exit is the thing it blocks.

Fixed by making the claim verifiable instead of trusted: the progress
file now records the build process's **pid**, and the server asks the OS
whether that process still exists (`kill(pid, 0)`). Alive -> genuinely
running (including terminal-launched runs, which still work). Gone -> the
run was KILLED, so it reports `interrupted` with how far it got, keeps
every build button enabled, and offers to clear the record. Clearing
marks the file interrupted rather than deleting it -- the per-section
states are the record of how far the run got, and destroying that to fix
a stuck button would be losing information to fix UI. Clearing is refused
while a build is genuinely alive. Progress files predating the pid field
are trusted only for 10 minutes, so neither old files nor real terminal
runs get stomped. Verified both directions: a dead-pid file reports
interrupted and a rebuild returns 200; a live build reports running,
refuses a second build (409), and refuses clearing.

Also clarified the three buttons that were easy to confuse:
**Refresh Status** re-reads current state and builds nothing;
**Run checks now** re-runs every section as a diagnostic (minutes) and
saves a fresh report; **Rebuild** is the only one that regenerates app
data.

## 53. Mappings shipped to a folder nothing reads

Data Coverage kept advertising the 1.0.1.0 (beta) usmap/idmap even after
a 1.0.3 dump was uploaded, and the designated mapping folder stayed
empty. Cause: the SDK upload copied mappings to `raw-export/Mappings/`
(where FModel users look on disk) but NOT to `mapping-files/{major}/
{minor}/{patch}/{build}/{usmap|ida}/` -- the VERSIONED store the Data
Coverage "Direct" buttons actually read. Two consumers, one destination:
shipping data to a folder nothing reads is the same as not shipping it.

Now both. The game version is parsed from the dump's own name (Dumper-7
builds it from the game build string:
`...+release-1.0.3-EchoesofAincrad` -> 1.0.3.0) and the files are filed
under the versioned tree, so `findLatestMappingFile` picks 1.0.3 over the
hand-placed 1.0.1.0 beta -- which is preserved alongside rather than
overwritten. If the version can't be parsed, NO version is invented: the
files still land in raw-export/Mappings/ and the response says plainly
that the versioned copy was skipped and why. The upload result now names
the version and the files it filed, so this is visible rather than
silent. Verified with the real 1.0.3 zip: status flips 1.0.1.0 -> 1.0.3.0
and both Direct downloads return the new files (578KB usmap, 1.16MB idmap).

## 54. Two bugs I shipped: stacked shop tabs, and invisible ID chips

Both mine, both found by the user, both with the same flavour -- code
that ran without error while producing nothing (or worse than nothing).

**Shops sub-tabs stacked.** `render(container)` did `appendChild(wrap)`
WITHOUT clearing the container. That was fine while the router did the
clearing on route change -- but the new tabs make the view re-render
ITSELF, so every tab click appended another whole copy of the view below
the last ("weird sections at the bottom"), and the tabs looked frozen
because `getElementById` kept finding the STALE first copy's panes and
dutifully updating those, off-screen above. Fixed by clearing on render,
and by making a tab click swap only the tab body + active pill instead of
re-rendering the view at all -- which cannot re-introduce the bug.

**ID chips invisible in Catalog/Materials.** Two independent causes,
which is why "the code is right there" was no defence:
  1. I appended the chip INSIDE `.wl-id`, which is deliberately
     `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` so
     long DT/BP paths truncate instead of widening rows. It truncated my
     chips right off the end of the row. They now sit OUTSIDE it as
     siblings with `flex-shrink:0` -- a 4-character chip is never the
     thing that should give way.
  2. I put the CSS in `app/css/main.css`, which DID NOT EXIST -- the
     `cat >>` created it, and index.html only ever loads `theme.css`. A
     stylesheet nothing loads is not a stylesheet. Rule moved into
     theme.css; the orphan file is deleted.
Chips now show on Catalog, Materials, Key Items, Weapons and Armor
(numeric ItemId), and on Recipes BOTH ids that matter: the recipe-map key
and the yellow "buy #" Cost token shops reference. Cache-bust stamps
bumped so the changed CSS actually reaches the browser.

## 55. What actually defines a quest's areas: QuestTerminalList

The user asked what decides which WL01/WL02 areas a quest loads, and
suspected terminals/safe areas rather than map areas. The data says:
**`QuestTerminalList`** is the field, and it is a list of GATE IDS.
Every one of the 465 refs classifies:

  SA_<Location>                -> a Field Map area (matches world_map's gateId)  284
  SA_/WT_<DUNGEONCODE>_F<n>... -> a dungeon gate                                  149
  WT_<TownName>                -> a town warp terminal                             22
  (nothing claims it)          -> unresolved                                        10

Findings worth stating, because they answer the question rather than
decorating it:

- **NO quest's areas span more than one world.** All 189 checked: every
  quest's field areas are WL01-only or WL02-only. The "areas from both
  worlds" impression doesn't hold. What IS true is that a quest pulls
  MANY areas from ONE world -- Sub 0022 loads 11 (Plains1_1_01 through
  Hills2_1_08, all WL01) -- which is why several appear per quest.
- **Free quests declare NO terminal list at all** (all 94). Only the 34
  Main + 60 Sub quests do. So "which areas load" is a Main/Sub concept;
  Free quests inherit whatever is streamed.
- **Dungeon quests use dungeon-specific gates and typically zero field
  areas** -- exactly the separation the user predicted.
- The 10 unresolved refs are a REAL FINDING, not noise: quests reference
  ERU_Deep, NTR_Und, NTR_Twi and WT_Darkness, none of which exist in the
  dungeon database. Reported as unresolved rather than force-fitted; a
  quest pointing at content the dungeon table lacks is information.
- One case inconsistency absorbed on purpose: the quests spell a dungeon
  "HFO_Def" where the dungeon table says "HFO_DEF". Matched
  case-insensitively so it doesn't masquerade as a missing dungeon.

Shipped as a new `quest_areas` section (runs after world_map/dungeons/
towns, enriches Quests.json) plus an "Areas loaded" panel in the quest
detail -- field areas are 📍 links straight to that area on the Field Map.

## 56. Terminals are not chunks -- and the section nobody could run

Two corrections, one to the code and one to my own claim.

**The bug:** `quest_areas` was never added to the `world` FOCUS GROUP.
The section existed, passed, and enriched Quests.json in MY full runs --
but a user rebuilding "World" would never trigger it, so the panel had no
data and simply didn't render. Adding a section without adding it to the
group that would run it is a section that doesn't exist for anyone else.
Fixed (and it sorts after world_map/dungeons/towns, whose outputs it reads).

**The claim I got wrong:** I described QuestTerminalList as "the field
that defines which areas stream in". The SDK says otherwise, and the SDK
is the authority here:
  - `QuestTerminalList` is `TArray<FName>` on `FQuestData`, passed to
    `ServerDecideQuest(..., QuestTerminalIDs, FloorTerminalIDs, ...)`
    alongside `ClientActivateTerminal` / `ServerDecideStartTerminal`. It
    is the set of safe areas and warp terminals the quest ACTIVATES --
    its checkpoint / fast-travel set.
  - Actual level streaming is driven by **`ARODLevelStreamingVolume`**:
    an overlap volume carrying `LevelReferenceList` (TArray<FName> of
    level names), loaded when the player overlaps it -- plus World
    Partition cells. Those actors live in `Content/__ExternalActors__/`,
    which is STILL not exported, so the true per-quest streamed-chunk set
    cannot be listed. The panel now says this outright instead of letting
    "Areas loaded" imply knowledge we don't have.

So the honest answer to "are the area chunks loaded, or the safe
areas/warp terminals?": the exported data defines the TERMINALS. The
SA_ ids happen to double as the Field Map's own area keys (DA_MapPiece is
keyed by them), which is why they resolve to areas so cleanly -- the
terminal set is a faithful map of the quest's reachable FOOTPRINT, but it
is not the streaming manifest, and the streaming manifest is in the one
folder we still don't have.

Panel retitled "QUEST TERMINALS", with the source path, the SDK type, and
the streaming caveat stated in-place.

## 57. Where the chests actually are (and why no export will show them)

Investigated the Maps tree properly (163 level JSONs) instead of
assuming. Two of my earlier claims were wrong and are now corrected:

- **WL01 is NOT World Partition.** `PL_WL01` is a WORLD COMPOSITION map
  streaming 122 sublevels (96 AlwaysLoaded + 26 Dynamic); 105 of them ARE
  in the export. WL02 is the World Partition one (`PL_WL02_WP`) and isn't
  exported at all.
- **The chests are in none of them.** Searched every exported level: the
  chest ids (TB_*) appear NOWHERE outside DT_FixTBoxTable and
  DT_ItemLotTable. Not one map file contains a chest id or a TBox actor.
  The gameplay level that does exist (`LV_WL01_Global_Gimmick_GP`) holds
  33 terminal orbs, 31 safe areas and boss areas -- but zero chests.

The SDK explains it. A chest is `ARODTBoxBase : ARODGimmickBase`, and its
id is `FName LocatorName` -- assigned by an `ARODCMNGimmickLocator`,
collected by `ARODLocatorStorage`. The `RODLocatorStorage` actors in the
export are EMPTY shells (RootComponent only): the locator actors that
carry the positions are not in the packages we have. DT_FixTBoxTable
itself carries only `ItemLotTableKeys` -- no transform at all.

So the honest answer to "check the umap files": I did, and the
coordinates are not there to find.

**On x64dbg / Cheat Engine / a memory dump:** the instinct is right --
runtime is where the data lives -- but raw memory work is the hard way to
get it. These are reflected UObjects with typed properties, and UE4SS can
simply ask for them. Shipped `ChestLocatorDump` (a Lua preset): it walks
`FindAllOf("RODTBoxBase")` and the gimmick locators, reads `LocatorName`
plus `K2_GetActorLocation()`, and writes ChestLocations.json. No
signatures, no offsets, nothing to re-derive when the game patches.

The only real constraint is streaming: a chest exists only while its
level is loaded, so a dump is partial by nature. Hence the whole path
ACCUMULATES -- the mod gathers across a session, and the upload endpoint
MERGES rather than replaces, so sweeping the world in several passes
converges on all 526. Verified end-to-end with a simulated dump: upload
-> merge -> rebuild -> coordinates land on the chests (then cleared, so no
fake data ships).

## 58. Wwise audio: playback in the browser (and 3 sections unblocked)

The Blueprint/Widget/WwiseAudio exports landed. **64/66 sections now
pass** -- BP Inspector (6,318 widgets, 1,917 functions) and Wwise Audio
both unblocked; only Asset Skeletons (CHR/**/SK_*.json) and the index
that depends on it remain.

Two of my earlier assumptions about Wwise were wrong:
- The tree is at **Content/WwiseAudio** -- a SIBLING of Content/ROD, not
  inside it. The section's rawInput pointed at ROD/WwiseAudio, so it
  could never have run even with the data present.
- Events DO carry their media: `EventCookedData.EventLanguageMap` gives
  SoundBanks and media paths. 10,233 events, 8,548 with media.

Media had to be matched by **wem ID, not path**: an event references
`Media/26/2628378.wem`, but the LOCALIZED file lands at
`Media/English(US)/26/2628378.wem`. Path-matching resolved 19% of refs;
ID-matching resolves 34% -- and, crucially, gives **5,748 events a
COMPLETE set of files** (vs 0 by path). The id IS the identity; the
folder is just storage.

**Playback.** Every .wem here is Wwise Vorbis -- format tag 0xFFFF,
checked across the export rather than assumed. No browser plays it, and
ffmpeg cannot decode it ("no decoder found for: none"). vgmstream can.
So:
  * **Download always works** -- raw .wem, zero dependencies.
  * **Play** decodes server-side via vgmstream (-> WAV), re-encodes to Ogg
    when ffmpeg is present (~5x smaller; browsers play both), and caches
    the result so each file converts once. Verified end-to-end on real
    game audio: a VO line decodes to a 4.7KB Ogg and plays.
  * With NO decoder installed, the view says exactly that, with the fix --
    rather than shipping a Play button that silently does nothing.
`tools/get_vgmstream.sh` fetches the binary (not vendored: third-party
license, its own release cadence, and a pinned stale copy would be worse
than fetching the current one).

The 33,609 media refs with no file are shown as "not in this export" per
entry -- the game references them, so they belong in the list; what we
lack is the audio, and saying which is the useful part.

## 59. GimmickDump v2: Quest > Chunk > Gimmick, and pins on the map

The v1 chest dump validated cleanly -- all 8 captured ids match
DT_FixTBoxTable exactly, and all 8 fall INSIDE their area's own map
bounds (checked, not assumed: a pin whose id says Plains1_1_01 but whose
coordinates land outside that area's texture would be silently wrong).

The user's own numbers exposed the real constraint: standing in the
Plains safe area captured 3 of its 8 chests. Actors spawn per STREAMING
CELL, and a named area spans several. So sweeping means walking ground,
not visiting areas -- which is exactly why v1 (chests only) would have
cost a second full sweep for every other gimmick type. v2 fixes that
before the travel is spent.

**GimmickDump v2** walks all 20 ARODGimmickBase subclasses in one pass:
chests, town chests, side-quest trinkets, seals, sealed arks, arks, lore
tips, gift pillars, map pins, quest terminals, terminals, signposts,
doors, barriers, breakables. The generic bases are scanned LAST, so the
town Smithy and Item Seller (which the SDK gives no class of their own)
are still captured -- tagged honestly as "accessible" rather than
mislabelled as something specific. Ids come from whichever field the SDK
actually declares (LocatorName / ID / SubQuestID), never invented. Scan
interval defaulted to 20s as asked.

The context that was missing:
  * **chunk** -- parsed from the ACTOR'S OWN full name (the level package
    it lives in), not from where the player was standing. The difference
    between knowing and guessing.
  * **questId** -- URODQuestManager:GetQuestID() at capture time.

Pipeline: new `gimmick_locations` section builds Gimmicks.json + a
**Quest > Chunk > Gimmick** tree, pushes real coordinates into Chests.json
AND into WorldMap.json's embedded chest copies (which are built before any
dump exists, so they'd otherwise keep drawing the approximate ring for
chests we now know exactly). Chests are deliberately NOT added as generic
markers -- the map already draws them from Chests.json with a loot popup,
and double-pinning would lose that.

Honest limits kept: `questId` is the quest ACTIVE when a gimmick was first
seen -- a capture circumstance, not ownership, and labelled as such. Area
is parsed from ids that encode one (chests always do); for gimmicks whose
ids don't, area is left NULL rather than inferred from proximity. A wrong
pin is worse than no pin.

Verified with the real 8-chest dump: 5 of 8 chests in Plains1_1_01 now
pin at true coordinates, the other 3 remain dashed approximations. 65/67
sections pass.

## 60. "Is the Lua updated?" -- it was, and that's the bug

The user looked at the Lua Scripting view and saw only the chest preset.
The GimmickDump preset and gimmick_dump.lua WERE both in the shipped zip
(verified by unzipping it). So the code was right and the experience was
wrong, which is the worst combination -- it makes a person doubt a
delivery that actually happened.

Root cause: index.html carried a HARDCODED cache-bust stamp
("?v=20260712") on all 46 script/css tags. I'd bumped it once, then
edited lua-scripting.js repeatedly across later sessions WITHOUT bumping
it again. Any browser holding the old file had no reason to re-fetch. A
number a human has to remember to bump is a number that will eventually
be forgotten -- and the failure is silent and looks like "the feature
wasn't shipped".

Fixed by DERIVING it: the server computes ASSET_VERSION at boot as a hash
of every app asset's mtime+size, and rewrites index.html's ?v= stamps on
the way out. Change any file, redeploy, and the URL changes by itself.
There is nothing left to remember. Exposed at /api/asset-version, and
logged at startup.

Also fixed while in there: the static handler had TWO `setHeaders` keys
in one object literal, so the first (the HTML-specific one) was silently
discarded by JS. Dead code that looked load-bearing.

Verified against the running server: it serves 6 presets including "Dump
ALL gimmick locations", gimmick_dump.lua returns 200, and the template
scans all 20 gimmick classes.

## 61. Gimmick pins: the game's own icons, and one inference refused

414 gimmicks from a real sweep: 106 sequence_ctrl, 73 terminals, 55
accessible, 54 lore tips, 44 seals, 40 chests, 12 barriers, 10 subquest
trinkets, 9 town chests, 8 signposts, 3 quest terminals.

**Area attribution.** My first regex was chest-shaped (anchored,
trailing number) and caught only chests. The area is actually encoded
ANYWHERE in most ids -- Seal_Plains1_1_01, Ctrl_Hills1_1_09,
BS_Hills1_1_02_5, SA_Forest2_1_03 -- so one general pattern lifts 248 of
414.

**And an inference I tested and then REFUSED.** For the remaining 166
(lore tips are bare numbers, trinkets are UAID blobs) the obvious move is
to resolve area from coordinates. I tried it: matching a point to the map
piece that contains it DISAGREES with the id on **74 of the 248 ids that
state their area outright**. The pieces overlap, so position is not
evidence of area. Coordinate-derived area attribution is therefore not
used at all; those gimmicks keep `area: null`. They're still DRAWN (on the
one area whose bounds-centre is nearest, flagged `positionDerived`) --
because "this pin is visible on this map" is a rendering fact, not a claim
about which area a thing belongs to. Two different questions; only one of
them has a trustworthy answer.

**Pins.** The game ships icons for nearly all of it: seal, ark, door,
sideQuestTrinket, townChest, treasureChest, searchTerminal, dungeon. Lore
uses Waypoint Pin (Common) as asked; anything unmapped falls back to
Waypoint Pin (Classic) -- a deliberate "we don't know the right pin yet"
rather than a confident-looking wrong one. Every mapped icon key was
checked against the export: all 12 present.

**Two anti-clutter decisions.** Terminals already exist as static markers
from the gates export, so dump terminals are skipped rather than
double-pinned (but they DO fill coordinates for any terminal the export
left at zero). And sequence_ctrl + accessible are internal logic actors --
barriers, boss triggers, area controllers, 161 in one sweep -- so they're
captured and listed but their layers start OFF; they'd otherwise bury the
chests and trinkets a player actually wants.

Position-derived pins were also collapsed from 665 to 236: bounds overlap,
so pinning on every containing area triple-drew everything.

## 62. Town gimmicks, World Overview pins, Recipes -> map

**The user's hunch about area:null was right, and the data proves it
without inference.** 41 of the 166 area-null gimmicks sit in chunks
PL_TOB / PL_TOLBANA / PL_HORNCA (+3 in LV_WL01_TOB_LD) -- town chests,
town lore tips, quest terminals, the Smithy/Item Seller accessibles. They
have no field area in their id because they aren't IN a field area.

No guessing was needed: each town's own `worldName` IS its level
(/Game/ROD/Maps/Main/WL01/TOB/PL_TOB), and the dump records the chunk each
actor came from -- so chunk "PL_TOB" IS town 001, by the game's own data.
44 gimmicks now carry a townId, and Gimmicks/_index.json breaks them down
byTown.

Worth being straight about the limit: town MAPS have no world-coordinate
transform (no bounds/texturePerPixel -- they're images with normalized
manual markers), so town gimmicks still can't be auto-pinned on the town
map itself. They're attributed and listed; pinning would need a transform
we don't have and I'm not going to fake one.

**World Overview pins.** worldComposites carry the same world-coordinate
bounds + texturePerPixel as the area maps and already route through
drawMarkers, so all 413 WL01 gimmicks now pin on the zoomed-out view --
INCLUDING the town ones, whose coordinates are perfectly real even though
their own town map can't place them. Note the world-level bounds test IS
used here, unlike the area-level one that got refused: at world scale the
two worlds don't overlap, so containment is unambiguous. Same technique,
different reliability -- worth the distinction.

**Recipes -> map.** A recipe is an ITEM (ItemName_TwoHandedSwordRecipe_12
is chest loot, distinct from the sword it makes), but ItemSources was keyed
only by FINISHED items, so a recipe couldn't answer "which chest holds
me?" -- despite 162 of the 245 being chest loot. Indexed recipe items in
the same pass (kind: "recipe") and pointed the Recipes view at the existing
sources panel, which already renders chest -> area -> "open on map" deep
links. Reuse, not a second copy of the same lookup that would drift.

## 63. Town map pins -- I was wrong twice, and both were mine

The user said the town icons still weren't showing. Two of my own errors,
not theirs.

**Error 1: I said town maps had no world-coordinate transform.** They do.
Town_XXX.json carries OverallMapInfo and MiniMapInfo, each with a
WorldWidth and a CenterWorldPosition -- a complete square world->texture
mapping. I had looked at the BUILT Towns.json (which didn't carry it)
instead of the raw export, and concluded from its absence that it didn't
exist. Absence in a derived file is not absence in the source. TOB's
numbers come out exact: 57344 world units / 1024 px = 56.0 units/px.

**Error 2, the actual cause: my dumper captured every town gimmick at
(0,0,0).** 22 of the 414 records sat at exactly the world origin -- 20 of
them in town chunks. Two causes, both mine: UE4SS's FindAllOf returns
Class Default Objects (never-placed template objects, which live at the
origin), and a real actor whose level is loaded but whose transform hasn't
been applied yet also reads (0,0,0) -- which is exactly what town gimmicks
do while you're out in the field. The dumper recorded that zero and marked
the actor "seen", so it never looked again.

Fixed at both ends:
  * Lua: skip Default__ objects outright; and if a location reads
    (0,0,0), do NOT record it and do NOT mark it seen, so the next scan
    retries and captures it properly once you're actually in the town.
  * Pipeline: reject (0,0,0) records anyway, because dumps already on disk
    still contain them. They were being pinned at the world origin.

With the junk gone: Hornca 11 pins, Tolbana 13 (lore tips, town chests,
quest terminals, warp terminal). TOB shows none yet -- every TOB capture
WAS one of the zeros, so it needs a re-sweep from inside the town.

The two town textures have DIFFERENT WorldWidths (MiniMap 81920 vs Overall
57344 around the same centre), so normalized positions are computed per
image variant. One transform for both would have put every pin subtly
wrong on one of them -- the kind of bug that looks like "close enough".

## 64. Lua batch 1 — the "easy" ones, and why two of them weren't

Three presets, all grounded in the SDK rather than guessed:

**PlayerSpeed (4x).** CharacterMovement.MaxWalkSpeed. The naive version --
write it once -- silently reverts the first time you sprint, because the
game rewrites your speed on every state change. So it re-asserts on a
100ms loop and LEARNS the base speed from any value that isn't its own
output, which is what stops 4x compounding into 16x the second time the
loop fires.

**AlwaysFullStats (HP/SP/Stamina + 4x max stamina).** Four of the user's
requests, one mod, because they are all the same mechanism. The catch:
these are NOT plain floats. The game uses the Gameplay Ability System, and
the SDK says so plainly:
    URODDefensiveAttributeSet : Health / MaxHealth   <- HP
    URODAvatarAttributeSet    : Soul / MaxSoul       <- SP
                                Stamina / MaxStamina
SP being "Soul" isn't a guess: the game's own SP bar is
URODHeroStatusSoulGaugeWidgetBase. Each attribute is FGameplayAttributeData
with BaseValue + CurrentValue; GAS recomputes CurrentValue from active
effects, so both are written and re-asserted on a timer.

The trap worth naming: ENEMIES OWN THESE SAME ATTRIBUTE SETS.
FindAllOf("RODDefensiveAttributeSet") returns every monster's set too --
topping those up would heal the entire world and make the game
unwinnable. Each set is matched back to the hero through its owner chain
(set -> ASC -> OwnerActor) and anything else is left alone.

**HotkeyUtilities (F8/F7/F9).**
  * F8 Col: uses ARODPlayerState::AddCol(), the game's OWN grant path, so
    the balance/UI/save all update. The request was a physical 9000-Col
    pickup at the player's feet; spawning an actor would look prettier and
    risks desyncing the total, so I did the honest version of the same
    wish and said so.
  * F7 level: URODUserInfo::Level. The real level is written to
    PlayerLevels.json BEFORE the override, keyed by save slot, so a crash
    can't strand you at 200. If the slot can't be read it REFUSES to
    overwrite an existing record -- filing a level under the wrong slot is
    exactly how someone loses one.
  * F9: ARODInGamePlayerController::OpenDirectingMapMenu() -- the actual
    warp map a Safe Area terminal opens.

Every {TOKEN} in all three templates verified against its declared params
(a stray token ships a dead script that only fails in-game).

## 65. Lua batch 2 — one shipped, three stopped at the SDK

**TownChest999 (shipped).** Hooks ARODChestBase::BP_OnOpenUI -- the town
chest's own open event. The class split is real and already visible in our
own data: the town chest is ARODChestBase while field treasure boxes are
ARODTBoxBase, which is exactly the chest_town vs chest distinction the
gimmick dump surfaces. Quantities are set on URODAvatarItemManager's Items
and MaterialItems (FPossessItem -> FStorageItemData -> FItemDataBase, whose
`Num` is the quantity). SET, not topped up, so a stack above 999 comes down
to it -- which is what "even if over 999" asks for.

Equipment excluded by default, on purpose: weapons and armour are unique
instances with their own upgrade state, and a stack of 999 of one sword
isn't a thing the game models. The toggle exists but is off, because
turning it on is likelier to corrupt an inventory than to help.

**The other three stopped, and it's worth being precise about why.** I
went looking for the hooks and they aren't there:
  * Item Seller: the live list is
    URODToolShopMenuWidgetBase::ToolShopContents
    (TArray<FToolShopDisplayContent>). That is a WIDGET's display array --
    injecting rows into it changes what's drawn, not what the game will
    let you buy, and purchases are validated against the shop data. A mod
    that shows 61 consumables you can't actually purchase is worse than no
    mod.
  * Smithy: no equivalent contents array found on any blacksmith widget.
  * All quests unlocked: URODQuestManager has NO unlock/open/release API
    at all. Availability comes out of save state, not a settable flag.

All three want the same thing: changed DATA (DT_ShopItemList's ShopList /
MerchantCreateList / BlacksmithCreateList, and the quest table), not
changed behaviour. The right instrument for that is a MOD PAK carrying
patched DataTables -- which the game loads as its own data, so every
validation path agrees with the UI. UE4SS Lua is the wrong tool and would
only ever produce a convincing-looking UI over a shop that refuses to
sell. Recommended as the next step rather than shipping three mods that
half-work.

## 66. Lua feedback round — three real bugs, and one design mistake of mine

The user tested everything and reported back. Speed and stack-size worked;
the rest exposed problems worth recording precisely, because two of them
were the SAME bug wearing different clothes.

**The design mistake was mine.** They asked for these as separate mods; I
bundled F8/F7/F9 into one and HP/SP/Stamina into another "because they're
the same mechanism". That reasoning was about MY convenience, not theirs.
The cost was exactly what you'd predict: they couldn't run the working F8
without the broken F9, and when F9 opened a menu that couldn't be closed
they had to CRASH THE GAME to escape it. Every mod is now standalone. One
mod, one job.

**Bug 1 (the big one): the stats mods silently did nothing.** HP/SP/Stamina
are GAS attributes in AttributeSet objects. I resolved "which set belongs
to the hero" by assuming the set's Outer is the AbilitySystemComponent and
walking to OwnerActor. In Unreal the Outer is normally the OWNING ACTOR
ITSELF -- so the check never matched, no sets were found, and the loop
no-oped forever. Silently. Now the resolver accepts either shape AND logs
what it found, so a silent no-op can't recur.

**The same bug was already sitting in battle_healing.lua** (written before
we had the SDK): it did `hero.Health = x`. The character has NO .Health
field -- the write went nowhere. It also searched for "ROHeroCharacter"
(missing the D), and its "SP" recovery was actually healing Stamina.
Rewired to the real attributes; SP is Soul, per the game's own
URODHeroStatusSoulGaugeWidgetBase.

**Bug 2: the level swap didn't stick, and the user's own diagnosis was
right.** Col worked because AddCol() is the GAME'S grant function.
The level swap poked URODUserInfo::Level directly -- a value the game
recomputes from EXP, so writing it changes a number that gets overwritten.
Replaced with ARODInGamePlayerController::ServerDebugAddHeroExp(), the
game's own EXP grant: level-ups, stat points and UI all follow for free.
The lesson generalizes: prefer the game's own verb over poking its nouns.

**Bug 3: the fast-travel menu opened but was unusable and unclosable.**
OpenDirectingMapMenu() was called out of context. That menu is opened BY a
Safe Area terminal, which supplies the widget's state and owns its close
path; calling the opener without the opener's context yields a half-built
screen with no exit. Rather than fake the context, the mod now does what
was actually wanted: find the nearest SA_ terminal and teleport there. No
menu, so nothing can trap you. WT_ town terminals are skipped (you don't
need it in town) and unplaced (0,0,0) actors are refused -- teleporting to
the world origin would drop you into the void.

**New from the user's own UE4SS console work:** the Character Creator is a
LEVEL (/Game/ROD/Maps/ROD/PL_CharacterMake), not a widget. Shipped as an
experiment with a double-press confirm and a blunt warning: it's a map
change, not an overlay -- it unloads your world, and the return trip is
unknown. Promising otherwise would be a lie.

## 67. Stop guessing: a probe, and the pattern in what fails

More testing, more silent failures: EXP grant, character creator, town
chest 999, inventory slots, all three always-100% mods. Speed works. Stack
size works. Attack speed seems to work.

**The pattern is the finding.** Everything that WORKS writes a plain
property (MaxWalkSpeed, stack size). Everything that FAILS either calls a
function or resolves an AttributeSet. That's not a coincidence, and it
means I've been guessing at what UE4SS can actually reach in this game --
then shipping the guess, then guessing again when it fails. Three rounds of
that is enough.

So the main deliverable this round is **DebugProbe**: a mod that changes
nothing and walks every assumption the failing mods rest on. Is the hero
findable, and under what class name (battle_healing looked for
"ROHeroCharacter" -- missing the D -- and silently did nothing for months).
Are the AttributeSets reachable, and WHO owns them (my resolver assumed the
AbilitySystemComponent; Unreal usually outers them to the ACTOR). Can a GAS
attribute be read? Written? Does the write STAY written? Are the game's
functions callable -- AddCol works, so which others do? Does the item
manager exist? Is RegisterHook accepted? It writes PlayerProbe.txt.

One log and every broken mod gets fixed from facts. Continuing to guess
would just be a slower way of wasting the user's testing time.

**KillNearby -- the user's own idea, and it may fix EXP too.** They asked:
"could we mimic the death of a basic enemy to award the experience?" The
game has exactly that, on the enemy:
    ARODEnemyCharacter::KillingBlow(ACharacter* Instigator, FGameplayTag)
That's the game's OWN death path. Called with the hero as instigator, the
kill, the EXP, the weapon proficiency, the drops and the quest counters
should all follow -- because we aren't awarding anything, we're telling the
game you killed something and letting it do what it always does. Same
principle that made AddCol work and the level-poke fail: **prefer the
game's verbs over its nouns.** Bosses are excluded by default: a boss
killed outside its scripted fight can strand a quest, and a stuck save is
worse than a slow fight.

**WorldLogger** -- logs map travel, streaming levels in/out, and actor
spawns. This is the mod that answers "what does the game actually do, and
when", which is the question behind almost every hard problem in this
project. The streaming-cell log in particular tells you exactly when a
gimmick sweep will capture something.

**Everything that doesn't work is now flagged EXPERIMENTAL in the UI**, with
the specific suspected cause and what would confirm it -- so a broken mod is
tracked rather than quietly rotting in the list looking finished.

## 68. The probe paid for itself immediately

The user ran DebugProbe and WorldLogger. Both worked, and the probe answered
in one pass what three rounds of guessing hadn't.

**Finding 1, and it's the big one: UE4SS returns a DUMMY UObject for a
property that does not exist -- not nil.** The probe asked for `hero.Health`
expecting a failure (the character has no such field) and got back
"UObject: 0000001B0FF31C18". So every `if x ~= nil` guard I have ever
written in these mods PASSES for fields that aren't there, and the write
then goes silently nowhere. That single fact explains the whole family of
"installs fine, does nothing" failures. Anything that must be a number is
now checked with type(v) == "number".

**Finding 2: an AttributeSet's Outer IS the actor.** 21 Defensive sets,
Outers being the enemy Blueprints themselves (BP_E004001_C...). No
AbilitySystemComponent hop exists. My original resolver looked for one and
therefore matched nothing.

**Finding 3: attribute writes DO work.** Health.CurrentValue reads 1280.0
and accepts a write. So the mechanism was never the problem -- the
resolution was.

**Finding 4: DebugAddHeroExp is CALLABLE but inert.** pcall succeeds, the
EXP doesn't move. It's a debug stub in the shipping build. Calling a
function successfully is not the same as it doing something -- and
RODUserInfo isn't found at runtime at all, so the level mod had nothing to
write to either. That whole approach is dead; KillingBlow (or a real
GameplayEffect) is the way.

**Finding 5: KillingBlow is callable but did nothing** -- almost certainly
the FGameplayTag argument (passing `{}` isn't a valid tag). So KillNearby
now DEFAULTS to "weaken" mode, which is built on the one thing the probe
actually proved: enemy Health writes work.

Every stat mod now WRITES THEN READS BACK, and says out loud whether the
value stuck. A mod that can't work will now say so instead of sitting there
looking installed. That's the real lesson from this whole arc: silence is
the enemy, not failure.

## 69. The Wwise bug was mine, and my own test path hid it

The user reported every audio file still showing "not in this export", and
gave the clue that solved it: Content/ contains ROD, WwiseAudio and
Localization as SIBLINGS (with Content itself under EchoesofAincrad, the
/Game equivalent).

An earlier session had added mergeMisplacedContentSiblings(), which MOVES
Content/WwiseAudio into Content/ROD/WwiseAudio -- correct at the time,
because the pipeline then expected it there. This session I fixed the
pipeline to read the real sibling path... and left the mover in place. So a
dashboard upload files 50,000 .wem exactly where the pipeline no longer
looks.

It survived because MY test path and the USER'S differed: I extracted the
zips by hand with unzip, so my builds always worked. The lesson is old and
keeps being true -- test the path the user actually takes, not the one
that's convenient to test.

Fixed three ways: WwiseAudio removed from the mover; a SELF-HEAL that moves
an already-buried tree back out (otherwise anyone who uploaded stays broken
forever and has to know to fix it by hand); and both the pipeline and the
audio server now accept EITHER location, so no upload path can break it
again. Verified by reproducing the broken layout and healing it.

## 70. Self-rebuilding tools/: builtin/ as the source of truth

The user runs the app in a TrueNAS container where files copied in from the
host are owned by the wrong user and are read-only to the app -- but
directories the RUNNING app creates are owned by it and writable. So they
want to delete tools/ and have the app rebuild it into a writable,
app-owned directory, pulling vendored scripts from a builtin dir and
fetching anything downloadable (vgmstream).

The design constraint that shaped everything: **the pipeline lives IN
tools/, so it cannot be the thing that rebuilds tools/.** Delete the folder
and the pipeline is gone. So the rebuild is done by the NODE SERVER, which
is still running, not by a pipeline section.

  * builtin/tools/ -- every script, vendored. Restored verbatim.
  * builtin/manifest.json -- external binaries to FETCH. vgmstream is not
    vendored (third-party, separately licensed, 6.5MB that shouldn't be in
    git); it's downloaded per-platform.
  * The Tools focus group is injected by the SERVER into the group list,
    and -- critically -- STILL APPEARS when tools/ is missing and the
    pipeline can't be queried at all. The one button you need doesn't
    vanish exactly when you need it.

vgmstream being optional matters: a restricted container network must not
fail the whole rebuild, so a failed fetch is logged and the scripts still
restore. The app works without the decoder (downloads always work; only
playback needs it).

Tested the real cycle end to end: server running, `rm -rf tools`, the
focus-groups endpoint returns only the Tools button, POST rebuilds 7
scripts + downloads vgmstream, the restored pipeline runs again and reports
all 10 groups, and audio preview flips to enabled. The folder is recreated
by the server process, so inside the container it's app-owned and writable
-- which was the whole point.

## 71. The community mods handed us the answer: ExecuteInGameThread

The user sent five WORKING community mods for this game (DropRateScaling,
AutoRiposte, Norescue, AincradEnemyFinder, AincradTerminalFinder). Reading
them took ten minutes and explained months of silent failure.

**Every one of them wraps its UObject work in ExecuteInGameThread.**

UE4SS runs Lua callbacks -- key binds, LoopAsync, hooks -- on ITS OWN
thread. The game's objects live on the GAME thread. Touching a UObject from
the wrong thread doesn't error: it quietly does nothing. That is precisely
the failure signature we chased for three rounds: mods that install, log
happily, and change nothing.

It also explains the SURVIVORS. The speed mod "worked" because
MaxWalkSpeed is re-read by the engine every frame anyway, so a sloppy
cross-thread write still landed. Stack size worked for the same reason.
Everything that needed a real call or a real state change -- EXP, the town
chest, the kill, the attribute writes -- failed. The pattern I spotted
("plain properties work, calls don't") was the right observation with the
wrong explanation.

All twelve mods now wrap their object work in ExecuteInGameThread.

**Second gift, and it's a big one:** DropRateScaling edits DATATABLES at
runtime:
    local dt = StaticFindObject("/Game/ROD/DataAssets/WorldAdmin/DT_ItemLotTable.DT_ItemLotTable")
    local rows = dt:GetRowMap()
That is exactly the capability I said didn't exist when I concluded the
shop/Smithy/quest injections needed a mod pak. They don't. A Lua mod can
edit DT_ShopItemList's rows in place. The mod-pak generator still has its
place (permanent, no UE4SS needed), but it is no longer the ONLY road.

The lesson is not subtle: when someone hands you working code in the exact
domain you're failing in, read it before writing another line.

## 72. Wwise audio: a real player, and downloadable wav/ogg

The play button "did nothing" because the old code fetched the whole file
as a Blob and set src to an object URL. A blob has NO HTTP range support,
so the browser can't seek and often won't report a duration until the whole
file is in memory. Replaced with a real <audio> pointed straight at
/api/audio/preview, which now serves 206 Partial Content -- so the browser
streams, reports duration, and scrubs like any other audio URL. The UI now
has play/pause, elapsed/total time, and a seek bar, with ONE shared audio
element (30 VO lines playing at once is not a feature).

Downloads now offer three formats: .wem (raw, no dependencies), .ogg
(decoded + re-encoded, ~5x smaller) and .wav (decoded, lossless). Converted
files are cached, so the second request is a file read.

Bulk conversion is a new OPT-IN pipeline section (wwise_convert). It is
deliberately in no focus group: 50,276 files take tens of minutes and
produce gigabytes, and making that part of a normal build would turn every
"rebuild the world map" into an hour-long job. The server converts on
demand anyway, so nobody ever HAS to run it.

## 73. A regression I shipped, and the ogg bug that wasn't about ogg

**First, a mistake I made and shipped.** When I rewrote the audio preview
handler I replaced everything between `preview` and `focus-groups` by index
slicing -- and the TOOLS REBUILD ENDPOINTS lived in that gap. I deleted
them and packaged it. The Tools BUTTON survived (it's generated in the
focus-groups handler), so the UI looked fine and the endpoint behind it was
gone. Restored, and the lesson is blunt: never splice by index across a
region you haven't read.

**The ogg bug.** The user reported .wem and .wav downloading fine, .ogg
failing, and playback dead -- but the .wav playing fine in VLC. That last
detail is what solved it: decoding works, so the problem is downstream of
vgmstream. hasFfmpeg() only checked that ffmpeg EXISTS. It doesn't check
that it can ENCODE VORBIS -- and minimal/distro-stripped ffmpeg builds
routinely ship without libvorbis. So the encode failed (no .ogg), and
PLAYBACK died too because preview PREFERRED ogg with no fallback.

My container has libvorbis. Theirs doesn't. Same shape as the WwiseAudio
bug: my test path is not the user's path, and that's twice now.

Fixed: canEncodeVorbis() actually asks ffmpeg for its encoder list (once,
cached); preview only prefers Ogg if we can genuinely produce one, and
falls back to WAV otherwise -- which every browser plays and which
vgmstream makes unaided. Ogg download now returns a clear reason instead of
a blank failure. And ffmpeg joined vgmstream in builtin/manifest.json, so
the Tools focus group can install a Vorbis-capable static build; the
rebuild now handles bare binaries as well as archives.

## 74. The five reference mods, recreated -- and what they unlocked

All five now exist as customisable presets, alongside a new logger:

  * DropRateScaling -- and reading the REAL table taught the thing that
    matters: each enemy's reward list contains a LotItemKey of "None" --
    the NOTHING slot -- and its weight is usually the biggest (Boar01:
    Material 1, Food 2, None 12). So raising drop rates means SHRINKING the
    None weight. Inflating item weights only changes WHICH item you get,
    not WHETHER you get one. That's the difference between a mod that feels
    like it works and one that does.
  * AutoRiposte -- bRiposteChance + ActivateRiposteSlashSkill, fired on the
    RISING EDGE so one window makes one counter.
  * NoRescue, EnemyFinder, TerminalFinder -- the last two dump JSON in the
    same shape as our gimmick dumps, so they can feed the database.
  * ShopStock -- the mod I said needed a mod pak. DataTable editing makes it
    possible after all.

**ProgressionLogger is the important one.** The probe found that
FindFirstOf("RODUserInfo") returns NOTHING -- which is why the EXP and level
mods had nothing to write to. But UserInfo isn't free-floating: it's held by
URODSaveLoadSubsystem.RODUserInfo. You reach it through its OWNER. That one
fact makes Level, Experience, GrowPoint and -- crucially --
WeaponExperienceData (a level+EXP pair PER WEAPON TYPE) all reachable. The
weapon-proficiency mod the user wanted is now possible.

On VIT/END/MND/STR/DEX/AGI/INT: they are NOT attributes in this game. They
appear nowhere in the SDK as fields. They're inputs the game converts into
the Base/Coef/Bonus values that DO exist (BaseATK/CoefATK/BonusATK,
BaseDEF/CoefDEF/BonusDEF...). So the logger dumps those outputs, and the way
to learn the mapping is empirical: snapshot, spend a stat point, snapshot,
diff. Same for Cardinal Rank -- it is named nowhere in the SDK, so rather
than invent a field, the logger hunts for it and tells you to diff across a
rank-up. Saying "I don't know where this lives, here's how we find out" is
worth more than a confident guess.

## 75. Testing the texture-channel hypothesis instead of agreeing with it

The user proposed a detailed model of the _S map (R = reflection, G =
material ID, B = AO, A unused) and the dual-UV routing. Agreeing would have
been easy and worthless. Two sources of ground truth existed: the pixels,
and the material graph.

**CONFIRMED, from the export itself:** TextureStreamingData records a
UVChannelIndex per texture, and it says BC -> UV1, S -> UV0, with every
shared detail map (Height, Dirt, DirtBuildup, Salamander, ScreenTone,
StarFX, AnalyzeMask) on UV0. The dual-UV theory was exactly right, and it is
now a fact rather than a guess.

**REVISED, from the pixels:** R and G both sit on exactly 127.1 and are
uncorrelated (-0.006); x^2+y^2 <= 1 holds for 99.92% of pixels. Two
independent artistic masks do not both land on 128 -- that is a normal
map's X/Y. B does NOT track the reconstructed Z (+0.08) and does NOT track
albedo, so it is an independent mask in blue. Alpha is dead. And there is no
_N map anywhere in the item tree. So the layout is more likely
normal-XY + one mask than reflection/materialID/AO.

**TWO OF MY OWN IDEAS DIED IN TESTING, which is the point:**
  * The switches (064_Fur, 128_Leather, 160_Wood, 224_Gold) look exactly
    like byte values, so I tested whether they were literal pixel values in
    a material-ID channel. No spikes at 64/160/224 in any channel. Dead.
  * I called the unit-length test "decisive" and then had to walk it back:
    R,G cluster near 128, so ANY such texture passes it trivially. It is
    necessary, not sufficient -- the "centred AND uncorrelated" pair is what
    carries the weight.

**A trap I nearly fell into:** the export has 15 "_S" PNGs, and I ran the
signature across them -- they are all UI SPRITES (T_ItemCategoryIcon_*_S,
T_ClassIcon_S), where _S means something completely different. Averaging
them in would have produced confident nonsense. tools/analyze_texture_maps.py
now flags and excludes them.

**Also new:** BC's ALPHA is not empty (bimodal ~150-200, 3.7% at zero).
Nobody had looked. Unknown what it carries.

Shipped tools/analyze_texture_maps.py so the question gets settled across
the whole item tree by measurement rather than argued from one sample.

## 76. The texture theory, closed -- and a modal that shows the evidence

The user supplied the full shield texture set (12 _S maps, 17 _BC) plus a
REAL normal map (Weapon_Shield_030_Nrm). That turned a one-sample hypothesis
into a settled fact.

The known normal map's signature: R=128.0, G=127.1, corr(R,G)=-0.020,
100.00% inside the unit circle -- and B = 255 with a standard deviation of
ZERO. It stores X and Y and throws blue away, because Z is reconstructible.

The game's 12 _S maps: R=127.5, G=127.2, corr=-0.005, 99.77% inside the unit
circle -- IDENTICAL -- but B is a bimodal mask (mean ~150, std ~90) and does
not correlate with the reconstructed Z (+0.002).

    _S = a normal map's X/Y, with the wasted blue channel repurposed as a mask.

Then the question that actually matters for the converter: can blue be
DERIVED? Tested curvature, edge magnitude, slope, flatness against the real
maps. Every correlation: |r| = 0.03-0.07. Noise. Blue is authored.

So tools/normal_to_s.py packs R/G/A correctly and REFUSES to invent blue. It
offers a constant, a mask you supply, or a curvature map explicitly labelled
"a starting point to paint over -- the game's real maps do not look like
this". Generating a plausible-looking blue channel would have been easy, and
would have quietly sent someone off to build materials on a fiction.

Also shipped: clicking any texture parameter in the Materials browser opens a
modal with the image AND the channel analysis beside it. The analysis is the
point -- "_S" looks like a specular map from its name and a normal map from
its colour, and it is neither. Showing the measurement next to the picture is
what stops the next person guessing from appearance, exactly as I did.

On scale: the user reports 18,396 textures / 17.6GB / 3,395 folders in a full
export. The modal therefore says "not exported yet" plainly when a texture is
referenced but absent, rather than rendering a broken image -- and no rebuild
is needed to add one, just drop the PNG at the same path.

## 77. numpy/Pillow: install where the app can actually write

The texture tools died in the user's container with "Needs numpy and Pillow:
pip install ... --break-system-packages" -- and running that by hand didn't
work either, because in the container the app cannot write to the system
site-packages and --break-system-packages is refused outright. My error
message was advice that could not be followed.

Fixed the way the rest of tools/ already works: the Tools focus group now
installs them with

    pip install --target tools/pylibs numpy pillow

which needs no root and touches nothing outside the app's own directory, and
the server puts tools/pylibs on PYTHONPATH whenever it runs a Python tool.
Same principle as the whole builtin/ design: the app builds what it needs
into a directory it owns.

**And I nearly shipped it untested.** My first "verification" reported
"python packages: all present" -- because THIS container has numpy
system-wide, so the probe short-circuited and the install path never ran.
That is the third time my environment has hidden a bug that only exists in
the user's (WwiseAudio's path, ffmpeg's missing libvorbis, now this). So I
forced the real path: installed into tools/pylibs, then ran the tool with
`python3 -S` (system site-packages disabled) and PYTHONPATH=tools/pylibs. It
worked on that footing, which is the only footing that matters.

The failure is also surfaced now: if PyPI is unreachable the rebuild still
restores every script and says plainly which tools are unavailable, rather
than reporting success and leaving a converter that errors on use.

## 78. "No module named pip" -- when the dependency IS the bug

The Tools rebuild reported: `python packages: FAILED -- /usr/bin/python3: No
module named pip`. Not "pip refuses to install", not "the network is blocked".
There is no pip in that container AT ALL. Every route I had offered was dead:

    pip install                          -> can't write to site-packages
    pip install --break-system-packages  -> refused
    pip install --target tools/pylibs    -> No module named pip

The user asked whether we could vendor the packages in builtin/. We could --
but numpy wheels are ~18MB, platform- AND Python-version-specific (cp311 vs
cp312 vs manylinux variants), so vendoring means guessing their interpreter and
shipping 20MB+ into git to support one guess. That's a bad trade.

The better answer is that the dependency itself was the bug. A PNG is
zlib-compressed scanlines with a five-filter predictor. The statistics these
tools compute are sums and counts. Neither needs a third-party library --
zlib, struct and array ship with Python.

So: tools/pngkit.py, a pure-standard-library PNG reader/writer (~180 lines,
handles 8-bit grey/RGB/RGBA/palette, which is every texture in this game).
Both texture tools now use numpy/Pillow WHEN AVAILABLE and fall back to pngkit
when they aren't. Verified the honest way -- by reproducing the user's
container (a python3 with -S so site-packages is hidden AND no pip) and running
the real endpoints against it:

  * converter: HTTP 200, valid PNG, and BYTE-IDENTICAL to the numpy output
  * analyser: correct on a real 2048x2048 texture -- R std 17, G std 23,
    corr(R,G) -0.006, 99.92% inside the unit circle: the same numbers numpy
    gives, to three decimals
  * cost: ~9s instead of ~1s for a 2048x2048 texture (it samples 1-in-4
    pixels and SAYS SO, because a mean over 260k samples differs from the
    full-image mean by well under 0.1 of a unit)

The rebuild still TRIES pip (and now bootstraps it with ensurepip if that's
all that's missing), because numpy is genuinely faster. But failing to install
it is no longer an error -- it's a note saying the tools will run slower. The
feature does not depend on it.

Three times now my environment has hidden a bug that only existed in the
user's. The fix that finally holds isn't a better install command -- it's not
needing one.

## Lessons learned

1. **Empirical cross-referencing beats single-source trust.** The ACV
   formula's exact behavior (per-stat flooring before summing) was only
   caught by checking a screenshot's displayed value against the raw
   math, not by reading the data tables alone. Always validate a
   derived formula against multiple independent real examples before
   trusting it.
2. **Signature-matching has a real failure mode: ties.** Any time two
   items can have identical observable properties, a matching method
   based only on those properties will eventually collide. The fix
   isn't to guess at the tie -- it's to find an independent second
   signal (here, Unique MOD names cross-referenced against screenshots)
   or to honestly flag the tie as unresolved. Both ties left
   unresolved by this method were later resolved by an authoritative
   source, which retroactively validated leaving them open rather than
   guessing.
3. **An authoritative source, once available, should fully supersede
   inference -- but verify it first.** The official localization table
   was trusted as ground truth, but only after confirming it agreed
   with every previously-verified name with zero conflicts. Had there
   been conflicts, that would have been a signal to investigate rather
   than blindly prefer the "official" source.
4. **Small-icon visual identification is unreliable without zooming.**
   The armor Upper/Glove icon swap stemmed from judging a shape at
   native 64x64px resolution. The fix going forward: always zoom 3x+
   before committing a shape-based mapping, and say so in the
   documentation so the next person doesn't trust a quick glance either.
5. **A "broken toggle" report can mean the toggle is fine but the
   states are confusingly similar.** Before assuming a reported bug is
   a logic error, reproduce the exact user action and check whether the
   underlying mechanism is actually working -- it may be a UX clarity
   problem (states that are real but visually identical in the current
   configuration) rather than a functional one. The fix in that case is
   better labeling/feedback, not different logic.
6. **Document confidence level alongside every fact, not just the fact
   itself.** Nearly every section of this project distinguishes
   "confirmed by data," "confirmed by screenshot," "confirmed in-game by
   user," and "inferred/guessed." This made it possible to know exactly
   which claims needed re-checking when new evidence (the localization
   table, direct user testing) arrived, instead of re-verifying
   everything from scratch.
7. **Never assume a previous category's localization wiring holds for
   a new one.** Across Monsters/Items/Lore/Characters, the
   name-resolves-here / description-resolves-there pattern was
   genuinely different FOUR times (DatabaseInfo+ST_DatabaseLocalizeList;
   the same slot but ST_GeneralLocalizeList for both fields; a direct
   top-level DescriptionKey field with no slot lookup at all). Checking
   each new category's actual source file before writing its builder —
   rather than copying the previous category's pattern and adjusting
   field names — caught all four divergences before they shipped wrong.
8. **A numeric ID-encoding formula validated against a handful of
   samples is not validated.** The Recipes produced-item-ID formula
   (`realId×1000+1`) matched 6 samples perfectly and was still wrong
   for 2 of 4 remaining categories once checked against all 245 rows.
   Parsing the actual embedded reference (the localization template
   string, in this case) instead of deriving it numerically avoided the
   problem entirely rather than requiring ever-more category-specific
   exceptions to a formula.
9. **A hand-rolled DOM mock that doesn't really parse HTML can pass
   when code is broken and fail when code is fine.** Several rounds of
   the Recipes-tab debugging session (§8) were spent trusting
   increasingly elaborate hand-built `FakeElement` classes in Node
   before reaching for `jsdom`, a real DOM implementation. The
   hand-rolled versions could not distinguish "the code is correct" from
   "the code is correct AND my mock happens to also be correct about
   this specific case" — when verifying DOM-producing code without a
   real browser available, prefer an actual DOM engine (jsdom or
   similar) over a custom mock from the first attempt, not the third.
10. **When a user reports "I don't see X" and your own re-verification
    keeps coming back clean, get the literal artifact the OTHER side
    has — don't keep re-proving your own copy is correct.** The
    eventual fix for §8's debugging session came from asking the user
    to paste the raw deployed file's contents directly, not from any
    further reasoning about what the code should produce. This should
    have been the second or third move, not the sixth.
11. **A cascading failure across many "independent" checks is a signal
    to look for ONE root cause, not many.** When the first version of
    the Build Dashboard's status check showed `weapons` failing AND
    nearly every later section depending on it also failing, the right
    move was tracing back to the single, earliest failure (a wrong
    `rawInputs` entry) rather than treating each downstream failure as
    its own separate problem. Relatedly: a hash mismatch against a
    STALE baseline snapshot from much earlier in a long session can
    look exactly like real corruption — re-establishing a fresh
    baseline and confirming genuine idempotency against it the actual
    content (not just a byte-level diff against an old snapshot) is
    what resolved a false alarm that otherwise cost two unnecessary
    file deletions before being caught.
12. **A suspiciously clean result deserves the same scrutiny as a
    suspiciously broken one.** The Build Dashboard's "unclaimed files"
    check initially reported 0 — a number that looked like success but
    was actually a basename-matching bug (the exact same class already
    fixed once before, in the same file, for the same kind of glob
    pattern) silently marking ~300 already-known-unsurveyed files as
    claimed. It was only caught by deliberately checking the result
    against a fact already on record elsewhere in this project's own
    documentation, rather than accepting a 0 at face value just because
    0 sounds like everything is fine. The same fix pattern recurring in
    a brand-new piece of code, written by the same hand that fixed it
    the first time, is also worth sitting with: knowing about a bug
    class doesn't automatically prevent writing a fresh instance of it
    under time pressure — only checking results against known answers
    reliably does.
13. **A "clean-looking" numeric range across a few samples is not the
    same as verifying every sample.** Sword Skills' first filter
    assumed IDs `*_001` through `*_010` were always the real range
    across all 6 weapon categories, based on the first category or two
    checked looking exactly that clean. Independently computing the
    real included/named counts per category (rather than trusting the
    assumed range and moving on) surfaced that Axe alone breaks the
    pattern (`*_006` is real but unnamed, `*_011` is real and named) —
    and fixing that surfaced a second, unrelated edge case
    (TwoHandedSword's Counter skill having a placeholder-LOOKING
    internal name) that a purely numeric fix would never have caught.
    Two independent verification passes against two different
    hypotheses, not one confident first pass, is what actually found
    both.
14. **A reasonable-sounding workaround isn't the same as the actual
    fix.** "Ship blank placeholder files so a fresh instance has
    something to load" was a genuinely sensible-sounding idea for the
    "Unexpected token '<'" report — but tracing the actual error
    (fetch getting HTML back instead of JSON) to its real source found
    a static catch-all route silently masking every missing-file 404 as
    a fake-successful page load. Placeholder files would have worked
    around that specific symptom while leaving the actual bug in place,
    and would have needed to stay in perfect sync with every file the
    app ever expects, forever, to keep working. Fixing the real cause
    (removing the route) took the same amount of investigation as
    understanding the workaround would have, and didn't leave a second,
    silent maintenance burden behind.
15. **Background processes started with `&` don't reliably survive
    across separate tool invocations in this environment.** A fix
    verified correct in complete isolation (a standalone Node script)
    still appeared to fail when tested through the real running
    server — with file timestamps showing a multi-minute gap no single
    request could produce. The fix was right the whole time; a stale
    server process from an earlier, incomplete test was serving the
    "genuinely clean" test instead. The fix: run start-server + make-
    request + verify-result + kill-server as ONE atomic shell command,
    not several separate ones relying on a background process to still
    be alive by the time the next command runs.
16. **A small mock test case can hide the exact bug a real one would
    catch — twice, in the same debugging session.** A hand-built mock
    ZIP for the misplaced-folder-merge fix used a single-level
    `Content/WwiseAudio/Events/...` structure, which happened not to
    exercise a bug that only showed up against the real archive's
    actual layout. Separately, the same mock's small size never came
    close to exposing that texture files were never being copied at
    all — a gap invisible until testing a genuinely complete, fresh
    pipeline rebuild end-to-end. Both were only found by testing
    against the real, ~330MB Content.zip directly, not a smaller
    stand-in built from assumptions about what its structure probably
    looked like.
17. **An unhandled `'error'` event on a Node EventEmitter doesn't fail
    quietly — it crashes the whole process.** Five separate `spawn()`
    calls across this codebase went unnoticed as a risk for months,
    because the binaries they depend on (`python3`, `cp`, `unzip`,
    `zip`) happened to always be present in every environment this
    project had been tested in. The first environment where one
    genuinely wasn't (`zip`, missing from a real deployment's
    container image) took the entire server down for every user, not
    just the one feature that needed it — a categorically worse
    failure mode than "this button doesn't work," discovered only
    because a real production log was shared, not from local testing
    alone. Worth remembering for any future `spawn()`/`exec()` call in
    this codebase: the `'error'` listener isn't optional defensive
    code, it's the difference between a failed request and a dead
    server.

---

## Conclusion / current state

As of this writing (re-verified directly against the live `Content/
ROD/` output this session, not copied from memory), the toolkit
covers:
- **Weapons**: 127/127 loaded, 121/127 named (official source), full
  ACV/ATK calculator with EX-MOD picker, validated against 3 screenshots
  + 12 xlsx data points.
- **Armor**: 70/70 loaded, 67/70 named (official source), Def + grade +
  mod display, no enhancement system (confirmed absent).
- **Equipment &gt; Sword Skills**: 67/67 loaded across the same 6
  weapon categories Weapons uses, 60/67 named (60/60 among the
  "normal" numbered skills — the 7 gaps are all Counter techniques or
  one confirmed name-less-but-real Axe skill). Per-category
  WeaponProficiency (0-10) unlock tier shown directly, confirmed
  separate from the Player tab's own informational proficiency slider.
- **Monsters**: 120/120 loaded, 27/120 named (the rest show raw
  EnemyType + ID with a toggle to hide them) — no combat stats or
  images exist anywhere in this export for any monster.
- **Items**: 148/148 loaded and named (Consumables/Materials/Key
  Items), two-paragraph descriptions, real per-item icons, two
  confirmed Database-menu exceptions handled honestly.
- **Items > Recipes**: 245/245 loaded, 236/245 produce a resolved item
  — cost, materials, recipe + produced-item name/description, all
  sourced and shown with explicit attribution.
- **World > Lore**: 177/177 loaded, named, and described — the best
  coverage of any category. 40 entries have no thumbnail (written
  notes, not landmarks).
- **World > Towns**: 10/10 loaded, 6/10 named (Floor 3's 4 remaining
  towns have no name in this export). Shows the literal level/instance
  loading identifiers (UE map path + teleport terminal ID) for each.
- **World > Quests**: 5/5 loaded and named (all Main category — Sub/
  Town quest type icons exist but no data files do), with dungeon name,
  partner, clear condition, and the literal start-gate/quest-asset
  loading path per quest.
- **World > Areas**: 179 loaded (176 official localization keys —
  identical set in all 13 languages — + 3 spawner-referenced unofficial
  `*_SA_02` keys, flagged), 176/179 named, 82 dungeon-linked via
  `{Rep_DungeonName_*}` templates, 109 with teleport-gate links from
  `DA_InGame.json`'s 192-terminal registry, 26 with level-placement
  scans (Maps/DNG present this build — a soft dependency recorded in
  the index as `levelScanAvailable`). "Golden Gates" remain an open,
  recorded question — see section 19.
- **World > Dungeons**: 17/17 loaded and named (all 13 languages),
  13 with gate chains (ERU_OKU/HFO_Ruin/HTE_FI/MGK_Test genuinely
  gate-less), 15 with linked areas, full generation-config slices
  (near-miss keys deliberately unassigned, see section 20), and DNG
  module levels attributed token-exact only (618 attributed / 721
  family-shared this build; soft dependency on Content-DNG.zip).
- **World > Gates**: 192/192 loaded, 191 named (the
  `WT_Mountaintop` key exists in no language), 170 SA / 22 WT, 122
  with coordinates, 117 with map pieces, 69 dungeon-attributed, town
  links via name-template join (towns' `TG_*` terminalID is a
  separate namespace — corrected mid-build, see section 20).
- **Monsters > Spawns**: 1,514 groups / 1,481 lotteries / 340 pop
  configs (WL01+WL02), 168 distinct enemy codes (45 database-named
  via the confirmed code link), reverse-indexed so the Pop→Lot→Group
  chain walks from any anchor. Health/Levels tabs deliberately NOT
  built — no Blueprints/ folder exists in the export (see section 21).
- **Monsters > Drops**: 242 reward rows (38 monster-linked via enemy
  code only, 8 debug), 104 of 1,013 item pools referenced (the rest
  serve future sections like Chests), 161 drop item keys localized in
  all 13 languages; equipment slots resolve through the data's real
  ItemKey fields, Cost/Col/Invalid shown raw. All percentages
  weight-derived and labeled as such.
- **Characters > NPCs**: 183 loaded (114 data files + 69 roster-only,
  38 debug-set), 75 with appearance parts (mesh refs into CHR/), 64
  with placed actions; 0 of 114 NameKeys resolve in any language
  (confirmed — no NPC localization exists to build, see section 23).
- **Characters > Active Skills**: 10/10 loaded with icons; names are
  internal developer strings (no localization family exists);
  §14's trigger-unconfirmed caveat carried over.
- **Characters > Ailments**: 9/9 named AND described in all 13
  languages (official tutorial pairs); mechanics not in this export
  (no status enum/table exists — see section 23); state icons shown
  as an unpaired inventory.
- **Items > Shops**: 6 shops, 59 stock entries, all 59 resolving 1:1
  to recipe ItemKeys via the Cost purchase-token map (shops sell
  recipes — confirmed, see section 24); shop→town mapping deliberately
  not made (count match only, no linking field).
- **Items > Chests**: 526 fixed treasure boxes across 106 locations,
  526 with resolved pools via the shared resolver Drops uses
  (retro-fixed Drops: unresolved slots 419 → 32); 522/526 locations
  match a registered gate's ID fragment (client-side join); 3 missing
  pool refs listed per chest; no placement coordinates in the export.
- **Modding Guides Init**: a create-only focus build (guides group)
  that provisions guides/, uploads/, the manifest, and the seeded
  guide up front — added after a real Docker EACCES (see section 26);
  guide endpoints now return actionable JSON errors on permission
  failures. All 22 list+detail views stack their preview under the
  list on small screens (inline column overrides converted to CSS
  custom properties so the media query wins — see section 26).
- **Modding Guides**: user-written Markdown guides with paste/drop
  inline screenshots; limits configurable in guides/manifest.json
  (20 guides / 20 images per guide / 25 MB per image / 10 MB per
  guide / allowEditing, all editable); one seeded example guide
  (Getting Started: Installing Unreal Engine) with per-step
  screenshot placeholders (see section 25).
- **Asset Inspector > Skeletons**: 494 mesh assets (477 SK_ skeletal /
  17 SM_ static) with _Skeleton / PHYS_ / _PhysicsAsset / _MorphData
  companions grouped by verified conventions; psk (285) / pskx (33) /
  uemodel (63) / blend (when uploaded) download buttons via the
  existing download-file endpoint (see section 27).
- **Asset Inspector > Animations**: 5,418 assets (3,030 sequences,
  2,199 montages, 88 blendspaces, 101 composites); psa (18) / ueanim
  (18) downloads; 3 orphan sidecars listed in the index.
- **Monster Stats UNLOCKED (next section)**: 174 enemy Blueprints with
  EnemyLevel/Attack/Defence + per-enemy CT_E level curves
  (MaxHealth/XP/Col, levels 1-301) and per-difficulty reward-lot
  links — see section 27.
- **World > Map**: interactive map, 124 areas in the piece registry
  (7 with exported textures), 122/192 terminals with real coordinates,
  26 markers, 8 floor overlays; pan/zoom + click-to-toggle legend;
  chests attach by location join (no coordinates exist); Bosses/
  Spawns/Materials/Objectives render disabled with the checked reason
  (see section 28).
- **Monsters > Stats**: 174 enemy Blueprints with Level/Attack/Defence
  + per-difficulty CONFIRMED reward-lot links; 169/174 with a real
  level curve (1-301) for 8 stats; resolves Spawns' "-1 = inherit"
  gap without changing what Spawns itself displays (see section 28).
- **World Map piece ordering**: RESOLVED — real bug found and fixed:
  piece filenames were reconstructed from array INDEX, not the
  entry's own PieceTexture field, silently pairing positions with the
  wrong texture in all 7 textured areas (non-alphabetical array
  order). Real mask textures + real map icons (found in a later asset
  drop) now wired in, replacing synthetic feathering and placeholder
  glyphs. Genuine thin-overlap areas still get an honest "gaps
  likely" badge (see section 31).
- **World Map legend**: 12 layers with real recolored icons (white =
  unconfirmed color, stated as such); draggable Waypoint pins
  (session-only); new World View mode (all areas, one canvas, real
  world coords, zero new data); new Towns/Dungeons modes (different
  simpler asset, reference images only, no coordinate overlay
  attempted) (see section 32).
- **AI Skill**: downloadable Claude Skill package
  (skill-downloads/ROD-EOA-Toolkit.skill) wrapping the toolkit's /api
  layer; new "AI Skill" button + modal in Data Coverage; asks for the
  toolkit's base URL in chat, tests connection, re-discovers
  endpoints live rather than trusting a frozen list (see section 32).
- **Map icons degrade gracefully without Pillow/numpy**: RESOLVED — a
  real Docker deployment crashed the whole "world" focus group on a
  missing PIL import; build_map_icons() now catches ImportError,
  prints an install command, writes an empty icon index, and returns
  cleanly; World Map falls back to text/symbol markers until
  installed. New requirements.txt documents both as optional (see
  section 33).
- **Map icons: padding/shadow tuning + distortion fix**: RESOLVED —
  icons filled only 67-71% of their canvas at marker render size
  (looked shrunken/off-center); tightened shadow offset/blur and
  cropped to content bbox. The crop made icons non-square, which
  exposed a real distortion bug in two marker-render paths lacking
  object-fit:contain (now fixed on all three render paths) (see
  section 34).
- **Map icon catalog: 26 icons** (Town, Dungeon Entrance, Search
  Terminal, Door, Elite Monster, Player, 6 Waypoint pin skins added)
  + **manual map markers**: new /api/map-markers/:mapType/:areaKey
  CRUD (server.js), map-markers/*.json per surface (999 cap), a
  reusable Add Marker form on all 4 map surfaces, click-to-set-
  coordinates, and real interactive overlays for Towns/Dungeons
  (previously plain images). Fixed a stale-duplicate-list bug where
  WorldMap.json's icon registry didn't pick up the expanded catalog
  (see section 35).
- **Manual marker UX fixes**: RESOLVED — delete list wasn't
  refreshing after add (real bug, fixed with a proper onChange split
  between map redraw and list refresh); added a live dashed-preview
  pin that follows the form's icon/X/Y before submit; added a
  diagnostic banner when the icon registry is empty, pointing at the
  Pillow/numpy install fix rather than leaving "fallback symbols" as
  an unexplained mystery (see section 36).
- **Map icon recoloring now needs ZERO dependencies**: RESOLVED — a
  deployment genuinely couldn't install Pillow/numpy (no Dockerfile
  of this project's own, no persistent way to install into a running
  container). Wrote a pure-stdlib PNG decoder/encoder (zlib + struct)
  and a pure-Python box-blur recoloring path, verified against all 26
  source icons' actual format first; PIL/numpy now used only as an
  optional speedup when present. Verified with PIL force-disabled
  end-to-end (see section 37).
- **World Map**: hide/show toggle for the placement preview pin;
  default preview icon changed to Waypoint Pin (Common) (see
  section 38).
- **Weapon/Armor/Item "Sources & Crafting" panels**: new
  `item_sources` pipeline section combines Recipes/Chests/Drops/Shops
  into one per-item cross-reference (recipe+cost+materials, shop,
  chest locations, monster drops, used-as-material-in), shown in all
  three item preview panels via a shared renderer. 303/345 items have
  a known source; 42 explicitly say they don't (see section 38).
  Icons next to every listed item, and long lists use an inline
  "+N more" expander instead of nested scrollboxes (see section 39).
- **World Map chest contents**: Field Map area view now shows each
  chest's actual resolved contents (icon, name, quantity, share %),
  not just chest IDs — reuses the Chests section's own resolved pools
  as the single source (see section 39). RESOLVED regression: the
  chest list vanished entirely on any instance with a stale
  WorldMap.json (no fallback for the old field shape) — now falls
  back to the bare-ID list with an explicit "re-run the build" note
  instead of silently disappearing (see section 40).
- **Characters > Player**: Bonus Modifiers panel (DA_AttributeModification,
  7 stats/79 breakpoints/19 effect types, below Equipped Gear) +
  Sword Skills panel (proficiency-filtered, also below Equipped
  Gear) + an additive After Modifiers calculator under Weapon
  Proficiency (Bonus Modifiers + 4 EX-MOD picker slots, matching a
  weapon's real max + listed Unique MODs, never altering the existing
  baseline). Symbol-only +/− stat buttons at 1/10/100 magnitudes
  (positioning conveys size; real clamping fix so +100 can't
  overspend Grow Points), Stat Reset, and full Reset (see sections
  41-42).
- **DataTable/DataAsset → CSV export**: new Build Dashboard panel,
  UE's own struct/array CSV convention reimplemented and verified
  against real nested DataTables (1013-row DT_ItemLotTable exact
  round-trip); DataAssets get a labeled best-effort single row (see
  section 42).
- **Read-only REST API** (`/api`): static resource tree
  (`tools/build_api.py`, standalone) + live Express router
  (`api/routes.js`, one-line mount) + `APIRouting.md` full spec.
  16 route groups, all live-tested; structs/functions honestly
  reshaped to what the export actually supports (see section 30).
- **Build Dashboard — Focus Builds**: 8 named bundles runnable from
  the CLI (`--group=`) or dashboard buttons, dependency-expanded via
  the requires/produces graph (auto-inclusions printed);
  `--only=<key>` now dependency-resolving. Rebuilds run as background
  jobs with a polled live log — the synchronous-request 504 is
  structurally fixed (see section 21).
- **Characters**: 22/22 loaded, 9/22 named. 7 are also Partners with a
  full 200-level interactive stat slider, a confirmed weapon + (for 3
  of the 7) a named combat skill. Character Customization (face parts/
  voices/colors/presets) has no name field anywhere in this export.
- **Characters > Player**: a build simulator (no save data exists in
  this export), with a Growth-Points-driven 7-stat allocator confirmed
  against the user's own in-game screenshot (Growth Points total, and
  HP/Stamina/SP simultaneously at floor stats, both match exactly), a
  real weapon + 4-armor-slot picker reusing the existing 127-weapon/
  70-armor data, and a live Total ATK/Def that reuses the same
  `simulateTotalATK()` engine the Weapons section's own calculator
  uses rather than a new formula. See §10 above and Data Coverage's
  Player Build Coverage section for the full confidence breakdown.
- **Localization**: 13 languages structurally supported across every
  category above, each with its own per-category localization
  namespace and getters.
- **Tools**: JSON Inspector (weapons/armor only), DT Inspector (1037
  raw datatables/assets cataloged, Localization/WwiseAudio/Widget
  excluded by design), BP Inspector (366 Widget Blueprints, 841
  functions, 388 confirmed BlueprintCallable), Asset Inspector (166
  Materials — 145 instances with real named parameters + 21 base — and
  228 Meshes, cross-referenced into the existing Weapon/Armor data by
  the same item-ID scheme), Wwise Audio browser (4449 audio events
  across 30 categories), Data Coverage report (per-category breakdowns
  for every section above, plus a Mapping Files panel with two
  independent buttons per file — a manually-set Download link, and a
  Direct button auto-detecting the latest version from a backend-
  managed, version-numbered `mapping-files/` folder, greyed out
  whichever way nothing's available), Build Dashboard (a web control
  over the real pipeline's status/rebuild/upload, not a parallel
  system — 35 pipeline sections tracked, in real pipeline order, now
  with a 4-phase overview panel — raw export structure, schema
  validity, data points generated, live application — plus a
  Content.zip download and individual per-file downloads for every
  section's raw inputs. A fresh instance now genuinely bootstraps end-
  to-end: uploading the real Content.zip correctly repositions
  misplaced folders, copies all 1875 texture files, and creates the
  two standalone reference files with real defaults if missing —
  verified against the actual ~330MB archive, not a mock, with live
  progress feedback on both the upload and the rebuild itself. Every
  server-side `spawn()` call is now crash-safe — a real production
  crash from a missing `zip` binary (which, unguarded, took the whole
  server down, not just that one feature) led to `download-zip`
  switching to the `archiver` npm package entirely, the first real
  dependency this project has needed beyond `express`).
- **Visual**: rank-colored scan-frame animation (confirmed in-game for
  all 5 ranks), 3-state runtime toggle, animated Database background
  (3 layers), loading skeletons, a reusable source-attribution pattern
  (raw key + source tag) shared between Unique MODs and Recipes, a
  first-load Disclaimer modal re-openable from Data Coverage (plus a
  second, repeatable Budget Tracker popup there estimating the
  professional-team value of the effort behind this toolkit), a mobile
  slide-out sidebar drawer breakpoint below 768px.

**Known open items, recorded so they aren't re-discovered from
scratch**: 23 of 152 resolved Unique MODs have more than one effect
group in the raw data with no UI distinction between them yet (§7.3);
a standalone-Blueprint (`BP_*`, distinct from the Widget Blueprints BP
Inspector already covers) component cross-reference (an actor like
`BP_Console_ChestMenu` composing sub-widgets via named
`RODWidgetComponent`s, each with its own separate callable functions)
is a known, scoped-but-not-built BP Inspector enhancement; ~200 files
of Town-of-Beginning NPC data and enemy projectile/AoE mechanics are
present in the export but not yet surveyed; base Material assets'
scalar/vector parameter NAMES (as opposed to MaterialInstance, which
has them) are stored in an index-mapping structure judged too
unreliable to decode without risking a mislabeled value, so only value
COUNTS are shown for those; the Player tab's Weapon Proficiency curve
is real but deliberately not wired into any calculated total, and
Unique MOD effects on equipped armor (e.g. a Shield's GuardAgitation)
are shown elsewhere in the toolkit but not yet factored into the
Player tab's Def total. Two more sibling systems to Sword Skills were
identified and deliberately left unbuilt this round, not overlooked:
**Active Skills** (`DT_ActiveSkillList.json` — Recovery/Search/etc.,
icons under `StateIconImages/ActiveSkill/`; ActiveSkill1's exact
in-game trigger — possibly the healing crystal — is unconfirmed, its
short 5s cooldown doesn't obviously match a "limited charges refilled
at checkpoints" mechanic) and **status ailments**
(`StateIconImages/` — icons exist, no data table investigated yet).
The 5 sidebar nav icons for World/Items/Equipment/Monsters/Characters
(`Widget/Database/Texture/T_CategoryIcon_*.png`, hardcoded in
`index.html` from early in the project) reference files that don't
exist anywhere in the real export — confirmed by three separate
searches, including the actual Widget Blueprint JSON data for real
asset-path references, which suggests the real in-game icon may be a
composed Widget Blueprint rather than a flat texture at all. These 5
`<img>` tags currently render broken; not fixed this round since no
real substitute file was found and a text/Unicode fallback was
explicitly declined.


