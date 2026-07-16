# DESIGN.md — ROD Database Toolkit Visual Reference

This document is the single source of truth for the toolkit's visual
language: colors, typography, animation specs, and where every texture
asset lives. If a color or timing value looks wrong in the app, this is
where to check what it's *supposed* to be, and whether that value is
confirmed against an in-game screenshot or just a best guess.

Last updated: see TRANSCRIPT.md for the session this was written in.

---

## 1. Design language overview

The toolkit replicates two distinct visual modes seen in the game,
used for two different purposes in the app:

1. **Database / holographic mode** — cyan, angular, grid-lined,
   rotating radar circles. Used for the sidebar, navigation, page
   background, and list/browse chrome. This is the game's own
   "Database" menu aesthetic.
2. **HUD / equip-screen mode** — warm dark brown-black panels,
   semi-transparent, with colored stat readouts (HP green, Stamina
   orange, SP cyan, ATK gold, ACV red, MOD purple). Used for the
   weapon/armor detail panel, the ACV calculator, and EX-MOD picker —
   anywhere the app is showing "stats on an item," matching the game's
   own in-combat equipment screen.

These two modes intentionally don't blend into a single palette — the
app switches between them by section, the same way the game does.

---

## 2. Color tokens

All defined in `app/css/theme.css` under `:root`. Use the CSS variable,
never a hardcoded hex, when adding new UI.

### Database / holographic surface
| Token | Value | Use |
|---|---|---|
| `--db-bg-deep` | `#0F2429` | Page background, deepest layer |
| `--db-bg-panel` | `#1D4555` | Panel backgrounds |
| `--db-bg-panel-2` | `#16323D` | Secondary panel backgrounds |
| `--db-row-bg` | `rgba(105,127,134,0.35)` | Unselected list row |
| `--db-row-bg-hover` | `rgba(105,127,134,0.55)` | Hovered list row |
| `--db-cyan` | `#40CFD8` | Primary accent, active states |
| `--db-cyan-bright` | `#5BE8F0` | Brighter accent, headings |
| `--db-cream` | `#EFF1E9` | Header bar background (matches in-game cream header) |
| `--db-grid-line` | `rgba(135,200,210,0.12)` | Background grid lines |

### HUD / equip-screen surface
| Token | Value | Use |
|---|---|---|
| `--hud-panel-bg` | `rgba(40,36,31,0.90)` | Primary HUD panel background |
| `--hud-panel-bg-2` | `rgba(28,25,22,0.94)` | Darker HUD panel (modals) |
| `--hud-border` | `rgba(255,249,237,0.18)` | HUD panel borders |
| `--hud-text` | `#FFF9ED` | Primary text on HUD panels |
| `--hud-text-dim` | `#C9C3B6` | Secondary/muted text |
| `--hud-hp` | `#5EEB6D` | HP stat (confirmed in-game) |
| `--hud-stamina` | `#FFB200` | Stamina stat (confirmed in-game) |
| `--hud-sp` | `#00E0F0` | SP stat (confirmed in-game) |
| `--hud-atk-label` | `#FFD400` | "ATK" label specifically (confirmed in-game) |
| `--hud-acv` | `#E0314F` | ACV value text (confirmed in-game) |
| `--hud-mod` | `#A97FE4` | MOD value text (confirmed in-game) |

### Rank colors (D / C / B / A / S)
Used for: rank chips on weapon/armor tiles, class-rank badge icon
backgrounds, ACV table rank cells, and the equipment icon scan-frame
border (see §4).

| Rank | Token | Value | Confirmation status |
|---|---|---|---|
| D | `--rank-d` | `#5EEB6D` (green) | **Confirmed directly in-game** by user testing |
| C | `--rank-c` | `#5BC4E0` (blue) | **Confirmed directly in-game** by user testing |
| B | `--rank-b` | `#E0455F` (red) | **Confirmed directly in-game** by user testing |
| A | `--rank-a` | `#9B6FE0` (purple) | **Confirmed directly in-game** by user testing |
| S | `--rank-s` | `#F2C94C` (gold) | **Confirmed directly in-game** by user testing |

History: an earlier pass had RankD as a desaturated white/grey (sampled
from a screenshot that, in hindsight, likely wasn't showing a real
ranked item) and RankA as gold instead of purple. Both were corrected
after direct in-game observation. **If you're ever unsure whether a
rank color in this doc is confirmed or guessed, check
`Content/ROD/animation-config.json`'s `rankBorderColors._note` field —
it's kept in sync with the actual confirmation status.**

Items' `RarelityID` field reuses this exact same D/C/B/A/S system
under a different field name (confirmed B/A/C only across all 148
items, no D or S seen) — same `rankBadgeImg()`/`rankShort()`/
`rankColor()` JS helpers, no separate icon set or color table needed.

### Typography
| Token | Stack | Use |
|---|---|---|
| `--font-display` | `'Rajdhani', 'Orbitron', sans-serif` | Headings, labels, nav items, stat labels |
| `--font-body` | `'Inter', 'Segoe UI', sans-serif` | Body text, descriptions |
| `--font-mono` | `'JetBrains Mono', 'Consolas', monospace` | ItemKeys, numeric values, code/JSON |

Loaded from Google Fonts in `index.html`'s `<head>`.

### Corner radii
| Token | Value |
|---|---|
| `--radius-sm` | `2px` |
| `--radius-md` | `4px` |

Kept small and angular — the game's UI doesn't use soft/rounded corners
anywhere, so neither does this.

---

## 3. Layout structure

```
#app
 |- .grid-backdrop (animated background, see section 5)
 |- .shell
     |- aside.sidebar
     |   |- .sidebar-header        ("Database" + animation toggle)
     |   |- .lang-selector-row     (language dropdown)
     |   |- ul.nav-list            (World / Items / Equipment / Monsters / Characters)
     |   |- ul.nav-list#toolList   (JSON Inspector / DT Inspector / Wwise Audio / Data Coverage)
     |- main.main
         |- .topbar (breadcrumb)
         |- .content-scroll        (active view renders here)
```

