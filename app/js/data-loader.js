// ============================================================
// data-loader.js
// Loads all weapon / parameter JSON from the Content/ROD export
// structure and builds an in-memory index for the app to use.
// ============================================================

const CONTENT_ROOT = "Content/ROD";

const DataStore = {
  weaponsByCategory: {},   // { OneHandedSword: [...], ... }
  weaponsByItemKey: {},    // { "ItemName_WOS_1": weapon }
  categoryIndex: null,     // _index.json contents
  armorByCategory: {},     // { Upper: [...], Lower: [...], Glove: [...], Shield: [...] }
  armorByItemKey: {},      // { "ItemName_Upper_1": armor }
  armorCategoryIndex: null,
  swordSkillsByCategory: {}, // { OneHandedSword: [...], ... } -- same 6 keys as weaponsByCategory
  swordSkillsById: {},       // { "01_007": skill }
  swordSkillsIndex: null,
  swordSkillLocalization: {},         // { "01_007": { name, verified, source, description, descriptionVerified, descriptionSource } } -- for currentLanguage
  swordSkillLocalizationManifest: null,
  monstersByCategory: {},  // { Beast: [...], DemiHuman: [...], PlantInsect: [...], Demon: [...] }
  monstersByTitleKey: {},  // { "EnemyName_012011": monster } -- keyed by DatabaseTitleKey, NOT itemKey (monsters have no ItemKey)
  monsterCategoryIndex: null,
  monsterLocalization: {}, // { titleKey: { name, verified, source, description, descriptionVerified, descriptionSource } } -- for currentLanguage
  monsterLocalizationManifest: null,
  itemsByCategory: {},     // { Usable: [...], Material: [...], KeyItem: [...] }
  itemsByItemKey: {},      // { "ItemName_Usable_1": item }
  itemCategoryIndex: null,
  itemLocalization: {},    // { itemKey: { name, verified, source, description, descriptionVerified, descriptionSource, flavorText, flavorTextVerified, flavorTextSource } } -- for currentLanguage
  itemLocalizationManifest: null,
  recipesByCategory: {}, // { OneHandedSword: [...], Usable: [...], ... } -- 11 categories
  recipesByItemKey: {},  // { "ItemName_OneHandedSwordRecipe_1": recipe }
  recipeCategoryIndex: null, // { count, categoryCounts: {...}, file }
  recipeLocalization: {}, // { itemKey: { name, verified, source, description, descriptionVerified, descriptionSource } } -- for currentLanguage; name/description are already template-substituted server-side, not raw {Rep_ItemName_*} strings
  recipeLocalizationManifest: null,
  loreList: [],            // flat list -- Lore has NO sub-categories (SubCategory unused on all 177 rows, confirmed), unlike every other category
  loreByTitleKey: {},
  loreIndex: null,
  loreLocalization: {},
  loreLocalizationManifest: null,
  townList: [],            // flat list, 10 towns, sorted by id
  townByID: {},            // { "001": town, ... }
  townIndex: null,         // { count, namedCount, file }
  townLocalization: {},    // { nameKey: { name, verified, source } } -- for currentLanguage
  townLocalizationManifest: null,
  questList: [],           // flat list, 5 Main quests
  questByID: {},           // { "0001": quest, ... }
  questIndex: null,        // { count, file, categories, note }
  questLocalization: {},   // { nameKey: { name, verified, description, ... } } -- for currentLanguage
  questLocalizationManifest: null,
  characterList: [],       // flat list, sorted partners-first -- 22 total, 7 of which are also Partners
  characterByTitleKey: {}, // { "PartnerName_IOM": character }
  characterIndex: null,    // { count, partnerCount, file }
  characterLocalization: {}, // { titleKey: { name, verified, source, description, descriptionVerified, descriptionSource } } -- for currentLanguage
  characterLocalizationManifest: null,
  partnerSkillLocalization: {}, // { "CombinationSrashName_DoubleCircular": {...}, "SupportSkillName_HealZone": {...}, ... } -- for currentLanguage
  partnerSkillLocalizationManifest: null,
  partnerStats: {},        // { "IOM": { "1": {Defence,...}, ..., "200": {...} }, ... } -- only the 7 PARTNER_CODES, full table always loaded (not paginated) since the level slider needs random access
  avatarCustomize: null,   // { parts: {...}, colorPalettes: {...}, voices: [...], presets: [...] } -- NO localization file: confirmed no name field exists anywhere for any of this data
  playerConfig: null,      // { growPointsCumulativeByLevel, expRequiredByLevel, heroStatusCaps, growthParamCurves, ... } -- see PlayerConfig.json's own _confidence field for which parts are confirmed vs inferred
  abilityScoreTable: null, // { "1": {RankD:.., ...}, "31": {...}, "61": {...} }
  classTable: null,        // { RankD: {...}, ... }
  localization: {},        // { itemKey: { name, verified, source, description, descriptionVerified, descriptionSource } } -- for currentLanguage
  localizationManifest: null, // { en: {label, file, verifiedCount, describedCount, totalCount, hasOfficialSource}, ... }
  modLocalization: {},     // { modKey: { name, verified, source, description, descriptionVerified, descriptionSource } } -- for currentLanguage
  modLocalizationManifest: null,
  currentLanguage: "en",
  ambiguousNamePairs: [],  // [{ candidates, possibleNames, note, resolved }]
  peculiarMods: {},        // { ModName: { effects: [...], resolved: true } }
  modCoverageReport: null,
  exModPool: [],           // [{ type, label, format, labelConfirmed, tiers }]
  devReference: null,      // { aesEncryptionKey, mappingFiles }
  animationConfig: null,   // { scanBar: {...}, rankBorderColors: {...} }
  dtInspectorIndex: [],    // [{ path, name, kind, rowCount, fields, summary, textureRefCount, texturesPresent, texturesMissing }]
  _dtInspectorFileCache: {}, // { path: parsedJSON } -- populated lazily by getDtInspectorFile()
  bpInspectorIndex: null,  // { count, totalFunctions } -- tiny summary
  bpInspectorWidgets: [],  // [{ path, name, totalEntries, functionCount, functions, widgetTypeCounts }] -- small (37 entries), loaded eagerly unlike Wwise's lazy 4449
  assetInspectorIndex: null, // { materialCount, materialInstanceCount, baseMaterialCount, meshCount }
  assetMaterials: [],      // [{ path, name, assetType, parent, scalarParameters, vectorParameters, textureParameters }] or the thinner base-Material shape
  assetMeshes: [],         // [{ path, name, slot, itemId, itemKey, malePath, femalePath }]
  wwiseAudioIndex: null,   // { totalCount, categoryCounts: {...} } -- tiny, eager-loaded
  _wwiseEventsCache: null, // the full 4449-entry events.json, lazily fetched once by getWwiseEvents()

  async loadAll() {
    this.categoryIndex = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Weapons/_index.json`
    );

    const categoryKeys = Object.keys(this.categoryIndex);
    await Promise.all(
      categoryKeys.map(async (catKey) => {
        const meta = this.categoryIndex[catKey];
        const weapons = await fetchJSON(`${CONTENT_ROOT}/${meta.file}`);
        this.weaponsByCategory[catKey] = weapons;
        for (const w of weapons) {
          this.weaponsByItemKey[w.itemKey] = w;
        }
      })
    );

    this.armorCategoryIndex = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Equipment/_index.json`
    );
    const armorCategoryKeys = Object.keys(this.armorCategoryIndex);
    await Promise.all(
      armorCategoryKeys.map(async (catKey) => {
        const meta = this.armorCategoryIndex[catKey];
        const armorList = await fetchJSON(`${CONTENT_ROOT}/${meta.file}`);
        this.armorByCategory[catKey] = armorList;
        for (const a of armorList) {
          this.armorByItemKey[a.itemKey] = a;
        }
      })
    );

    this.swordSkillsIndex = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Weapons/SwordSkills/_index.json`
    );
    const swordSkillList = await fetchJSON(`${CONTENT_ROOT}/${this.swordSkillsIndex.file}`);
    for (const s of swordSkillList) {
      this.swordSkillsById[s.id] = s;
      if (!this.swordSkillsByCategory[s.category]) this.swordSkillsByCategory[s.category] = [];
      this.swordSkillsByCategory[s.category].push(s);
    }

    this.monsterCategoryIndex = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Monsters/_index.json`
    );
    const monsterCategoryKeys = Object.keys(this.monsterCategoryIndex);
    await Promise.all(
      monsterCategoryKeys.map(async (catKey) => {
        const meta = this.monsterCategoryIndex[catKey];
        const monsterList = await fetchJSON(`${CONTENT_ROOT}/${meta.file}`);
        this.monstersByCategory[catKey] = monsterList;
        for (const m of monsterList) {
          this.monstersByTitleKey[m.titleKey] = m;
        }
      })
    );

    this.itemCategoryIndex = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Catalog/_index.json`
    );
    const itemCategoryKeys = Object.keys(this.itemCategoryIndex);
    await Promise.all(
      itemCategoryKeys.map(async (catKey) => {
        const meta = this.itemCategoryIndex[catKey];
        const itemList = await fetchJSON(`${CONTENT_ROOT}/${meta.file}`);
        this.itemsByCategory[catKey] = itemList;
        for (const i of itemList) {
          this.itemsByItemKey[i.itemKey] = i;
        }
      })
    );

    // Recipes are stored as ONE flat file (unlike Items' one-file-per-
    // category) -- 245 total isn't large enough to need per-category
    // files the way the bigger DataTables do, so this is a single
    // fetch, grouped by category client-side.
    this.recipeCategoryIndex = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Items/Recipes/_index.json`);
    const allRecipes = await fetchJSON(`${CONTENT_ROOT}/${this.recipeCategoryIndex.file}`);
    for (const r of allRecipes) {
      if (!this.recipesByCategory[r.category]) this.recipesByCategory[r.category] = [];
      this.recipesByCategory[r.category].push(r);
      this.recipesByItemKey[r.itemKey] = r;
    }

    // Lore is a flat list with no sub-categories (unlike weapons/
    // armor/items/monsters, which all split into a category index +
    // one file per category) -- so this is a single fetch, not a
    // Promise.all over a category-keyed index.
    this.loreIndex = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/Lore/_index.json`);
    this.loreList = await fetchJSON(`${CONTENT_ROOT}/${this.loreIndex.file}`);
    for (const l of this.loreList) {
      this.loreByTitleKey[l.titleKey] = l;
    }

    // Towns and Quests -- both single flat files, same shape as Lore.
    this.townIndex = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/Towns/_index.json`);
    this.townList = await fetchJSON(`${CONTENT_ROOT}/${this.townIndex.file}`);
    for (const t of this.townList) {
      this.townByID[t.id] = t;
    }

    this.questIndex = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/Quests/_index.json`);
    this.questList = await fetchJSON(`${CONTENT_ROOT}/${this.questIndex.file}`);
    for (const q of this.questList) {
      this.questByID[q.questId] = q;
    }

    // Characters is the same flat-list shape as Lore (no sub-
    // categories), plus two extra fetches: the full Partner stat
    // table (small enough -- 7 partners x 200 levels -- to load
    // whole, not paginated, since the level slider needs instant
    // random access to any level) and the AvatarCustomize swatch
    // data (no localization file exists for this -- confirmed no
    // name field anywhere in the source).
    this.characterIndex = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/Characters/_index.json`);
    this.characterList = await fetchJSON(`${CONTENT_ROOT}/${this.characterIndex.file}`);
    for (const c of this.characterList) {
      this.characterByTitleKey[c.titleKey] = c;
    }
    this.partnerStats = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/Characters/PartnerStats.json`);
    this.avatarCustomize = await fetchJSON(`${CONTENT_ROOT}/DataAssets/Database/Characters/AvatarCustomize.json`);

    this.localizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Localization/_manifest.json`
    );
    this.currentLanguage = this.localizationManifest._defaultLanguage || "en";
    const langMeta = this.localizationManifest[this.currentLanguage];
    const localization = await fetchJSON(`${CONTENT_ROOT}/${langMeta.file}`);

    this.swordSkillLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Weapons/SwordSkills/Localization/_manifest.json`
    );
    const swordSkillLangMeta = this.swordSkillLocalizationManifest[this.currentLanguage]
      || this.swordSkillLocalizationManifest[this.swordSkillLocalizationManifest._defaultLanguage];
    this.swordSkillLocalization = await fetchJSON(`${CONTENT_ROOT}/${swordSkillLangMeta.file}`);

    this.modLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Parameters/Shared/Localization/_manifest.json`
    );
    const modLangMeta = this.modLocalizationManifest[this.currentLanguage]
      || this.modLocalizationManifest[this.modLocalizationManifest._defaultLanguage];
    const modLocalization = await fetchJSON(`${CONTENT_ROOT}/${modLangMeta.file}`);

    // Loaded AFTER currentLanguage is set above (not alongside the
    // monster category data loaded earlier) so this actually respects
    // the real default language rather than the field's initial "en"
    // placeholder value -- harmless right now since DEFAULT_LANGUAGE
    // in the pipeline IS "en", but would silently load the wrong
    // language here if that ever changed without this also moving.
    this.monsterLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Monsters/Localization/_manifest.json`
    );
    const monsterLangMeta = this.monsterLocalizationManifest[this.currentLanguage]
      || this.monsterLocalizationManifest[this.monsterLocalizationManifest._defaultLanguage];
    this.monsterLocalization = await fetchJSON(`${CONTENT_ROOT}/${monsterLangMeta.file}`);

    this.itemLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Catalog/Localization/_manifest.json`
    );
    const itemLangMeta = this.itemLocalizationManifest[this.currentLanguage]
      || this.itemLocalizationManifest[this.itemLocalizationManifest._defaultLanguage];
    this.itemLocalization = await fetchJSON(`${CONTENT_ROOT}/${itemLangMeta.file}`);

    this.recipeLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Items/Recipes/Localization/_manifest.json`
    );
    const recipeLangMeta = this.recipeLocalizationManifest[this.currentLanguage]
      || this.recipeLocalizationManifest[this.recipeLocalizationManifest._defaultLanguage];
    this.recipeLocalization = await fetchJSON(`${CONTENT_ROOT}/${recipeLangMeta.file}`);

    this.loreLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Lore/Localization/_manifest.json`
    );
    const loreLangMeta = this.loreLocalizationManifest[this.currentLanguage]
      || this.loreLocalizationManifest[this.loreLocalizationManifest._defaultLanguage];
    this.loreLocalization = await fetchJSON(`${CONTENT_ROOT}/${loreLangMeta.file}`);

    this.townLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Towns/Localization/_manifest.json`
    );
    const townLangMeta = this.townLocalizationManifest[this.currentLanguage]
      || this.townLocalizationManifest[this.townLocalizationManifest._defaultLanguage];
    this.townLocalization = await fetchJSON(`${CONTENT_ROOT}/${townLangMeta.file}`);

    this.questLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Quests/Localization/_manifest.json`
    );
    const questLangMeta = this.questLocalizationManifest[this.currentLanguage]
      || this.questLocalizationManifest[this.questLocalizationManifest._defaultLanguage];
    this.questLocalization = await fetchJSON(`${CONTENT_ROOT}/${questLangMeta.file}`);

    this.characterLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Characters/Localization/_manifest.json`
    );
    const characterLangMeta = this.characterLocalizationManifest[this.currentLanguage]
      || this.characterLocalizationManifest[this.characterLocalizationManifest._defaultLanguage];
    this.characterLocalization = await fetchJSON(`${CONTENT_ROOT}/${characterLangMeta.file}`);

    this.partnerSkillLocalizationManifest = await fetchJSON(
      `${CONTENT_ROOT}/DataAssets/Database/Characters/SkillLocalization/_manifest.json`
    );
    const skillLangMeta = this.partnerSkillLocalizationManifest[this.currentLanguage]
      || this.partnerSkillLocalizationManifest[this.partnerSkillLocalizationManifest._defaultLanguage];
    this.partnerSkillLocalization = await fetchJSON(`${CONTENT_ROOT}/${skillLangMeta.file}`);

    const [abilityScore, classTable, ambiguousPairs, peculiarMods, coverage, exModPool, devReference, animationConfig, dtInspectorIndex, wwiseAudioIndex, bpInspectorIndex, bpInspectorWidgets, assetInspectorIndex, assetMaterials, assetMeshes, playerConfig] =
      await Promise.all([
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Parameters/AbilityScoreTable.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Parameters/ClassTable.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Items/Localization/ambiguous_name_pairs.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Parameters/Shared/PeculiarModifications.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Parameters/Shared/ModCoverageReport.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Parameters/Shared/ExModPool.json`),
        fetchJSON(`${CONTENT_ROOT}/dev-reference.json`),
        fetchJSON(`${CONTENT_ROOT}/animation-config.json`),
        // Lightweight catalog only (~36KB) -- the individual raw
        // datatable files this indexes (some 1MB+) are fetched lazily,
        // on demand, by DtInspectorView only when the user actually
        // opens one. Eagerly fetching all 65 on every app load would
        // slow down startup for a feature most sessions won't open.
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_DtInspector/_index.json`),
        // Same lazy pattern as DT Inspector: this is just the tiny
        // category-counts summary (~4KB). The full 4449-entry,
        // ~3.2MB events.json is fetched lazily by getWwiseEvents()
        // only when WwiseAudioView is actually opened.
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_WwiseAudio/_index.json`),
        // BP Inspector's full widgets.json is only ~76KB (37 widgets,
        // 87 functions total) -- small enough to load eagerly here,
        // unlike DT Inspector's per-file lazy fetch or Wwise's lazy
        // 3.2MB events.json.
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_BpInspector/_index.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_BpInspector/widgets.json`),
        // Asset Inspector: Materials.json (~196KB) + Meshes.json
        // (~92KB) are both small enough to load eagerly the same way.
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_AssetInspector/_index.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_AssetInspector/Materials.json`),
        fetchJSON(`${CONTENT_ROOT}/DataAssets/_AssetInspector/Meshes.json`),
        // ~8KB -- the Player tab's level/growth-point/stat-cap curves.
        fetchJSON(`${CONTENT_ROOT}/DataAssets/Parameters/PlayerConfig.json`),
      ]);

    this.playerConfig = playerConfig;

    this.abilityScoreTable = abilityScore;
    this.classTable = classTable;
    this.localization = localization;
    this.modLocalization = modLocalization;
    this.ambiguousNamePairs = ambiguousPairs;
    this.peculiarMods = peculiarMods;
    this.modCoverageReport = coverage;
    this.exModPool = exModPool;
    this.dtInspectorIndex = dtInspectorIndex;
    this.wwiseAudioIndex = wwiseAudioIndex;
    this.bpInspectorIndex = bpInspectorIndex;
    this.bpInspectorWidgets = bpInspectorWidgets;
    this.assetInspectorIndex = assetInspectorIndex;
    this.assetMaterials = assetMaterials;
    this.assetMeshes = assetMeshes;
    this.devReference = devReference;
    this.animationConfig = animationConfig;

    return this;
  },

  /**
   * Switches the active display language, re-fetching every per-
   * category localization file: weapon/armor (this.localization),
   * mod (this.modLocalization), monster (this.monsterLocalization),
   * and item-catalog (this.itemLocalization -- Consumables/Materials/
   * Key Items; named "itemLocalization" for the Items DATABASE
   * SECTION specifically, not to be confused with this.localization
   * above, which despite living under a path also named "Items/
   * Localization" is actually weapon/armor's localization -- a path
   * name chosen before the Items section existed as its own category).
   * Returns true on success. Callers are responsible for re-rendering
   * whatever view is currently visible afterward -- this only updates
   * the data layer.
   */
  async setLanguage(langCode) {
    if (!this.localizationManifest || !this.localizationManifest[langCode]) {
      return false;
    }
    const langMeta = this.localizationManifest[langCode];
    const localization = await fetchJSON(`${CONTENT_ROOT}/${langMeta.file}`);
    this.localization = localization;

    if (this.swordSkillLocalizationManifest && this.swordSkillLocalizationManifest[langCode]) {
      const swordSkillLangMeta = this.swordSkillLocalizationManifest[langCode];
      this.swordSkillLocalization = await fetchJSON(`${CONTENT_ROOT}/${swordSkillLangMeta.file}`);
    }

    if (this.modLocalizationManifest && this.modLocalizationManifest[langCode]) {
      const modLangMeta = this.modLocalizationManifest[langCode];
      this.modLocalization = await fetchJSON(`${CONTENT_ROOT}/${modLangMeta.file}`);
    }

    if (this.monsterLocalizationManifest && this.monsterLocalizationManifest[langCode]) {
      const monsterLangMeta = this.monsterLocalizationManifest[langCode];
      this.monsterLocalization = await fetchJSON(`${CONTENT_ROOT}/${monsterLangMeta.file}`);
    }

    if (this.itemLocalizationManifest && this.itemLocalizationManifest[langCode]) {
      const itemLangMeta = this.itemLocalizationManifest[langCode];
      this.itemLocalization = await fetchJSON(`${CONTENT_ROOT}/${itemLangMeta.file}`);
    }

    if (this.recipeLocalizationManifest && this.recipeLocalizationManifest[langCode]) {
      const recipeLangMeta = this.recipeLocalizationManifest[langCode];
      this.recipeLocalization = await fetchJSON(`${CONTENT_ROOT}/${recipeLangMeta.file}`);
    }

    if (this.loreLocalizationManifest && this.loreLocalizationManifest[langCode]) {
      const loreLangMeta = this.loreLocalizationManifest[langCode];
      this.loreLocalization = await fetchJSON(`${CONTENT_ROOT}/${loreLangMeta.file}`);
    }

    if (this.townLocalizationManifest && this.townLocalizationManifest[langCode]) {
      const townLangMeta = this.townLocalizationManifest[langCode];
      this.townLocalization = await fetchJSON(`${CONTENT_ROOT}/${townLangMeta.file}`);
    }

    if (this.questLocalizationManifest && this.questLocalizationManifest[langCode]) {
      const questLangMeta = this.questLocalizationManifest[langCode];
      this.questLocalization = await fetchJSON(`${CONTENT_ROOT}/${questLangMeta.file}`);
    }

    if (this.characterLocalizationManifest && this.characterLocalizationManifest[langCode]) {
      const characterLangMeta = this.characterLocalizationManifest[langCode];
      this.characterLocalization = await fetchJSON(`${CONTENT_ROOT}/${characterLangMeta.file}`);
    }

    if (this.partnerSkillLocalizationManifest && this.partnerSkillLocalizationManifest[langCode]) {
      const skillLangMeta = this.partnerSkillLocalizationManifest[langCode];
      this.partnerSkillLocalization = await fetchJSON(`${CONTENT_ROOT}/${skillLangMeta.file}`);
    }

    this.currentLanguage = langCode;
    return true;
  },

  getDisplayName(itemKey) {
    const entry = this.localization[itemKey];
    if (entry && entry.name) return entry.name;
    return itemKey; // fallback to raw key, per requirement
  },

  isVerifiedName(itemKey) {
    const entry = this.localization[itemKey];
    return !!(entry && entry.verified);
  },

  /**
   * Item/armor description, sourced from the same Items/Localization
   * file as the display name. Returns "" (not the raw key) when
   * missing, since a description has no sensible raw-key fallback --
   * callers should check getDescription() for truthiness and hide the
   * whole description block if empty, rather than displaying a blank
   * paragraph or falling back to the ItemKey as if it were prose.
   */
  getDescription(itemKey) {
    const entry = this.localization[itemKey];
    return (entry && entry.description) || "";
  },

  isDescriptionVerified(itemKey) {
    const entry = this.localization[itemKey];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * Sword Skill display name, keyed by the skill's own id (e.g.
   * "01_007"), NOT an ItemKey -- Sword Skills have no ItemKey, the
   * same reasoning Monsters/Lore/Towns/Quests already use their own
   * dedicated keys for. Falls back to the raw id if unresolved.
   */
  getSwordSkillDisplayName(skillId) {
    const entry = this.swordSkillLocalization[skillId];
    if (entry && entry.name) return entry.name;
    return skillId;
  },

  isSwordSkillNameVerified(skillId) {
    const entry = this.swordSkillLocalization[skillId];
    return !!(entry && entry.verified);
  },

  getSwordSkillDescription(skillId) {
    const entry = this.swordSkillLocalization[skillId];
    return (entry && entry.description) || "";
  },

  isSwordSkillDescriptionVerified(skillId) {
    const entry = this.swordSkillLocalization[skillId];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * Unique MOD display name (e.g. "PoisonSword" -> "Poison Sword"),
   * sourced from Parameters/Shared/Localization/{lang}.json. Falls
   * back to the raw mod key, same convention as getDisplayName() for
   * items, so the UI never shows a blank mod name.
   */
  getModDisplayName(modKey) {
    const entry = this.modLocalization[modKey];
    if (entry && entry.name) return entry.name;
    return modKey;
  },

  isModNameVerified(modKey) {
    const entry = this.modLocalization[modKey];
    return !!(entry && entry.verified);
  },

  /**
   * Where the mod's NAME was resolved from (e.g. "Official game
   * localization (Game.json)" or a fallback-to-English note) -- this
   * field has been stored on every mod localization entry since it
   * was first built, but had no getter exposing it until now. Distinct
   * from the mod's numeric EFFECT data, which always comes from
   * DA_AttributeModification.json regardless of language -- see
   * getModDefinition() / PeculiarModifications.json, a structural file
   * with no per-language source field of its own since it isn't
   * localized text at all.
   */
  getModNameSource(modKey) {
    const entry = this.modLocalization[modKey];
    return (entry && entry.source) || null;
  },

  getModDescription(modKey) {
    const entry = this.modLocalization[modKey];
    return (entry && entry.description) || "";
  },

  isModDescriptionVerified(modKey) {
    const entry = this.modLocalization[modKey];
    return !!(entry && entry.descriptionVerified);
  },

  getModDescriptionSource(modKey) {
    const entry = this.modLocalization[modKey];
    return (entry && entry.descriptionSource) || null;
  },

  /**
   * Monster display name, sourced from
   * Database/Monsters/Localization/{lang}.json, keyed by
   * DatabaseTitleKey (e.g. "EnemyName_012011") -- NOT an ItemKey,
   * since monsters have no item record at all. Falls back to a
   * synthesized "EnemyType #DatabaseTitleID" label rather than the
   * raw titleKey string itself when unnamed, since the titleKey alone
   * (e.g. "EnemyName_001005") is less immediately informative than
   * "Beast #1005" -- this mirrors the spirit of "fall back to the raw
   * key" used elsewhere, just adapted since the monster's raw key
   * isn't as self-describing as an ItemKey is.
   */
  getMonsterDisplayName(monster) {
    const entry = this.monsterLocalization[monster.titleKey];
    if (entry && entry.name) return entry.name;
    return `${monster.enemyTypeLabel} #${monster.titleId}`;
  },

  isMonsterNameVerified(monster) {
    const entry = this.monsterLocalization[monster.titleKey];
    return !!(entry && entry.verified);
  },

  getMonsterDescription(monster) {
    const entry = this.monsterLocalization[monster.titleKey];
    return (entry && entry.description) || "";
  },

  isMonsterDescriptionVerified(monster) {
    const entry = this.monsterLocalization[monster.titleKey];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * Item (Consumables/Materials/Key Items) display name, sourced from
   * Items/Catalog/Localization/{lang}.json. Keyed by itemKey (items DO
   * have a real ItemKey, unlike monsters), but kept as its own
   * namespace separate from getDisplayName() (weapon/armor) per the
   * "keep each category's localization independent" decision -- mods
   * and monsters already each got their own getters for the same
   * reason, so this matches the established pattern rather than being
   * a one-off exception.
   */
  getItemDisplayName(itemKey) {
    const entry = this.itemLocalization[itemKey];
    if (entry && entry.name) return entry.name;
    return itemKey;
  },

  isItemNameVerified(itemKey) {
    const entry = this.itemLocalization[itemKey];
    return !!(entry && entry.verified);
  },

  getItemDescription(itemKey) {
    const entry = this.itemLocalization[itemKey];
    return (entry && entry.description) || "";
  },

  isItemDescriptionVerified(itemKey) {
    const entry = this.itemLocalization[itemKey];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * The OPTIONAL second description paragraph (Database-menu-only
   * flavor text) -- confirmed present for only ~60/148 items, "" for
   * the rest. Callers should check truthiness and render nothing when
   * empty, the same convention as getDescription()/getItemDescription().
   */
  getFlavorText(itemKey) {
    const entry = this.itemLocalization[itemKey];
    return (entry && entry.flavorText) || "";
  },

  isFlavorTextVerified(itemKey) {
    const entry = this.itemLocalization[itemKey];
    return !!(entry && entry.flavorTextVerified);
  },

  /**
   * Recipe name/description, sourced from
   * Items/Recipes/Localization/{lang}.json. These strings are ALREADY
   * template-substituted server-side (the pipeline resolves the
   * embedded {Rep_ItemName_*} placeholder into the produced item's
   * real name for this exact language before writing the file) -- so
   * unlike every other getter in this file, there's no raw template
   * syntax to worry about here; what's stored IS the final display
   * string. Own localization namespace, per the established "each
   * category keeps its own getters" pattern.
   */
  getRecipeDisplayName(recipeKey) {
    const entry = this.recipeLocalization[recipeKey];
    if (entry && entry.name) return entry.name;
    return recipeKey;
  },

  isRecipeNameVerified(recipeKey) {
    const entry = this.recipeLocalization[recipeKey];
    return !!(entry && entry.verified);
  },

  getRecipeDescription(recipeKey) {
    const entry = this.recipeLocalization[recipeKey];
    return (entry && entry.description) || "";
  },

  isRecipeDescriptionVerified(recipeKey) {
    const entry = this.recipeLocalization[recipeKey];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * Resolves a recipe's produced item to its display name + verified
   * state, via the SAME weapon/armor or item localization those
   * categories already use -- not a separate recipe-specific lookup.
   * recipe.producedNamespace ("weapon" or "item") selects which one.
   * Returns null entirely if the recipe has no resolvable produced
   * item at all (recipe.producedItemKey is null -- e.g. the recipe's
   * own name key had no localization entry to parse a template out
   * of in the first place).
   */
  getRecipeProducedItemInfo(recipe) {
    if (!recipe.producedItemKey) return null;
    const name = recipe.producedNamespace === "weapon"
      ? this.getDisplayName(recipe.producedItemKey)
      : this.getItemDisplayName(recipe.producedItemKey);
    const verified = recipe.producedNamespace === "weapon"
      ? this.isVerifiedName(recipe.producedItemKey)
      : this.isItemNameVerified(recipe.producedItemKey);
    const description = recipe.producedNamespace === "weapon"
      ? this.getDescription(recipe.producedItemKey)
      : this.getItemDescription(recipe.producedItemKey);
    return { itemKey: recipe.producedItemKey, name, verified, description };
  },

  /**
   * Resolves every material in a recipe to its display name, via the
   * existing item localization (materials are always
   * ItemCategory_Material, confirmed across all 245 recipes with zero
   * exceptions) -- returns [{ itemKey, name, verified, quantity }].
   */
  getRecipeMaterialsInfo(recipe) {
    return (recipe.materials || []).map((m) => ({
      itemKey: m.itemKey,
      name: this.getItemDisplayName(m.itemKey),
      verified: this.isItemNameVerified(m.itemKey),
      quantity: m.quantity,
    }));
  },

  /**
   * Lore (World > Lore) display name, sourced from
   * Database/Lore/Localization/{lang}.json. Keyed by the lore object
   * itself (reads .titleKey internally), same calling convention as
   * the monster getters -- Lore has no ItemKey either, only a
   * DatabaseTitleKey, the same situation as monsters.
   */
  getLoreDisplayName(lore) {
    const entry = this.loreLocalization[lore.titleKey];
    if (entry && entry.name) return entry.name;
    return `Lore #${lore.titleId}`;
  },

  isLoreNameVerified(lore) {
    const entry = this.loreLocalization[lore.titleKey];
    return !!(entry && entry.verified);
  },

  getLoreDescription(lore) {
    const entry = this.loreLocalization[lore.titleKey];
    return (entry && entry.description) || "";
  },

  isLoreDescriptionVerified(lore) {
    const entry = this.loreLocalization[lore.titleKey];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * Character display name, sourced from
   * Database/Characters/Localization/{lang}.json. Keyed by the
   * character object itself (reads .titleKey internally, falls back
   * to .code), same calling convention as the monster/lore getters --
   * Characters have no ItemKey, only a DatabaseTitleKey (PartnerName_*).
   */
  getCharacterDisplayName(character) {
    const entry = this.characterLocalization[character.titleKey];
    if (entry && entry.name) return entry.name;
    return character.code || character.titleKey;
  },

  isCharacterNameVerified(character) {
    const entry = this.characterLocalization[character.titleKey];
    return !!(entry && entry.verified);
  },

  getCharacterDescription(character) {
    const entry = this.characterLocalization[character.titleKey];
    return (entry && entry.description) || "";
  },

  isCharacterDescriptionVerified(character) {
    const entry = this.characterLocalization[character.titleKey];
    return !!(entry && entry.descriptionVerified);
  },

  /**
   * Returns the 8-stat record for one partner at one level (1-200),
   * or null if the code/level combination doesn't exist. Levels are
   * stored as string keys in the source JSON (matches the raw
   * DataTable's own row-key convention) -- this accepts a number or
   * string level and normalizes internally so callers (e.g. a slider's
   * input handler, which naturally produces a number) don't need to
   * remember that detail.
   */
  getPartnerStatsAtLevel(code, level) {
    const table = this.partnerStats[code];
    if (!table) return null;
    return table[String(level)] || null;
  },

  /**
   * Resolves a partner's weapon (weaponItemKey, e.g. "ItemName_WOS_1")
   * to its real display name via the SAME item localization this.localization
   * already used for weapons/armor -- not a separate lookup table.
   * Falls back to the raw key the same way getDisplayName() does for
   * an unverified weapon, and returns null entirely if this partner
   * has no resolvable weapon (weapon.weaponItemKey is null -- e.g. the
   * WeaponCategory didn't match a known category, or WeaponID was -1).
   */
  getPartnerWeaponName(character) {
    const weapon = character.weapon;
    if (!weapon || !weapon.weaponItemKey) return null;
    return this.getDisplayName(weapon.weaponItemKey);
  },

  /**
   * Combination Slash / Support Skill name + description, sourced from
   * Database/Characters/SkillLocalization/{lang}.json. `kind` is
   * "combo" or "support" -- selects which key prefix family to look
   * up (CombinationSrashName_* vs SupportSkillName_*; note "Srash" is
   * the real key spelling in the game's own data, not a typo
   * introduced here). Returns null if this character has no skill of
   * that kind at all (character.combinationSlash/.supportSkill is
   * null) -- distinct from "has the skill but it's unnamed", which
   * falls back to the raw skillTagName the normal way.
   */
  getPartnerSkillInfo(character, kind) {
    const skillField = kind === "combo" ? "combinationSlash" : "supportSkill";
    const namePrefix = kind === "combo" ? "CombinationSrashName" : "SupportSkillName";
    const skill = character[skillField];
    if (!skill || !skill.skillTagName) return null;
    const key = `${namePrefix}_${skill.skillTagName}`;
    const entry = this.partnerSkillLocalization[key];
    return {
      tagName: skill.skillTagName,
      name: (entry && entry.name) || skill.skillTagName,
      verified: !!(entry && entry.verified),
      description: (entry && entry.description) || "",
      descriptionVerified: !!(entry && entry.descriptionVerified),
      pointCost: kind === "combo" ? skill.cosPointCost : skill.susPointCost,
      maxStack: skill.maxStack, // only meaningful for support skills, undefined for combo -- callers should check kind, not just truthiness
    };
  },

  getAllWeaponsFlat() {
    return Object.values(this.weaponsByCategory).flat();
  },

  getAllArmorFlat() {
    return Object.values(this.armorByCategory).flat();
  },

  getAllSwordSkillsFlat() {
    return Object.values(this.swordSkillsByCategory).flat();
  },

  getAllEquipmentFlat() {
    return [...this.getAllWeaponsFlat(), ...this.getAllArmorFlat()];
  },

  getAllMonstersFlat() {
    return Object.values(this.monstersByCategory).flat();
  },

  getAllItemsFlat() {
    return Object.values(this.itemsByCategory).flat();
  },

  getAllRecipesFlat() {
    return Object.values(this.recipesByCategory).flat();
  },

  /**
   * Resolves an Asset Inspector mesh entry's itemKey to its real,
   * already-localized weapon/armor display name -- via the SAME
   * weapon/armor localization getDisplayName() already uses, not a
   * separate Asset-Inspector-specific name table. Returns null if the
   * mesh has no itemKey at all (HeadGear meshes -- not confirmed to
   * share the Upper/Lower/Glove/Shield ItemName_{slot}_{id}
   * convention, so left unresolved rather than guessed) or if the key
   * exists but has no name anywhere (e.g. Upper_6, a confirmed
   * pre-existing gap in the Armor data itself, not introduced here).
   */
  getMeshItemName(mesh) {
    if (!mesh.itemKey) return null;
    const name = this.getDisplayName(mesh.itemKey);
    return name === mesh.itemKey ? null : name; // getDisplayName() falls back to the raw key itself when unresolved -- treat that as "no name" here, not a real name
  },

  isMeshItemNameVerified(mesh) {
    if (!mesh.itemKey) return false;
    return this.isVerifiedName(mesh.itemKey);
  },

  getAllLoreFlat() {
    return this.loreList;
  },

  // Town getters
  getTownDisplayName(town) {
    const entry = this.townLocalization[town.nameKey];
    if (entry && entry.name) return entry.name;
    return town.nameKey;
  },
  isTownNameVerified(town) {
    const entry = this.townLocalization[town.nameKey];
    return !!(entry && entry.verified);
  },
  getAllTownsFlat() {
    return this.townList;
  },

  // Quest getters
  getQuestDisplayName(quest) {
    const entry = this.questLocalization[quest.nameKey];
    if (entry && entry.name) return entry.name;
    return quest.nameKey || quest.questId;
  },
  isQuestNameVerified(quest) {
    const entry = this.questLocalization[quest.nameKey];
    return !!(entry && entry.verified);
  },
  getQuestDescription(quest) {
    const entry = this.questLocalization[quest.nameKey];
    return (entry && entry.description) || "";
  },
  getQuestDungeonName(quest) {
    const entry = this.questLocalization[quest.nameKey];
    return (entry && entry.dungeonName) || "";
  },
  getAllQuestsFlat() {
    return this.questList;
  },

  getAllCharactersFlat() {
    return this.characterList;
  },

  getPartnersFlat() {
    return this.characterList.filter((c) => c.isPartner);
  },


  getModDefinition(modName) {
    return this.peculiarMods[modName] || null;
  },

  getExModByType(type) {
    return this.exModPool.find((m) => m.type === type) || null;
  },

  /**
   * Returns EX-MOD pool entries restricted to the tier range observed in
   * the demo (see DEMO_OBSERVED_MIN/MAX_TIER_INDEX in the build pipeline).
   * Each entry includes only its demo-observed tiers, not the full range,
   * plus the original index offset so values can be mapped back if needed.
   */
  getDemoExModOptions() {
    return this.exModPool.map((m) => {
      const lo = m.demoObservedMinTierIndex ?? 0;
      const hi = m.demoObservedMaxTierIndex ?? m.tiers.length - 1;
      return {
        ...m,
        tiers: m.tiers.slice(lo, hi + 1),
        tierIndexOffset: lo,
      };
    });
  },

  totalWeaponCount() {
    return this.getAllWeaponsFlat().length;
  },

  /**
   * Lazily fetches and caches one raw datatable file by its index
   * `path` (e.g. "DataAssets/Database/DT_MonsterDatabase.json"),
   * relative to Content/ROD/ -- same relative path the pipeline copied
   * it to. Not pre-fetched in loadAll() since some of these files are
   * 1MB+ and most sessions won't open the DT Inspector at all; this
   * only hits the network the first time a given table is actually
   * opened, and instantly returns the cached parse on every repeat
   * visit to the same table within this session.
   */
  async getDtInspectorFile(path) {
    if (this._dtInspectorFileCache[path]) {
      return this._dtInspectorFileCache[path];
    }
    const data = await fetchJSON(`${CONTENT_ROOT}/${path}`);
    this._dtInspectorFileCache[path] = data;
    return data;
  },

  /**
   * Lazily fetches and caches the full 4449-entry Wwise events list
   * (~3.2MB), only the first time WwiseAudioView is actually opened --
   * same "don't slow down every app load for a feature most sessions
   * won't use" reasoning as getDtInspectorFile() above.
   */
  async getWwiseEvents() {
    if (this._wwiseEventsCache) {
      return this._wwiseEventsCache;
    }
    const data = await fetchJSON(`${CONTENT_ROOT}/DataAssets/_WwiseAudio/events.json`);
    this._wwiseEventsCache = data;
    return data;
  },
};

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status}`);
  }
  return res.json();
}