Each route renders into `.content-scroll` via the view modules in
`app/js/views/`. Several top-level routes have their own internal
tab-of-tabs rather than being a single flat view — this is a
deliberate, repeated pattern (see `app/js/main.js`'s `renderRoute()`
for the full switch, and README.md's "Extending beyond weapons and
armor" section for why each category ended up with the shape it has):

- **Equipment** (`renderEquipmentRoute()` in `main.js`) — `.equip-subnav`
  toggles Weapons/Armor without changing the top-level route.
- **World** (`renderWorldRoute()` in `main.js`) — currently just a Lore
  sub-tab, structured so more World sub-sections (Areas, etc.) are just
  another button + case later.
- **Items** (`ItemsBrowserView`'s own internal `activeMainTab`) —
  Catalog (Consumables/Materials/Key Items) vs. Recipes, each with
  their own further category tabs underneath.
- **Characters** (`CharactersBrowserView`'s own internal `activeTab`) —
  Characters / Partners / Customization.

---

## 4. Equipment icon "scan frame"

The signature visual treatment for every weapon/armor icon — grid
tiles, the large detail-panel preview, and the zoom modal all use the
same `.scan-frame` class.

### Structure
```html
<div class="scan-frame" style="--frame-rank-color:...; --frame-rank-glow:...;">
  <span class="scan-bar"></span>
  <img src="..." />
</div>
```

### Visual components
1. **Background**: solid teal (`#5A8C8C`) with a repeating horizontal
   gradient creating fine scanlines (2px light / 2px dark bands).
2. **Border**: 2px solid, colored by the item's rank (see section 2 rank
   colors), with a matching soft glow (`box-shadow`).
3. **Corner cut**: top-left and top-right corners are cut at a 45deg
   angle via `clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%, 0 14px)`
   (`scan-frame-sm` variant uses `8px` for smaller grid tiles). Bottom
   corners stay square. This matches the in-game item icon frame exactly.
4. **Scan bar**: a translucent blue horizontal band
   (`rgba(120,200,255,0.35)` by default) that sweeps from the bottom
   edge to the top edge on a loop. See section 4.1 for full timing spec.

### 4.1 Scan bar animation

Controlled by `Content/ROD/animation-config.json`'s `scanBar` object:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master on/off switch |
| `color` | `rgba(120,200,255,0.35)` | Bar color/opacity |
| `travelDurationMs` | `1000` | Time for one bottom-to-top sweep |
| `pauseDurationMs` | `4500` | Gap after a sweep finishes before the next starts |
| `randomizeStart` | `true` | Stagger every icon's cycle independently (see below) |

Full cycle = `travelDurationMs + pauseDurationMs` (default 5500ms).
Implemented as a single CSS `@keyframes scanBarSweep` running on an
infinite loop; per-icon randomization is done by setting a random
**negative** `animation-delay` (0 to -cycleMs) on each `.scan-bar`
element individually via JS (`AnimationSettings.applyScanFrameTiming()`),
so each icon enters the loop at a different point without needing
separate keyframe definitions per icon.

**Runtime override**: a 3-state toggle button in the sidebar header
(next to "Database") cycles:
1. **Default** — exactly what `animation-config.json` specifies
2. **Forced Random** — scan bar on, randomized start, regardless of JSON
3. **Off** — scan bar disabled entirely (`body.scan-bar-disabled .scan-bar { display: none; }`)

This override is in-memory only for the current session; refreshing
resets to whatever the JSON specifies. Note that if the JSON already
has `randomizeStart: true` (the shipped default), states 1 and 2 are
behaviorally identical — the toggle's tooltip text explains which
behavior is actually in effect rather than implying a visual difference
that doesn't exist in that configuration.

---

## 5. Animated database background

Three independent layers, all inside `.grid-backdrop`, replicating the
in-game Database menu's moving background:

### 5.1 Rotating lens rings (`.bg-rings`) — v2, the "digital retina"
Static SVG (declared directly in `index.html`), redesigned against two
in-game Database screenshots after the first version's plain
concentric arcs "had the general idea but didn't look appealing"
(direct user feedback). The lens now has three parts:

1. **Dark sphere core** — a radial gradient (`#bgLensCore`) that
   deepens the center like the game's dark sphere, fading to
   transparent at the rim.
2. **Glow ring** — a wide, gaussian-blurred stroke (`#bgLensGlow`)
   plus a crisp 2px stroke at r=268, the "bright sphere lens" edge.
3. **Seven broken arc rings** (r 340 → 55), each a `<g>` of 2-3 arc
   `<path>` segments with deliberately irregular lengths and mixed
   stroke widths (2-5px, `stroke-linecap:round`) — uniform dashes
   read as a loading spinner, not a lens. Direction alternates per
   ring and speed rises toward the center:

| Ring | r | Direction | Duration |
|---|---|---|---|
| r1 | 340 | CW | 110s |
| r2 | 305 | CCW | 84s |
| r3 | 268 | CW | 62s |
| r4 | 205 | CCW | 48s |
| r5 | 155 | CW | 36s |
| r6 | 96 | CCW | 27s |
| r7 | 55 | CW | 20s |

Every arc endpoint is snapped exactly onto its ring's circle
(verified programmatically — 17/17 arcs within 2px — after
hand-placed endpoints drifted up to 9px off-radius and visibly bowed
the arcs). Positioned top-right of the viewport (`top:50%; right:8%`),
720x720px.

### 5.2 Sliding edge lines (`.bg-edge-lines`, populated by `background-fx.js`)
7 thin horizontal lines spawned on page load, each with independently
randomized:
- Direction (left-to-right or right-to-left, `slide-left`/`slide-right` classes)
- Vertical position (clustered near top 2-12% or bottom 88-98% of viewport)
- Width (20-50% of viewport)
- Speed (14-30s to cross)
- Start offset (negative delay, so they're already mid-flight on load
  rather than all starting from the same edge simultaneously)

### 5.3 "Powering on" monitor boxes (`.bg-monitor-box`, spawned by `background-fx.js`)
Rectangles that animate through: point -> 1px-tall line -> full-width
line -> full rectangle (opening), hold, then reverse (closing) before
removal. One spawns every 2.2-5.2 seconds at a random position/size
(60-220px wide, 30-120px tall). Implemented via two keyframe sets
(`monitorOpen` 1.6s, `monitorClose` 1.3s) driven by CSS custom
properties (`--target-w`/`--target-h`) set per-instance in JS, so a
single keyframe definition handles every random size. Boxes are
FILLED, not outline-only (changed on direct user feedback): a
translucent vertical-gradient wash slightly brighter than the page
background plus a faint inset glow — see-through, matching the game's
own monitor rectangles.

All three layers respect `prefers-reduced-motion: reduce` (animations
disabled, not just sped up).

---

## 6. Loading skeletons

`app/js/loading-skeleton.js` provides three reusable pulsing placeholder
shapes (`LoadingSkeleton.grid()`, `.detailPanel()`, `.statsPanel()`),
shown briefly during:
- Weapon/armor category tab switches (the grid + detail + stats panels
  all show skeletons for ~160ms before the real content renders)
- Language switches (a skeleton grid shows while the new language's
  JSON file is being fetched — this one's a genuine network wait, not
  just a cosmetic pause)

Visual: `rgba(255,255,255,0.06)` blocks with a 1.4s pulse animation
(`skeletonPulse`, opacity 0.4 to 0.7). Not used for every keystroke or
filter change — only transitions that genuinely resemble "new data is
arriving," so the effect doesn't become noise.

---

## 7. Texture asset folder structure

All textures live under `Content/ROD/...`, mirroring the game's own
export paths so new game data can be dropped in without restructuring.
These paths are populated by the pipeline's `textures` section (see
§8.15) copying wholesale from `raw-export/` -- this section documents
the naming CONVENTION every other builder's texture-path strings
follow, not a claim that copying itself happens automatically by
virtue of the convention alone.

```
Content/ROD/DataAssets/Items/Textures/
  T_Item_{PREFIX}1.png              <- ONE generic full-render per category
                                        (not per-item; used as fallback only)
  Thumbnails/{PREFIX}/
    T_Item_Thumbnail_{PREFIX}{ID}.png        <- per-item icon (large)
    T_Item_Thumbnail_S_{PREFIX}{ID}.png      <- per-item icon (small)
    T_Item_Thumbnail_{PREFIX}{ID}_Male.png   <- gendered (Upper/Lower/Glove only)
    T_Item_Thumbnail_{PREFIX}{ID}_Female.png <- gendered (Upper/Lower/Glove only)

Content/ROD/Widget/Database/Thumbnail/Equipment/
    T_Database_Thumbnail_Equipment_{DBPREFIX}{ID}.png  <- database-view icon

Content/ROD/Widget/Common/IconImage/
  ClassIconImage/T_ClassIcon_{D|C|B|A|S}.png   <- rank badge icons (ACV table)
  ItemCategoryIconImage/T_ItemCategoryIcon_{code}.png <- type-tab icons
  MODIconImages/...                             <- mod effect icons (unused so far)

Content/ROD/Widget/Database/Texture/
  T_CategoryIcon_{World|Item|Equip|Enemy}.png
  T_CategoryIconCharacter.png                   <- sidebar nav icons
```

### Prefix table (weapons)
| Category | `PREFIX` | Weapon count |
|---|---|---|
| One-Handed Sword | `WOS` | 22 |
| Rapier | `WRA` | 21 |
| Dagger | `WDA` | 21 |
| Mace | `WMA` | 21 |
| Two-Handed Sword | `WTS` | 21 |
| Axe | `WAX` | 21 |

### Prefix table (armor) — note the PREFIX/DBPREFIX split
| Category | Folder/file `PREFIX` | Database `DBPREFIX` | Gendered? |
|---|---|---|---|
| Upper | `Upper` | `Upper` | Yes |
| Lower | `Lower` | `Lower` | Yes |
| Glove | `Glove` | `Glove` | Yes |
| Shield | `S` | `Shield` | No |

**Shield is the one irregular case**: its thumbnail/full-render
filename prefix is `S` (`T_Item_Thumbnail_S3.png`), but its database
thumbnail prefix is `Shield` (`T_Database_Thumbnail_Equipment_Shield3.png`)
— a real inconsistency in the game's own export between its two icon
systems, reproduced faithfully rather than "fixed," since the actual
files on disk follow this split.

### Category tab icon mapping (visually identified, not data-confirmed)

**Weapons** — `WeaponTypeID` 1-6 is confirmed via data (every weapon in
a category shares the same ID), but which `T_ItemCategoryIcon_W{n}` file
the game displays for each isn't stated anywhere in the export. Current
mapping (best guess by icon shape):

| Category | Icon file |
|---|---|
| OneHandedSword | `W6` |
| Rapier | `W4` |
| Dagger | `W1` |
| Mace | `W5` |
| TwoHandedSword | `W2` |
| Axe | `W3` |

**Armor** — same situation, `Category` field values (6/7/8/9) don't
align numerically with icon suffixes. Current mapping, **corrected once
already** after a user caught Upper/Glove swapped in testing:

| Category | Icon file | Shape |
|---|---|---|
| Upper | `A1` | Torso/collar silhouette with shoulder pads |
| Lower | `A2` | Two leg/boot shapes |
| Glove | `A3` | Two hand/mitt shapes side by side |
| Shield | `S_S` | Shield outline |

If this area is touched again, re-verify by opening each icon file at
3x zoom and checking the silhouette directly — don't trust a quick
glance at 64x64px, which is exactly how the Upper/Glove swap happened
the first time.

### Texture override table
A small number of items have no dedicated art and reuse another item's
texture. Tracked in `build_pipeline.py`:

```python
TEXTURE_OVERRIDES = {
    ("WOS", 99): 1,   # Proto-Shortsword reuses WOS1 art
}
ARMOR_TEXTURE_OVERRIDES = {
    ("Upper", 99): 1,
    ("Glove", 99): 1,
    ("Lower", 99): 1,
    ("Shield", 99): 3,  # Shield has no id 1 -- its lowest real id is 3
}
```

Add new entries here if a future game update introduces another
reused-art item (the pattern so far: every category's `_99` "Proto-"
starter item reuses a low-numbered real item's art).

### 7.1 Texture paths for categories added after Equipment

Each category built after weapons/armor turned out to have a genuinely
different texture situation — documented per-category here rather than
folded into the prefix tables above, since none of them follow the
PREFIX/DBPREFIX split exactly the way armor does.

**Items** (Consumables/Materials/Key Items) — TWO separate texture
families, confirmed distinct (not one icon at two sizes):
```
Content/ROD/DataAssets/Items/Textures/T_Item_{U|M|KeyItem}{id}.png
  <- small in-world icon (used in list tiles)
Content/ROD/Widget/Database/Thumbnail/Items/T_Database_Thumbnail_Items_{Usable|Material|KeyItem}{id}.png
  <- large Database-menu thumbnail (used in detail preview + zoom)
```
A handful of IDs are missing a Database thumbnail specifically
(tracked per-category in `Items/Catalog/_index.json`'s
`missingDatabaseThumbnails`) — the placeholder fallback picks the
first ID in that category confirmed to actually have a file on disk,
not a hardcoded `id=1` assumption (that assumption was tried first and
found wrong for KeyItem specifically, where ID 1 itself is one of the
missing ones).

**Recipes** — only ONE texture per category (not per-recipe — every
recipe within a category shares the same icon, confirmed by
`ThumbnailID` being `"1"` on every row in a category):
```
Content/ROD/DataAssets/Items/Textures/T_Item_Recipe_{prefix}1.png
```
Same `prefix` values as weapons/armor's small-icon prefix (e.g. `WOS`,
`Upper`, `S` for Shield — Shield recipes use `S`, not `Recipe_Shield`,
matching the existing Shield-icon oddity rather than a new one).

**Monsters** — NO texture at all on any of the 120 rows
(`DatabaseImagetID` is a placeholder on every single one) — shown as a
live rotating 3D model in-game, not a 2D icon, so there's nothing to
display here and the UI says so rather than showing a broken image.

**World > Lore** — ONE texture family, large only (no small list
icon — the reference screenshots show plain text rows, image only in
the detail pane):
```
Content/ROD/Widget/Database/Thumbnail/WorldView/T_Database_Thumbnail_WorldView{id}.png
```
40 of 177 entries (a clean ID block, 5001-5040 — confirmed by name to
be written notes/messages, not landmarks) have no thumbnail anywhere.

**Characters / Partners** — Characters themselves have NO texture
(same 3D-model situation as Monsters). Of the 7 Partners specifically,
only 3 (Argo/Iori/Wyzeman) have a small supplementary portrait:
```
Content/ROD/Widget/Common/PartnerThumbnail/T_Partner_Thumbnail_{code}.png
```

**Characters > Customization** — face parts, color swatches, and
presets, ALL with no name field anywhere (pure visual, ID + thumbnail
or ID + hex color only):
```
Content/ROD/Widget/AvatarCustomize/Texture/Thumbnail/{PartType}/T_Avatar_Thumbnail_{PartType}{id}.png
Content/ROD/Widget/AvatarCustomize/Texture/Thumbnail/Preset/T_Avatar_Thumbnail_Preset{id}.png
```
Color palettes have no thumbnail at all — they're rendered directly
from a stored hex string (`MainColor.Hex`/`SubColor.Hex`), not an
image file.

---

## 8. Icon zoom modal

Clicking any weapon/armor icon (tile zoom button or the large preview)
opens `.icon-zoom-overlay`: a full-screen dim+blur backdrop with a
centered `.icon-zoom-box` containing a larger `.scan-frame` (same rank
border/scan-bar treatment as everywhere else), the item's display name,
and its raw `ItemKey`. Closes via the X button, clicking the backdrop,
or Escape.

`openIconZoom(item, resolvedDisplayName)` — the second parameter is
optional and was added when Lore needed it: by default the function
looks up the display name itself via `DataStore.getDisplayName(item.itemKey)`
(the weapon/armor localization), which is correct for every category
that existed when this function was first written. Any NEWER category
with its own separate localization namespace (Lore, and any future
category following the same "each category keeps its own getters"
pattern — see README.md's "Extending beyond" section) must pass its
already-resolved name in as the second argument explicitly, since the
default lookup would silently resolve to nothing and show the raw key
instead of a real name. Items/Monsters/Characters/Recipes all also
have their own localization namespace but don't currently call
`openIconZoom` from outside a weapon/armor-namespaced context the
default would break — if that changes, pass the name explicitly the
same way Lore does.

---

## 8.5 Source attribution pattern (Unique MODs, Recipes)

Introduced for the Unique MOD callout, then reused as-is for Recipes —
a small, repeatable convention for showing "where did this specific
piece of information come from" without it competing with the main
content for attention. Two pieces:

1. **The raw key, under the translated name.** `.mod-callout .mod-key`
   — small mono text directly under `.mod-name`, same visual register
   as `.preview-itemkey` (the weapon/armor ItemKey shown under the
   weapon name). Shows the literal string that appears in the game's
   own export/localization files (e.g. `BasicSwordArt`), so it's
   directly searchable even once the UI is showing a translated
   display name.
2. **A small source tag, to the right.** `.mod-callout-header` is a
   flex row (`justify-content: space-between`) with `.mod-callout-main`
   (name + key) on the left and `.mod-source-tag` on the right —
   `text-align: right`, `font-size: 9px`, `opacity: 0.65`, deliberately
   small and out of the way. Lists, on separate lines, which file/field
   the NAME came from (e.g. "Official game localization (Game.json)")
   and which file/field the NUMERIC EFFECTS came from (e.g.
   `DA_AttributeModification.json → PeculiarModificationData["BasicSwordArt"]`)
   — these are frequently genuinely different sources, not the same
   value duplicated, so both get their own line rather than being
   merged into one.

**`.mod-source-tag` only works inside a `.mod-callout` ancestor** (it's
declared as `.mod-callout .mod-source-tag`, a descendant selector
relying on the callout's flex-row header) — for source attribution
OUTSIDE that context (e.g. Recipes' detail panel, which isn't wrapped
in a `.mod-callout`), use the standalone **`.source-footnote`** class
instead: left-aligned, `font-size: 10px`, a thin top border separating
it from the content above. This split exists because an earlier
version of the Recipes panel tried reusing `.mod-source-tag` directly
outside a `.mod-callout` and it silently rendered with no styling at
all — caught before shipping, but worth knowing if this pattern gets
reused again: check whether the new context actually has the right
ancestor before reusing a scoped class, or use `.source-footnote`.

---

## 8.6 Items/Recipes/Characters tab-of-tabs pattern

`ItemsBrowserView` (Catalog/Recipes) and `CharactersBrowserView`
(Characters/Partners/Customization) both use the same internal
structure, distinct from how Equipment/World use `App`-level state in
`main.js`:

```js
const SomeView = {
  state: { activeTab: "firstTab", /* ...per-tab state... */ },
  render(container) {
    // creates #xTabBar + #xTabContent once
    this.renderTabBar();
    this.renderActiveTab();
  },
  renderTabBar() { /* writes button HTML, attaches click -> re-render */ },
  renderActiveTab() {
    document.getElementById("xTabContent").innerHTML = "";
    if (this.state.activeTab === "...") this.renderXTab(container);
    else this.renderYTab(container);
  },
};
```

Each sub-tab (`renderCatalogTab`/`renderRecipesTab`,
`renderCharactersTab`/`renderPartnersTab`/`renderCustomizationTab`)
builds its OWN nested DOM (coverage banner, its own category tabs,
list/detail panes) the same way a full top-level view would — they're
self-contained, not sharing list/detail elements with sibling tabs.
When adding a new sub-tab to either view, follow this same shape
rather than trying to extend an existing sub-tab's render function
with a conditional — it makes the existing sub-tabs's code harder to
reason about and was specifically avoided when Recipes was added
alongside the existing Catalog tab.

World's sub-tabs (Lore/Towns/Quests/Areas/Dungeons/Gates) remain the
OTHER pattern —
`App`-level state in `main.js` (`worldSubTab` + one button per tab in
`renderWorldRoute`), each tab a fully separate top-level view file.
`AreasBrowserView` (added as the 4th World tab) composes three
already-established pieces rather than inventing new ones: Lore's
text-only list rows (no image exists for any area — confirmed, so
nothing is faked), Towns' cyan "Level / Instance Loading" callout
style for its Teleport Gates table and level-placement lists, and the
Unique MOD/Recipe source-attribution tags. Its one new toolbar element
is a `<select>` filter (All / Dungeon-linked / No dungeon link / With
teleport gates / Unofficial keys) sitting next to the standard search
input, styled with the same `.search-input` class rather than a new
component. The dungeon-link callout uses the rank-A purple accent
(`rgba(155,111,224,…)`) to visually distinguish it from the cyan
level/instance panels. `DungeonsBrowserView` and `GatesBrowserView`
(5th/6th tabs) reuse the same composition — purple callouts for
cross-category links (linked areas / destination area / dungeon
gate), cyan for level/registry data (gate chains, module levels,
town terminal), `.pill` chips in mono for generation-config keys —
and the same one-or-two `<select>` filters in the toolbar (family;
floor + SA/WT type). Cross-tab joins in all three views go through
the SAME loaded `DataStore` lists the sibling tabs render from
(never a second copy of the data), which is what lets a gate's
detail pane show the live localized dungeon/area/town names.

---

## 8.7 Characters > Partners level slider

`CharactersBrowserView.renderPartnerDetail()` reuses the EXACT same
slider markup and live-patch pattern as the Weapons section's
enhancement slider (`.enhancement-slider-wrap`, `.slider-label`,
`.plus-val` — see `app/css/theme.css` for the shared styling, no
Partners-specific slider CSS was added). On `input`, only the level
number and the 8 stat table cells (`#partnerStat-{StatName}`) are
patched directly via `textContent` — never a full re-render of the
detail panel — so dragging the slider stays smooth and never steals
focus. If a future section needs a similar "drag to see values change"
control, copy this pattern (and the Weapons section's
`updateLiveValues()`/`updatePartnerLevelDisplay()` for the live-patch
side) rather than inventing a new slider treatment.

---

## 8.7a Characters > Player (build simulator)

A 4th `CharactersBrowserView` tab, structurally closer to a small
standalone calculator than to the other three. Two CSS-level design
decisions worth recording:

1. **Not a literal recreation of the in-game radial/circular character
   sheet.** The reference screenshot shows HP/Stamina/SP bars, then a
   circular silhouette with ATK/DEF flanking it and 7 stats arranged
   radially around the edge. Reproducing that exact geometry would mean
   bespoke absolute positioning fragile to font-size/zoom changes — a
   real maintenance cost for a single screen. Instead, the SAME grouped
   information architecture is kept (header → vitals → ATK/DEF →
   allocatable stats → progression bars) but rebuilt in this project's
   existing flat `.hud-panel` idiom, the same one every other detail
   pane already uses. `.player-header-bar` reuses the sidebar header's
   cream-bar + notched `clip-path` look (`--db-cream`, same
   `polygon(...)` shape) rather than introducing a new header style.
2. **Confirmed colors reused exactly, not reinvented.** `--hud-hp`/
   `--hud-stamina`/`--hud-sp`/`--hud-atk-label` already existed,
   confirmed in-game per §2's HUD color table — the vital bars and
   ATK/DEF numbers use these directly rather than picking new colors
   for what is visually the same concept (HP green, Stamina orange, SP
   cyan) just in a new layout.

**Live-patch pattern**: `updatePlayerLiveValues()` is the single
function every input handler (level slider, stat +/- buttons,
enhancement slider, gear selection) calls — it recomputes vitals (via
`interpolateCurve()` against `PlayerConfig.json`'s curves) and combat
totals (via the *same* `simulateTotalATK()` the Weapons calculator
uses) and patches only the relevant `textContent`/`disabled` states,
the same discipline as `WeaponsBrowserView.updateLiveValues()` and
`updatePartnerLevelDisplay()`. The one structural (non-patch)
re-render is the gear picker's open/close and the +/- buttons'
disabled-state pass, both cheap (a handful of elements, not the whole
pane).

**Gear picker**: an inline expand-in-place panel (`.gear-picker-panel`,
toggled per slot via `data-slot`), not a modal — clicking a slot row
toggles a search+list directly below it, reusing `.search-input` and a
new `.gear-picker-row` class. Weapon search spans every category via
`DataStore.getAllWeaponsFlat()`; each armor slot only searches its own
category's list (`DataStore.armorByCategory[slot]`), since e.g. Upper
gear can't go in the Lower slot. If a future section needs a similar
"pick a specific item from elsewhere in the toolkit" control, copy this
pattern rather than building a new modal component.

---

## 8.8 Pipeline section architecture (PIPELINE_SECTIONS / PipelineRunner)

`tools/build_pipeline.py`'s `main()` used to be a flat, hand-written
sequence of 23 function calls with comments explaining ordering
constraints (e.g. "recipe localization MUST run after weapon/armor AND
item localization"). This was refactored into an explicit, ordered
`PIPELINE_SECTIONS` list — same calls, same order, same arguments,
confirmed byte-identical output across all 5,400+ generated files
before and after — so that order, dependencies, and raw input files
are something OTHER code (the Build Dashboard) can introspect, instead
of being knowledge that only exists as code structure.

Each section dict has `key`, `label`, `builder` (the actual function),
`requires` (context keys passed as positional args, matching the
builder's own parameter names exactly), `produces` (context key for
the return value, or `None`), an optional `prepare(ctx)` callable for
the handful of sections whose real call did inline computation rather
than a 1:1 passthrough (e.g. `build_mod_coverage_report` needs a
MERGED weapons+armor dict), and `rawInputs` (the raw-export files this
section actually reads, confirmed against each function's own
`os.path.join(SRC, ...)` calls, not guessed).

`PipelineRunner` executes a contiguous range of sections
(`start_key`/`stop_key`, both inclusive) against a persistent context
dict, threading return values exactly the way local variables used to
flow through `main()`. **Running a sub-range only works if every
earlier section something in the range depends on already ran in a
prior invocation on the SAME runner instance** — it does not silently
walk backward to satisfy missing prerequisites, since doing so would
hide staleness rather than surface it (confirmed by testing: running
`--from=recipes` correctly fails with a clear `KeyError` on
`weapon_armor_loc`, since that section needs `all_weapons`, which
wasn't built in that particular invocation).

CLI flags `--only=<key>` and `--from=<key>` use this directly. A third
mode, `--status`, runs `get_pipeline_status()`: for each section, in
real pipeline order, an Export check (do the rawInputs exist) and a
Schema check (does actually running this section, right now, against
whatever's currently on disk, succeed) — note this is a REAL run, not
a dry-run heuristic, since every section's builder already writes
safe, idempotent output. `--status` redirects every builder's own
`print()` calls away from stdout before printing its final
`json.dumps()` result — confirmed necessary by testing: without this,
every section's progress/coverage print lines interleave with the
JSON and make it unparseable.

## 8.9 Build Dashboard

`app/js/views/build-dashboard.js` is a thin client over three
`server.js` endpoints (see README.md's "Build Dashboard API" section
for the exact contract) — it does not reimplement any pipeline
knowledge itself. The status grid's row order is exactly the order the
`/api/pipeline/status` response returns, which is exactly
`PIPELINE_SECTIONS`'s order, not re-sorted anywhere in the frontend.

The loose-file upload path (`uploadLooseFiles` /
`guessRelativePath`) matches an uploaded file's bare filename against
every section's `rawInputs` to guess its correct subfolder under
`raw-export/Content/ROD/`. Two things worth knowing if this gets
extended:

- **Glob-to-regex conversion must escape regex-special characters
  BEFORE substituting the wildcard**, not after. Converting `"*"` to
  `".*"` first and then trying to escape the rest is the wrong order
  and breaks if any literal `.` exists in the pattern (which is true of
  almost every real pattern here, since they're all `*.json`). The
  fix escapes everything except `*` first, then substitutes the
  still-bare `*` for `.*` last.
- **Bare/near-bare wildcard patterns are deliberately excluded from
  matching even when correctly escaped.** `WwiseAudio/Events/**/*.json`'s
  basename is just `*.json` — a pattern with no real fixed prefix at
  all. Even correctly converted to a regex, it matches almost any
  uploaded filename, which would silently misfile completely unrelated
  uploads into the Wwise Audio folder. `guessRelativePath` requires at
  least 3 fixed (non-wildcard) characters before the first `*` in a
  pattern for it to be considered a safe match target; this is why a
  truly novel/unknown file correctly falls through to the Unrecognized
  Files tray instead of being misfiled.

---

## 8.10 Build Dashboard 4-phase overview + downloads

`get_pipeline_status()` (Python) now returns `{ sections, overview }`
instead of a bare array — `overview` is computed ONCE per status check
and aggregates exactly what's already being verified per-section into
the dashboard's top-of-page panel, split into 4 deliberately distinct
phases rather than one blended "health" score:

- **Phase 1 (raw export structure)** combines two different kinds of
  check: the curated `rawInputs` list every section already declares
  (present/missing, deduplicated across sections), AND a genuine
  `os.walk()` of `raw-export/Content/ROD/` to find `.json` files no
  section currently claims at all. These are answering different
  questions — "is what the pipeline expects actually there" vs. "is
  there stuff sitting here the pipeline doesn't even know about yet" —
  and conflating them would hide the second, more interesting one.
- **Phase 2 (schema)** counts `schemaOk is not True` as "would fail to
  run through the pipeline," not just the literal `schemaOk is False`
  case — a section whose schema check was SKIPPED because its raw
  input is simply missing (`schemaOk is None`) still genuinely
  wouldn't build right now, and excluding it from both buckets would
  silently under-report real problems. Caught during this round's own
  testing by deliberately triggering a missing-prerequisite failure
  and noticing it didn't show up anywhere in the phase totals.
- **Phase 3 (data points generated)** required adding `expectedOutputs`
  to every `PIPELINE_SECTIONS` entry — each section's REAL output
  path(s), extracted programmatically from each builder's actual
  `save_json()` calls (not hand-typed from memory, which is exactly
  the kind of thing that drifted wrong before in this project — see
  the weapons `rawInputs` mistake in TRANSCRIPT.md §9). Localization
  builders write one file per language (13 files); rather than track
  all 13 individually, `expectedOutputs` for those points at the
  single `_manifest.json` each one writes last — the one file that
  actually summarizes "did this category's localization build
  succeed."
- **Phase 4 (live application)** is the one phase NOT computed in
  Python at all — `BuildDashboardView.computePhase4()` reads
  `DataStore` directly, since this view only ever runs inside the full
  app after `DataStore.loadAll()` has already succeeded. Recomputing
  the same weapon/armor/item/etc. counts server-side from raw JSON
  would risk silently drifting from what the rest of the app actually
  shows for those same categories — reading the live client state
  directly makes that impossible by construction.

**A real bug, caught by checking a known answer rather than trusting a
clean-looking result**: the first version of the Phase 1 "unclaimed
files" check used a basename-SUFFIX heuristic for glob-pattern
`rawInputs` entries (e.g. does the file's name end in the pattern's
fixed suffix). This is the exact same bug class already fixed once in
`guessRelativePath()` (§8.9 above) — a pattern like
`.../Shield/*.json` has the bare basename `*.json`, which strips down
to `.json`, a 5-character suffix nearly every JSON file on disk ends
with. The result looked clean (`unclaimedJsonFilesOnDisk: 0`) but was
wrong — it silently marked the ~300+ already-known-unsurveyed Town NPC
files as "claimed." Caught specifically because that file family was
already a known, named open item elsewhere in this project's own
documentation, so a suspiciously-too-clean `0` was worth checking
against it rather than accepting at face value. Fixed by actually
`glob.glob()`-matching each pattern against real files on disk (the
same mechanism the Export check itself already uses) instead of a
second, separate string-matching shortcut.

**Last build tracking**: `.last-build-status.json` (project root, not
inside `Content/ROD/`) is written by `build_pipeline.py`'s `main()`
itself on every REAL run — full, `--only`, or `--from` — not only when
triggered through the dashboard's rebuild endpoint, so it stays
accurate for anyone running the pipeline directly from a terminal or a
cron job too. `PipelineRunner.run()` now also stores its in-progress
`results` on `self.last_results` (not just returning them), so `main()`
can report exactly which section failed after an exception — the
original version tried to guess the failed section by searching the
exception's own text for a section's key/label, which almost never
worked, since most exceptions (`KeyError`, `FileNotFoundError`, etc.)
don't mention the section at all.

**Downloads**: `GET /api/pipeline/download-zip` zips
`raw-export/Content/` (cwd'd into `raw-export/` so the archive's
internal paths start at `Content/...`, matching the `Content.zip`
naming convention every prior upload in this project used) by
shelling out to the `zip` CLI — no new npm dependency, the same
reasoning `unzip` already used for uploads. `GET
/api/pipeline/download-file?path=...` streams one raw file
individually; both the status grid's per-section file links and this
endpoint use the section's already-computed `rawInputs[].path`
directly, so there's no separate path-construction logic to drift out
of sync with what `_check_raw_inputs_exist()` already validated.

---

## 8.11 Disclaimer vs. Budget Tracker: two deliberately different modal behaviors

Both live in Data Coverage's Reverse-Engineering Reference section and
share the same visual shell (`.disclaimer-overlay` / `.disclaimer-box`,
`icon-zoom-overlay` as the base z-index/backdrop layer), but they are
NOT the same interaction pattern, and that difference is intentional,
not an inconsistency:

- **`DisclaimerModal`** is a one-time acknowledgment GATE. It shows
  once on first load (persisted dismissal via `localStorage`), and
  deliberately has NO backdrop-click-to-close and NO Escape-to-close —
  the only way out is the explicit "I Understand" button. An
  accidentally-dismissed disclaimer defeats its own purpose.
- **`BudgetTrackerModal`** is a repeatable content VIEWER, opened fresh
  every time from its Data Coverage button. It has no persistence at
  all (every open re-renders from scratch) and DOES support both
  backdrop-click and Escape-to-close, matching the icon-zoom modal's
  UX instead of the Disclaimer's.

If a future modal is added to this project, decide which of these two
patterns it actually is FIRST — "can this be safely dismissed by
accident" is the deciding question — rather than defaulting to
whichever one was built most recently.

`BudgetTrackerModal`'s content itself (hour estimates broken into 5
disciplines, a stated $60/hr baseline, a 3-week forward projection) was
drafted and reviewed in chat before any code was written, per explicit
user request — see TRANSCRIPT.md §13 for the full reasoning behind
each number, including why an "actual AI cost" comparison line was
deliberately removed after the first draft (the user didn't want a
subscription-price comparison undercutting the value being
communicated, once real money started being spent on the project).

---

## 8.12 Sword Skills rich-text description rendering

Sword Skill descriptions carry a small, CONFIRMED CLOSED set of
in-game rich-text tags (`<SSYellow>`/`<SSCyan>`/`<SSGreen>`/`<SSRed>
...</>` for attack-type color coding, `<img id="TI_ATK"/>` for an
inline ATK icon) -- verified by scanning all 60 official descriptions
for every distinct tag actually used BEFORE writing the renderer, not
assumed from a couple of samples. `renderSwordSkillDescription()`
escapes the whole string first via `escapeHtml()`, then only converts
back the exact, already-known ESCAPED tag patterns into real markup --
so no unexpected character in the source text can ever be interpreted
as HTML, only these 6 confirmed patterns can. This is the same
"escape everything, then re-open a known-safe allowlist" approach used
nowhere else in this project yet, since every prior category's rich
text either had no tags at all or used the simpler `{Rep_X}` template
substitution pattern (Lore/Quests/Recipes), not inline markup.

The 4 color tags map to the EXISTING HUD stat color variables
(`--hud-atk-label` for SSYellow/Crush, `--hud-sp` for SSCyan/Severing,
`--hud-hp` for SSGreen/Sword Strike, `--hud-acv` for SSRed/Counter) --
not new colors invented for this feature, the same reuse-over-invent
approach the Player tab's vital bars already established for its own
HP/Stamina/SP rows.

`{BaseATK_1}`/`{ATKModifier_1}%`-style formula placeholders inside
descriptions are left as literal, unresolved text -- confirmed no
numeric BaseATK/ATKModifier source data exists anywhere in this
export before deciding this, not assumed. Showing the raw placeholder
honestly was chosen over either fabricating a plausible-looking number
or stripping the placeholder text entirely (which would silently
change the sentence's meaning).

Two real bugs were caught and fixed during this build by testing
against real data before shipping, not by inspection alone: the
list-row icon used a scoped CSS class (`.player-gear-slot
.gear-slot-icon`, only ever styled under that specific ancestor) as if
it were a generic, standalone class -- it would have rendered
completely unstyled here. And the detail panel's icon wrapper used a
guessed class name (`preview-icon-wrap`) instead of the real one
already established by Weapons/Armor (`preview-img-wrap`) -- caught by
grepping the actual CSS file for the guessed name and finding zero
matches, rather than trusting that a plausible-sounding class name was
correct.

---

## 8.13 Direct vs. Download: two independent buttons, two independent sources

Data Coverage's Mapping Files rows now show two buttons per file
type, and they were deliberately kept fully independent rather than
one falling back to the other automatically:

- **Download** is exactly the pre-existing manually-set external link
  from `dev-reference.json` -- unchanged behavior, just also
  explicitly greyed out (`.toggle-btn.disabled`, a new CSS rule) when
  the URL is blank, which it previously wasn't.
- **Direct** is a NEW, entirely separate source: whatever's actually
  sitting on the server's own `mapping-files/{ver}/{type}/` folder
  (see the README's "Adding a Direct-servable mapping file" section
  for the exact path convention). Greyed out when nothing's there.

Neither button's state depends on the other's. This was a deliberate
choice, not an oversight -- the point (per direct request) is "if a
Direct file exists, it's presumably the more reliable, always-current
source, but the external Download link should keep working exactly as
it always did regardless." Automatically hiding Download whenever
Direct becomes available, or vice versa, would have been extra
cleverness nobody asked for and one more thing that could get the
priority backwards later.

**Rendering sequence**: the Direct button always renders first in a
disabled "checking…" state (synchronously, with the rest of the page),
then `loadMappingFileStatus()` fires an async fetch to `/api/mapping-
files/status` and patches ONLY the Direct buttons once it resolves --
deliberately not making the whole Data Coverage page's `render()`
async just for this one small, independent feature, so the rest of
the (much larger) page never waits on this one network call. If the
fetch fails outright (endpoint missing on an older deployment, server
unreachable), Direct buttons simply stay disabled -- treated the same
as "nothing found," not surfaced as an error.

**No upload UI for these files, intentionally.** Per direct
specification: USMAP/IDA files are placed on the backend filesystem by
whoever manages the server, not through this app. This is a real,
deliberate scope boundary, not a missing feature -- building an upload
path for these was explicitly not asked for.

---

## 8.14 Fresh-instance bootstrap: degraded mode instead of a dead end

`App.init()` used to gate the ENTIRE app -- including Build Dashboard,
the one tool that could fix a data problem -- behind
`DataStore.loadAll()` succeeding. On a genuinely empty backend (no
`Content/ROD/` output yet), that was an unrecoverable dead end: no way
to reach the upload/rebuild UI without a terminal.

The fix has two independent parts, found by tracing a real reported
symptom (`Unexpected token '<'... is not valid JSON` on a freshly-
emptied instance) all the way to its actual root cause rather than
patching the visible symptom:

1. **The real bug**: `server.js` had a static `app.get("*", ...)`
   fallback route, added long ago "in case the app grows client-side
   routes later" (it never did -- confirmed there is no client-side
   routing at all). This silently served `index.html` for ANY
   unmatched request, including a genuinely missing data file --
   `fetch()` expecting JSON got an HTML page back instead, which is
   exactly what produces that specific parse error. Removed entirely;
   a missing file now correctly 404s.
2. **The actual UX gap**: even with #1 fixed, a real 404 on a core
   data file still means `DataStore.loadAll()` throws, and the app
   still needs to do SOMETHING sensible with that. `App.init()` now
   catches that specific failure, and instead of the old fatal-error
   screen, disables every nav item except Build Dashboard (reusing the
   exact same `.disabled` class/CSS already used elsewhere for
   not-yet-built sections) and drops the user straight onto it with an
   explanatory banner. Confirmed safe to do because `BuildDashboardView`
   never touches `DataStore`'s eagerly-loaded fields outside its own
   already-try/catch-guarded `computePhase4()` -- it only talks to the
   pipeline-status endpoints, none of which need any of this to have
   succeeded.

`renderFatalError()` is kept as a genuine last-resort safety net (an
outer try/catch still wraps the whole sequence) for anything actually
UNEXPECTED elsewhere in the same startup sequence -- it's no longer
reached by the specific "no data yet" case, which now has its own,
better-targeted handling, but a real safety net for truly unforeseen
failures is worth keeping rather than removing.

**Diagnosability**: `/api/mapping-files/status` was extended with
`_scanPath`/`_scanPathExists` (the absolute path the server is
actually scanning, and whether it exists from the server's own point
of view) after a report of Direct buttons staying disabled despite
files being placed under `mapping-files/`. Reproducing the user's
EXACT reported folder structure and filenames in this environment
found detection working correctly -- confirming the bug, if there is
one, is very likely a deployment-side path/volume-mount mismatch
(common in Docker setups) rather than a flaw in the detection logic
itself. Adding a direct, one-request way to compare "where the server
is looking" against "where the files actually are" resolves that class
of ambiguity without more back-and-forth guessing.

---

## 8.15 Build Dashboard: real progress feedback, and two silent data gaps

**"Looks hung" vs. "is hung"**: two genuine feedback gaps, found by a
direct report that Rebuild Full Pipeline "doesn't seem to be doing
anything" and a ZIP upload "seemed hung waiting... while it only said
Uploading…". Neither operation was actually stuck -- confirmed by
timing a real upload (6-17s depending on run) and a real full rebuild
(under 10s) against the live server -- the UI just gave zero visual
indication that anything was happening during that window, which reads
identically to a real hang. Fixed two ways:
- `triggerRebuild()`'s "Rebuild Full Pipeline" button was never
  touched by any render call at all (only per-section buttons checked
  `rebuildingKey`) -- it now disables itself and shows a live elapsed-
  time counter (`Rebuilding Full Pipeline… (Ns)`) for the duration of
  a real request, verified against the live server with the counter
  genuinely ticking from 0s to 2s+ during an in-flight rebuild.
- `uploadZip()` switched from `fetch()` (no upload-progress API at
  all) to `XMLHttpRequest`, which supports `upload.onprogress` --
  replacing the static "Uploading…" label with a live percentage and
  progress bar. Verified functionally correct against the real,
  ~330MB Content.zip (correct file count, correct `movedFolders` note,
  correct final panel), but jsdom's XHR implementation doesn't
  reliably fire `upload.onprogress` for a real file body -- a known
  limitation of that test environment, not something confirmable here
  the way everything else in this project has been. The API used is
  the standard, well-established one real browsers support; this is
  flagged as an honest gap in what could be verified here, not
  papered over as fully confirmed.

**Two silent data gaps, found only by testing the real, ~330MB
Content.zip end-to-end** (not a small mock -- see the README's
"Further fresh-instance bugs" section for the full account):
- No pipeline builder ever actually copies a texture file -- every one
  of them only ever constructs the PATH STRING pointing at where an
  icon should be. A new `textures` section, first in
  `PIPELINE_SECTIONS` (three other sections check texture existence
  against the OUTPUT tree to set `hasOfficialIcon`-style flags, so
  this has to run before all of them), now does the actual copy.
- `dev-reference.json`/`animation-config.json` are intentionally never
  touched by any builder -- but nothing ever created them either.
  `ensure_standalone_files_exist()` now does, with the real current
  default values, only if each file doesn't already exist -- verified
  by hand-editing one after a build and confirming the edit survives a
  second rebuild untouched.

**A methodological note on debugging this**: several confusing,
contradictory test results during this investigation (a fix that
worked in isolation but appeared to fail through the real running
server, with bizarre multi-minute timestamp gaps) turned out to be
caused by background server processes not reliably surviving across
separate tool invocations in this environment -- not a real bug in the
code being tested. Resolved by running start-server + request +
verify + kill-server as one single atomic shell command rather than
across several separate ones, which is now the standard pattern for
any test in this project that needs a live server.

---

## 8.16 A real server crash: unhandled 'error' events on spawn()

A real deployment's own container logs surfaced this:

```
Error: spawn zip ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:287:19)
...
Node.js v24.15.0
```

The `zip` CLI binary `download-zip` shelled out to wasn't installed in
that container. That alone would just be a missing feature, but the
actual bug was structural: NONE of this file's five `spawn()` calls
(`python3`, `cp`, `unzip` x2, `zip`) had an `'error'` listener on the
returned ChildProcess. Node's default behavior for an unhandled
`'error'` event on any EventEmitter is to throw -- which crashed the
ENTIRE server process, not just the one request that triggered it.
Confirmed this was the real mechanism (not just plausible) by
reproducing it directly: running the server with a deliberately
restricted `PATH` that excludes `unzip` crashed the process exactly
this way; adding an `.on("error", ...)` handler that resolves the
wrapping Promise instead of leaving it unhandled produces a clean HTTP
500 with an actionable message, and the server stays alive and can
still serve completely unrelated requests afterward -- verified both
halves directly, not assumed from reading the fix.

Two fixes, deliberately different in kind:
1. **Every remaining `spawn()` call now has an `'error'` listener** --
   the minimum fix, needed everywhere regardless of which specific
   binary might be missing in some environment this project doesn't
   control.
2. **`download-zip` doesn't use `zip` at all anymore.** Graceful
   failure isn't the same as the feature working -- the user still
   needs a working download. Replaced with the `archiver` npm package
   (pure JS, no external binary dependency, streams directly into the
   HTTP response instead of writing a full temp file to disk first).
   This is the first real npm dependency this project has needed
   beyond `express` -- a deliberate, narrow exception to the "avoid new
   dependencies, shell out to CLI tools instead" pattern used
   elsewhere in this file, made specifically because THIS is the one
   place that pattern actually caused a production crash.

**A real sub-bug inside the fix itself**: `archiver`'s latest major
version (8.0.0) turned out to be a from-scratch rewrite with a
completely different, class-based ESM API (`new ZipArchive(options)`)
instead of the classic, long-documented callable-function API
(`archiver('zip', options)`) every existing example and this code
assumed. `npm install archiver` pulled v8 by default and the very
first test crashed immediately with `TypeError: archiver is not a
function` -- caught before shipping by testing the real endpoint, not
trusting that "it installed successfully" meant "it works." Pinned to
`archiver@^7` instead (`^7.0.1` in package.json, which permits patch/
minor updates within v7 but not the incompatible v8), the long-stable,
widely-documented major version.

---

## 8.17 "Unrecognized Files" flagging: two bugs, not one

A direct report that Localization files were showing up as
"unrecognized" despite already having been correctly repositioned by
the merge fix (see TRANSCRIPT.md §16/§17) turned out to be two
separate, stacked bugs:

1. **Stale pre-merge paths in the reported file list.** The file list
   returned to the frontend after a ZIP upload was built directly from
   `unzip`'s own inflate log -- captured BEFORE the misplaced-folder
   merge ran, so it still reported the OLD, pre-merge location
   (`Content/Localization/...`) even though the actual file had
   already moved to `Content/ROD/Localization/...` two lines later in
   the same function. Fixed by rewriting each reported path for every
   folder the merge actually touched, driven by the same
   `movedFolders` list already being returned -- not hardcoded to
   "Localization"/"WwiseAudio" by name, so it stays correct if that
   list ever grows.
2. **A deeper problem underneath the first one**: even with correct
   paths, EVERY extracted file was being flagged as "unrecognized"
   unconditionally -- `flagUnknownFiles(data.files || [])` was called
   directly on the full (200-file-capped) list with no filtering logic
   at all for the ZIP-upload path. The loose-file upload path already
   had real filtering (`guessRelativePath()`, checking a bare filename
   against every section's known rawInputs), but that logic was never
   reused for ZIP uploads, which already have full paths and don't
   need to "guess" anything -- they just needed an actual check.
   Added `isRecognizedRawPath()`, the direct-path counterpart: same
   literal-path and glob-pattern matching (same over-broad-glob guard
   as `guessRelativePath()` -- a bare `*.json` is never trusted alone),
   just checking a path that's already known instead of reconstructing
   one from a bare filename.

Verified together against the real archive: 0 Localization files
flagged afterward (was 13, one per language), and the files still
correctly flagged are genuinely unclaimed ones (`CHR/Humans/Heads/...`)
-- confirming the fix distinguishes real gaps from false positives,
not just suppressing the list entirely.

---

## 8.18 Responsive layout: custom properties instead of inline column widths

Every list+detail view shares `.equip-layout`, which has always
carried a `@media (max-width: 1100px)` rule collapsing to a single
stacked column — yet on real phones (three user screenshots) some
sections stacked and some didn't. The ones that didn't were exactly
the views that sized their list pane with an inline
`style="grid-template-columns: 360px 1fr"`: inline styles beat
stylesheet media queries, so each width customization silently opted
that view out of stacking. Sections like Items > Catalog stacked only
because they never customized the width.

The pattern now: the base rule reads CSS custom properties
(`grid-template-columns: var(--list-col, 360px) 1fr var(--side-col,
380px)`, with `.two-col` and `.side-right` modifier classes for the
common shapes), and views set widths as inline CUSTOM PROPERTIES
(`style="--list-col: 360px;"`). Inline custom properties only feed
the base rule — the media query re-declares `grid-template-columns`
directly, so stacking always wins on small screens while desktop
widths stay per-view. A companion rule caps stacked list panes
(`[id$="ListPane"]`) at 42vh so the detail pane is reachable without
a full-list scroll. Rule of thumb this encodes: **views may only
customize layout through custom properties, never through the
properties a media query needs to own.**

## 8.19 Modding Guides: user content, an escape-first renderer, and cursor-anchored uploads

The first USER-content feature, visually a standard list+detail
section but with three deliberate design decisions:

1. **Escape-first Markdown rendering.** `renderMarkdown()` HTML-escapes
   every line BEFORE any Markdown transform runs, then builds tags
   from the escaped text — guide content can never inject markup, and
   there's no sanitizer to keep in sync because unsafe strings never
   exist. Image URLs are allowlisted to `uploads/`, `Content/`, and
   `http(s)`; anything else renders as literal text. Missing
   screenshot files swap to a dashed `.guide-img-placeholder` box via
   the image error path — the same mechanism that makes the seeded
   guide's per-step placeholders look intentional rather than broken.
2. **Cursor-anchored image insertion.** Paste and drag&drop both
   funnel into one `uploadAndInsert(file, textarea, pos)` path: upload
   first, then splice `![screenshot](uploads/<id>/<file>)` into the
   textarea value at the recorded selection point and restore the
   caret after the inserted text. The drop highlight is a
   `.drop-target` class on the textarea (cyan border + inset glow),
   consistent with the Build Dashboard's upload tray affordance.
3. **Limits visible up front, enforced server-side.** The banner shows
   the manifest's limits before a user hits them; the server enforces
   the same numbers with the manifest path in every error message.
   `allowEditing:false` disables every mutating control with a
   tooltip saying the manifest is why — read-only is a stated mode,
   not mysteriously missing buttons. Editor chrome matches the theme:
   mono textarea on the panel surface, cyan focus ring, and the
   rendered view reuses HUD typography (display-font headings in
   cyan, mono code chips on the standard border tokens).

## 8.20 First post-release export: layout churn, and the fixes it forced

The first content update reorganized the export enough to break four
user-visible things at once, and each root cause is worth recording so
the NEXT reorganization gets diagnosed faster:

- **Hardcoded registries rot.** `PARTNER_CODES = [7 codes]` was correct
  the day it was written and silently wrong the day `DT_PartnerList`
  grew to 22. The replacement (`discover_partner_codes()`) unions every
  place the export declares a partner — the list table, the stat-table
  glob, and the new `PersonalData/` glob — because none of the three is
  a superset of the others (checked, not assumed). Rule going forward:
  a constant that mirrors game data must either be derived from that
  data or carry a comment explaining why it genuinely can't be.
- **UE canvas-slot semantics, part 2.** The Field Map Overview overlays
  were placed treating slot `Left/Top` as a top-left corner; with the
  WBP's `Alignment (0.5, 0.5)` those values are the widget's CENTER, so
  every piece rendered shifted down-right by half its own size — a
  different amount per piece, which is why it read as "odd placement"
  rather than a uniform offset. The pipeline now exports each slot's
  `alignX/alignY` and the frontend subtracts `align × size`, defaulting
  to 0.5 for WorldMap.json files built before the field existed.
- **Approximate pins, honestly labeled.** Chests still have no
  coordinates anywhere in the export, but "a list next to the map" and
  "nothing on the map" aren't the only options: each area's chests now
  fan out in a DASHED ring around the area's own gate marker (the very
  join that attached them), clickable through to their resolved
  contents, with the approximation stated in the tooltip, the legend,
  and the side panel. Dashed = approximate is the visual rule; real
  coordinate pins stay solid.
- **`prepare` context is a dependency.** Three sections read earlier
  sections' results inside their `prepare` hook without declaring them,
  so the per-section rebuild workflow (`--only=mod_coverage`) crashed
  with a bare `KeyError('resolved_mods')`. Found by hitting the crash,
  fixed by declaring `contextNeeds` and teaching `resolve_selection` to
  expand over `requires + contextNeeds`. `requires` keeps its exact
  positional-argument meaning.

## 8.21 3D model viewer: one module, one bridge, one format

The viewer is the app's single ES module (`app/js/model-viewer.js`,
three.js vendored under `app/vendor/three/` behind an import map —
offline like everything else). Non-module views never import it; they
render buttons through the plain-script `ModelPanel` helper and the
module registers `window.ModelViewer` for click time. Deciding factors
worth remembering:

- **glb/gltf only, on purpose.** Every other format the toolkit indexes
  (psk/pskx/psa/uemodel/ueanim/fbx/blend) lacks a dependable in-browser
  loader; rather than ship a half-working FBX path, the Blender→glTF
  round-trip is documented at every place the limitation is visible.
- **Files stream through `/api/pipeline/download-file`** — the existing
  traversal-guarded endpoint. No second file-serving route, no second
  security surface.
- **GL teardown is not optional.** Browsers hard-cap WebGL contexts;
  the close path disposes geometry, materials, textures, controls, and
  the renderer, or the viewer dies silently after ~a dozen opens.
- **The registry (`model_refs`) recomputes sidecar presence every
  build**, so "upload a .glb, rebuild one section" is the entire
  enable-the-button workflow, and the game's own `Database_{id}.json`
  scale is carried through so monsters preview at in-game proportions.

## 8.22 Live build progress: a file, not a parser

The per-section build indicator is driven by `.pipeline-progress.json`,
written by the runner itself at every section transition (atomic
temp-file + `os.replace`, so a polling reader never sees a torn write).
The alternative — parsing "Building X..." lines out of the live log —
was rejected because it couples the dashboard to print formatting and
can't know the PLANNED section list up front; the progress file lists
every resolved section as `pending` from the first write, so the strip
shows the whole plan immediately, including auto-included
prerequisites. Because it's a file, the indicator survives page
reloads, shows terminal-launched runs the server never knew about, and
still reports the last run's outcome after a server restart. `--status`
check runs execute the same sections but deliberately don't write it:
they're diagnostics, and showing them as builds would be lying about
what's happening.

## 8.23 Runtime capture: asking the game instead of guessing

Chest and gimmick coordinates exist in NO export. A chest is
`ARODTBoxBase`, and its id comes from a `LocatorName` assigned by a gimmick
locator whose actor lives in packages FModel can't reach;
`DT_FixTBoxTable` carries only loot keys. The data isn't hidden -- it isn't
there.

So the toolkit asks the running game. A UE4SS Lua mod walks the live
UObjects (typed property reads -- no memory scanning, no signatures, no
offsets to re-derive after a patch), and the dump is uploaded through the
Build Dashboard, where a pipeline section merges it.

Three design rules fell out of it, each from a real failure:

**Merge, never replace.** Gimmicks only exist while their streaming CELL is
loaded, and a named area spans several cells -- standing in the Plains safe
area captured 3 of its 8 chests. Every dump is therefore partial by nature,
so the upload endpoint accumulates across sweeps. Replacing would mean each
session destroyed the last one's work.

**Reject what the game hasn't placed yet.** An actor whose level is loaded
but whose transform hasn't been applied reads exactly (0,0,0) -- as do
Class Default Objects, which `FindAllOf` happily returns. The first sweep
produced 22 such records, 20 of them town gimmicks, and they were being
pinned at the world origin. Both the Lua and the pipeline now reject them,
and the Lua does NOT mark them seen, so they're retried once you walk into
the town.

**Separate "where it is" from "what it belongs to."** Area attribution
comes from the id when the id encodes one (`Seal_Plains1_1_01`) -- 248 of
414. For the rest, the tempting move is to infer the area from coordinates.
Tested and refused: matching a point to the map piece containing it
DISAGREES with the id on 74 of the 248 ids that state their area outright,
because the pieces overlap. Those gimmicks keep `area: null` and are still
DRAWN on the nearest map, flagged `positionDerived` -- because "this pin is
visible on this map" is a rendering fact, not a claim about ownership. The
world-level bounds test IS used, because at world scale the two worlds
don't overlap and containment is unambiguous. Same technique, different
reliability; the distinction is the point.

## 8.24 Lua mods: one mod, one job

The Lua presets generate UE4SS mods from templates. Two principles, both
learned the hard way:

**Never bundle.** F8/F7/F9 were shipped as one mod "because they're all
hotkeys". One of them opened a menu that couldn't be closed -- and because
they were bundled, escaping it meant crashing the game and losing the two
that worked. Bundling optimizes for the author's convenience and bills the
user for it.

**Prefer the game's own verb over poking its nouns.** Granting Col works
because it calls `AddCol()`. The level swap failed because it wrote
`URODUserInfo::Level` -- a value the game recomputes from EXP, so the write
was overwritten. Replaced with `ServerDebugAddHeroExp()`: level-ups, stat
points and UI all follow for free, because it's the path the game runs
itself. The same rule explains the fast-travel menu: `OpenDirectingMapMenu()`
called out of context produced a half-built screen with no exit, because
the real menu is opened BY a terminal that supplies its state and owns its
close path.

**And beware the silent no-op.** HP/SP/Stamina are GAS attributes in
AttributeSets, not fields on the character (`hero.Health` does not exist).
A mod writing to a non-existent field fails quietly and looks installed.
Resolvers now log what they found, so "nothing happened" is never
indistinguishable from "it worked".

## 8.25 UE4SS: silence is the failure mode

Modding this game through UE4SS surfaced one hazard that dwarfs the others:
**a property that does not exist returns a dummy UObject, not nil.**

    hero.Health   --> "UObject: 0000001B0FF31C18"   (there is no Health field)

So `if value ~= nil` passes, the write is accepted, and nothing happens.
No error, no crash, no clue -- a mod that installs cleanly and is inert.
Several mods shipped in exactly that state and cost real testing time to
find.

Three rules came out of it, and they apply to every mod in app/lua-templates:

1. **Type-check, don't nil-check.** Anything that must be a number is
   validated with `type(v) == "number"`.
2. **Write, then read back.** GAS recomputes attribute CurrentValues from
   active effects, so an accepted write can be reverted a frame later --
   indistinguishable from "the mod isn't running" unless you verify.
3. **Say so out loud.** Every mod that cannot find what it needs now logs
   that fact once, and points at DebugProbe. A broken mod must never look
   like a working one.

The corollary rule -- learned from AddCol working while a direct write to
`URODUserInfo::Level` did nothing -- is **prefer the game's verbs over its
nouns**: call the function the game itself calls, and the UI, the save and
every validation path follow for free. But verify that too: the probe
showed `DebugAddHeroExp` is perfectly callable and completely inert, a
debug stub in the shipping build. Calling a function successfully is not
the same as it doing something.

## 8.26 Texture channels: what the data says vs what the name says

The item shading model is MSM_CelSf (custom cel), fed by exactly two
per-asset textures -- Texture_BC and Texture_S -- plus a shared reflection
cubemap and shared detail maps. Two things are settled from the game's own
data, not inference:

**The dual-UV routing is CONFIRMED.** Every material carries
TextureStreamingData with a UVChannelIndex per texture, and for
MI_ITM_SH001003 it reads:

    T_ITM_SH001003_BC   UV1     <- artist-painted atlas, its own unwrap
    T_ITM_SH001003_S    UV0     <- tied to geometry
    T_CHR_Height, T_CHR_Dirt2, T_CHR_DirtBuildup, T_CHR_Salamander,
    T_ScreenTone01, T_StarFX01, T_AnalyzeMask02   ALL UV0

So BC lives on the secondary UV and everything geometry-driven -- including
S -- lives on the primary. This was a hypothesis; it is now a fact you can
read out of the export.

**"_S" is not a specular map.** Measured on T_ITM_SH001003_S (2048x2048):

    R  mean 127.1  std  16.8      both centred EXACTLY on 128,
    G  mean 127.1  std  23.1      and corr(R,G) = -0.006 (independent)
    B  mean 119.0  std 103.9      bimodal: 38% at ~0, 46% at 200+
    A  254-255 everywhere         carries nothing

    x^2 + y^2 <= 1 for 99.92% of pixels
    corr(B, reconstructed Z) = +0.079

R and G behave like a tangent-space normal's X and Y: two independent
artistic masks do not both land on 128. B is NOT the normal's Z (it barely
correlates with the reconstructed Z) and does NOT track albedo (BC's mean
colour is the same where B is high and where it is low), so it is an
independent mask packed into blue. Alpha is unused. And there is no _N
texture ANYWHERE in the item tree, which is consistent with the normal
living here.

**Two things I got wrong while testing, worth keeping:**

1. The static switches are named 064_Fur, 128_Leather, 160_Wood, 224_Gold.
   Those look exactly like byte values, so I checked whether they were
   literal pixel values in a material-ID channel. THEY ARE NOT -- there are
   no spikes at 64/160/224 in any channel. A clean hypothesis, tested,
   dead. Worth recording so nobody has the same idea again.
2. "_S" is ALSO a UI-sprite suffix in this game (T_ItemCategoryIcon_*_S,
   T_ClassIcon_S). Those are not material maps at all. Averaging them in
   would quietly poison any conclusion -- tools/analyze_texture_maps.py
   detects and excludes them.

**SETTLED (n=12 shields + a known normal map).** The user supplied the whole
shield texture set and a real normal map (Weapon_Shield_030_Nrm), which
closed the case:

                        known normal map      the game's _S maps
    R                   128.0                 127.5      <- same
    G                   127.1                 127.2      <- same
    corr(R, G)          -0.020                -0.005     <- same
    x^2 + y^2 <= 1      100.00%               99.77%     <- same
    B                   255, std 0 (CONSTANT) ~150, std ~90 (BIMODAL MASK)
    A                   255                   255 (unused)

The normal map stores X and Y in red and green and leaves BLUE as a constant
255 -- Z is reconstructible from X and Y, so blue is dead weight. The game's
"_S" map has the SAME red and green and puts a MASK in that free blue channel.

    _S  =  R: normal X   G: normal Y   B: authored mask   A: unused

**And B cannot be derived from the normal.** I tested curvature, edge/gradient
magnitude, slope and flatness against the real maps: every correlation came
back at |r| = 0.03-0.07 across the shields. That is noise. Blue is painted by
hand and carries something the normal does not know. So
tools/normal_to_s.py packs R/G/A correctly and REFUSES to fabricate blue --
it offers a constant, a supplied mask, or an explicitly-labelled
"curvature starting point to paint over", rather than inventing an answer.

**Still unknown:** what B actually gates (reflection mask? cel-shadow bias?
AO?), and what BC's ALPHA carries -- it is NOT empty (bimodal around 150-200
with 3.7% at zero), which nobody had looked at.

## 9. Accessibility notes

- All animations respect `prefers-reduced-motion: reduce`.
- Focus-visible outline uses `--db-cyan-bright` at 2px, consistent
  across all interactive elements.
- Color is never the *only* signal for rank — every rank also shows
  its letter (D/C/B/A/S) as text, both in the rank-chip overlay and the
  class-badge icon, so the design isn't colorblind-inaccessible.
