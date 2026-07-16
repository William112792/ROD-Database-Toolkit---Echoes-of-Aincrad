// lua-scripting.js
// Tools > Lua Scripting -- UE4SS Lua mod workbench over the export's
// own function surface: the lua_functions pipeline section indexes
// every Blueprint Function object FModel serialized (3,139 across 682
// blueprints in the current export) with its ready-to-paste
// RegisterHook path. Pick functions, insert snippets from the three
// template families the working example mods demonstrate, and download
// the assembled script as an installable ue4ss/Mods folder ZIP.
//
// HONEST LIMIT (mirrored from the index): only functions the JSON
// export CONTAINS are listed -- native C++ UFunctions live in the
// binary, which is the RODSchema signature workflow's territory.

const LuaScriptingView = {
  state: {
    loaded: false, fns: [], q: "", selectedIdx: null, tab: "presets",
    modName: "MyLuaMod",
    script: null,
  },

  TEMPLATES: {
    hook: (fn) => `-- Hook ${fn.functionName} (pattern: RegisterHook, like Yui_NoDemoBounds)
RegisterHook("${fn.hookPath}", function(self, ...)
    -- pre-hook: fires before the BP body. self = ${fn.className} instance.
    print("[{MOD}] ${fn.functionName} fired\\n")
end)
`,
    poll: (fn) => `-- Find live instances (pattern: FindAllOf loop, like AutoPickupMod)
local ok, instances = pcall(function() return FindAllOf("${fn.className}") end)
if ok and instances then
    for _, inst in ipairs(instances) do
        if inst:IsValid() then
            -- read/write properties, e.g.: inst.SomeProperty = 123
            print(string.format("[{MOD}] found %s\\n", inst:GetFullName()))
        end
    end
end
`,
    sigpatch: () => `-- Byte patch via AOB (pattern: NoCharacterFade -- UE4SS sig-scan mods)
-- NOTE: this style lives in a UE4SS "AOB patch" table mod, not main.lua hooks;
-- derive patterns with the RODSchema view's Memory Signatures workflow.
return {
  {
    pattern = 'eb ?? f3 0f 10 35 ?? ?? ?? ?? 45 8b c4',
    match = function(ctx)
      ctx[ctx:address() + 0] = 0x90  -- NOP
      ctx[ctx:address() + 1] = 0x90
    end
  }
}
`,
  },

  baseScript() {
    return `-- ${this.state.modName} — generated with the ROD Database Toolkit
local MOD_NAME = "${this.state.modName}"
local function log(msg) print(string.format("[%s] %s\\n", MOD_NAME, msg)) end
log("loaded")

`;
  },

  // Ready-made mods with editable parameters. Templates live in
  // app/lua-templates/ and are fetched as static files, so what you
  // download is what's on disk -- no drift between a "preview" and the
  // real script. {TOKEN} placeholders are substituted from the form.
  PRESETS: [
    {
      key: "debug_probe",
      name: "DebugProbe",
      title: "\u2605 Diagnostic probe \u2014 find out WHY a mod does nothing",
      blurb: "Changes nothing. Walks every assumption the failing mods depend on and reports which hold: is the hero findable and under what class name; are the AttributeSets reachable and WHO owns them; can a GAS attribute be read, written, and does the write stick; are the game's own functions callable (AddCol works \u2014 does DebugAddHeroExp?); does the item manager exist; is RegisterHook accepted. Writes PlayerProbe.txt. Send it back and every broken mod gets fixed from facts instead of another guess.",
      files: [{ path: "Scripts/main.lua", template: "debug_probe.lua" }],
      params: [
        { token: "PROBE_KEY", label: "Probe hotkey", type: "text", def: "F10" },
        { token: "TEST_WRITES", label: "Also test writing an attribute (safe \u2014 writes the same value back)", type: "bool", def: true },
      ],
    },
    {
      key: "kill_nearby",
      name: "KillNearby",
      title: "Kill / weaken nearby enemies on a hotkey",
      blurb: "Your idea, and it may fix the EXP mod too: ARODEnemyCharacter::KillingBlow(instigator, skillTag) is the game's OWN death path \u2014 the one it runs when you land the final hit. Called with you as the instigator, the kill, EXP, weapon proficiency, drops and quest counters should all follow for free, because we aren't awarding anything: we're telling the game you killed something. 'weaken' mode instead sets each enemy's Health to 1 and leaves the kill to you, which never fights the game's own logic. Bosses are skipped by default \u2014 a boss killed outside its scripted fight can strand a quest, and a stuck save is worse than a slow fight.",
      files: [{ path: "Scripts/main.lua", template: "kill_nearby.lua" }],
      params: [
        { token: "KILL_KEY", label: "Hotkey", type: "text", def: "F5" },
        { token: "MODE", label: "Mode: kill (game's death path) or weaken (set to 1 HP)", type: "text", def: "kill" },
        { token: "WEAKEN_TO", label: "Weaken mode: HP to set", type: "number", def: 1 },
        { token: "RADIUS", label: "Radius in cm (3000 = 30m)", type: "number", def: 3000 },
        { token: "INCLUDE_BOSSES", label: "Include bosses (risky \u2014 can strand a quest)", type: "bool", def: false },
      ],
    },
    {
      key: "world_logger",
      name: "WorldLogger",
      title: "Log map loads, streaming levels and actor spawns",
      blurb: "Watches what the game actually does instead of inferring it from a static export. Logs every map travel (this is how PL_CharacterMake was identified), every streaming level as it comes and goes \u2014 which is exactly what decides whether a chest or gimmick actor exists to be captured \u2014 and optionally every actor as it spawns (enemies, barriers, gimmicks), filtered by class name so it isn't a firehose. Writes WorldLog.txt, flushed every line, because a crash is when you most want the log.",
      files: [{ path: "Scripts/main.lua", template: "world_logger.lua" }],
      params: [
        { token: "LOG_MAP_LOADS", label: "Log map/world loads", type: "bool", def: true },
        { token: "LOG_STREAMING_LEVELS", label: "Log streaming levels (cells)", type: "bool", def: true },
        { token: "LOG_NEW_ACTORS", label: "Log actor spawns", type: "bool", def: false },
        { token: "ACTOR_FILTERS", label: "Only log actors matching these (comma-separated, quoted)", type: "text", def: "\"Enemy\", \"TBox\", \"Gimmick\", \"Barrier\", \"Chest\"" },
        { token: "STREAM_POLL_MS", label: "Streaming poll (ms)", type: "number", def: 2000 },
      ],
    },
    {
      key: "progression_logger",
      name: "ProgressionLogger",
      title: "\u2605 Log EXP, weapon proficiency, stats and rank",
      blurb: "The mod that unblocks the others. DebugProbe found FindFirstOf(\"RODUserInfo\") returns nothing \u2014 which is why the EXP and level mods had nothing to write to. But UserInfo isn't free-floating: it's held by URODSaveLoadSubsystem.RODUserInfo, so you reach it through its OWNER. That makes Level, Experience, GrowPoint and WeaponExperienceData (level + EXP PER WEAPON TYPE) all readable. Also dumps every GAS attribute the hero owns (ATK/BaseATK/CoefATK/BonusATK, DEF and its Base/Coef/Bonus, Health, Stamina, Soul, Strain, SuSPoint...) \u2014 which is where VIT/END/MND/STR/DEX/AGI/INT actually show up: those letters aren't attributes, they're inputs the game turns into these Base/Coef/Bonus numbers. Snapshot before and after a level-up and diff. Cardinal Rank isn't named anywhere in the SDK, so the mod hunts for it rather than pretending to know \u2014 snapshot before and after a rank-up and whatever moved is it.",
      files: [{ path: "Scripts/main.lua", template: "progression_logger.lua" }],
      params: [
        { token: "LOG_KEY", label: "Snapshot hotkey", type: "text", def: "F11" },
        { token: "AUTO_MS", label: "Also snapshot every (ms, 0 = off)", type: "number", def: 0 },
      ],
    },
    {
      key: "drop_rate_scaling",
      name: "DropRateScaling",
      title: "Scale item drop rates",
      blurb: "Edits DT_RewardLotTable and DT_ItemLotTable live via StaticFindObject + GetRowMap \u2014 the technique from your reference mod, which I had wrongly concluded was impossible. The key insight from the real data: each enemy's reward list contains a LotItemKey of \"None\" \u2014 the NOTHING slot \u2014 and its weight is usually the largest (Boar01: Material 1, Food 2, None 12). So raising drop rates means SHRINKING the None weight; inflating item weights only changes WHICH item drops, not WHETHER one does. Originals are snapshotted, so re-applying never compounds.",
      files: [{ path: "Scripts/main.lua", template: "drop_rate_scaling.lua" }],
      params: [
        { token: "NO_DROP_DIVISOR", label: "Divide the \"no drop\" weight by (1 = off)", type: "number", def: 12 },
        { token: "ITEM_WEIGHT_MULTIPLIER", label: "Item weight multiplier", type: "number", def: 1 },
        { token: "QUANTITY_MULTIPLIER", label: "Drop quantity multiplier", type: "number", def: 1 },
        { token: "APPLY_KEY", label: "Re-apply hotkey", type: "text", def: "F6" },
        { token: "RETRY_MS", label: "Retry every (ms)", type: "number", def: 1500 },
        { token: "RETRIES", label: "Retries while the table loads", type: "number", def: 20 },
      ],
    },
    {
      key: "auto_riposte",
      name: "AutoRiposte",
      title: "Auto Reversal Slash (riposte fires itself)",
      blurb: "Watches ARODHeroCharacter::bRiposteChance and calls ActivateRiposteSlashSkill on the nearest enemy the instant the counter window opens \u2014 no button press. Fires on the RISING EDGE only, so one window produces one counter rather than a stream of calls into a skill that's already committed, and it won't swing at air if no enemy is in range.",
      files: [{ path: "Scripts/main.lua", template: "auto_riposte.lua" }],
      params: [
        { token: "POLL_MS", label: "Poll every (ms)", type: "number", def: 50 },
        { token: "MAX_RANGE", label: "Max target range (cm)", type: "number", def: 800 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F6" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
        { token: "VERBOSE", label: "Log each counter", type: "bool", def: false },
      ],
    },
    {
      key: "no_rescue",
      name: "NoRescue",
      title: "No rescue (stop the teleport-back after a fall)",
      blurb: "The game 'rescues' you after a long drop or sinking into water by teleporting you back to a known location \u2014 which is exactly what you don't want while mapping. This raises the death-landing height so the rescue never fires, and re-applies after a respawn by hooking the engine's own /Script/Engine.PlayerController:ClientRestart. Trade-off stated plainly: with the rescue off, a fall into real void geometry has no safety net \u2014 keep a save.",
      files: [{ path: "Scripts/main.lua", template: "no_rescue.lua" }],
      params: [
        { token: "LANDING_HEIGHT", label: "Death landing height (game default ~780)", type: "number", def: 1000000000 },
        { token: "REAPPLY_MS", label: "Re-apply delay after respawn (ms)", type: "number", def: 1500 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F6" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "enemy_finder",
      name: "EnemyFinder",
      title: "List / dump nearby enemies (monsters)",
      blurb: "Reports the enemies actually loaded in memory right now, sorted by distance, with each one's HP read from ITS OWN attribute set (matched by owner \u2014 never a blanket FindAllOf, which would hand you the player's set or another monster's). Skips Class Default Objects and unplaced (0,0,0) actors. The dump key writes EnemyLocations.json.",
      files: [{ path: "Scripts/main.lua", template: "enemy_finder.lua" }],
      params: [
        { token: "LIST_KEY", label: "List hotkey", type: "text", def: "F7" },
        { token: "DUMP_KEY", label: "Dump-to-JSON hotkey", type: "text", def: "F8" },
        { token: "MAX_RESULTS", label: "How many to print", type: "number", def: 10 },
      ],
    },
    {
      key: "terminal_finder",
      name: "TerminalFinder",
      title: "List / dump warp terminals & safe areas",
      blurb: "The game treats these as one family (ARODActivatableTerminalBase); the id prefix separates them \u2014 SA_ safe area, WT_ town warp terminal, TG_ quest terminal \u2014 so they're grouped by prefix rather than lumped together. Writes TerminalLocations.json, which can be uploaded on the Build Dashboard to fill in coordinates the static export doesn't contain.",
      files: [{ path: "Scripts/main.lua", template: "terminal_finder.lua" }],
      params: [
        { token: "LIST_KEY", label: "List hotkey", type: "text", def: "F7" },
        { token: "DUMP_KEY", label: "Dump-to-JSON hotkey", type: "text", def: "F8" },
      ],
    },
    {
      key: "shop_stock",
      name: "ShopStock",
      title: "Stock the Item Seller + Smithy (all consumables & armour recipes)",
      experimental: "Uses live DataTable editing (StaticFindObject + GetRowMap), proven by your DropRateScaling reference mod. The fragile part is mutating the nested TArray/TMap from Lua. If the mod reports success but the shop looks unchanged, that's what failed \u2014 use tools/build_modpak.py, which patches the same table permanently.",
      blurb: "I previously said this needed a mod pak. Your reference mods proved me wrong: DataTables can be edited at runtime. Adds all 61 buyable consumables to ShopList rank 1, and all 60 Upper/Lower/Glove/Shield recipes to BlacksmithCreateList rank 1 (which is EMPTY in vanilla). The ids are generated from the toolkit's own verified data because the table uses TWO ID SPACES: ShopList takes {Category, ItemId} pairs, while BlacksmithCreateList takes RECIPE-MAP KEYS scoped by ERecipeKind (Upper #5001 = UpperRecipeDataAsMap[\"5001\"]) \u2014 confusing them once left 18 of 19 blacksmith entries dead in this project.",
      files: [{ path: "Scripts/main.lua", template: "shop_stock.lua" }],
      params: [
        { token: "ADD_CONSUMABLES", label: "Add all consumables to the Item Seller", type: "bool", def: true },
        { token: "ADD_ARMOUR_RECIPES", label: "Add all armour/shield recipes to the Smithy", type: "bool", def: true },
        { token: "RANK", label: "Shop rank to add them to", type: "text", def: "1" },
        { token: "APPLY_KEY", label: "Re-apply hotkey", type: "text", def: "F6" },
        { token: "RETRY_MS", label: "Retry every (ms)", type: "number", def: 1500 },
        { token: "RETRIES", label: "Retries while the table loads", type: "number", def: 20 },
      ],
    },
    {
      key: "stack_size",
      name: "StackSizePlus",
      title: "Raise item stack limits (5 → 99)",
      blurb: "Every consumable in UseItemDataAsMap ships with MaxStack 5 (verified in the real export; the Heal map is already 999). This rewrites MaxStack on the live RODItemDataAsset at runtime.",
      files: [{ path: "Scripts/main.lua", template: "stack_size.lua" }],
      params: [
        { token: "NEW_MAX_STACK", label: "New max stack", type: "number", def: 99 },
        { token: "INCLUDE_MATERIALS", label: "Also raise materials (vanilla: unlimited)", type: "bool", def: false },
        { token: "INCLUDE_HEAL", label: "Also raise Heal map (vanilla: already 999)", type: "bool", def: false },
      ],
    },
    {
      key: "inventory_slots",
      experimental: "Reported not working. Needs troubleshooting.",
      name: "InventorySlots",
      title: "Inventory grid slots (15 → 20/30)",
      blurb: "No inventory-capacity field exists in the JSON exports — but the game's SDK has exactly one candidate: URODGridListWidgetBase (GridColumn/GridRow/GridItemMax). Ships in DUMP mode: it logs the real live values first so you can confirm before changing them.",
      files: [{ path: "Scripts/main.lua", template: "inventory_slots.lua" }],
      params: [
        { token: "SET_ENABLED", label: "Actually change values (leave off to dump first)", type: "bool", def: false },
        { token: "NEW_GRID_ROW", label: "New grid rows (0 = leave alone)", type: "number", def: 0 },
        { token: "NEW_ITEM_MAX", label: "New GridItemMax", type: "number", def: 30 },
        { token: "RESTRICT_TO_NAME", label: "Only grids whose name contains", type: "text", def: "Item" },
      ],
    },
    {
      key: "player_speed",
      name: "PlayerSpeed",
      title: "Movement speed multiplier (default 4x)",
      blurb: "Multiplies CharacterMovement's MaxWalkSpeed. It re-asserts on a timer rather than writing once, because the game rewrites your speed whenever your state changes (sprint, combat, stagger) — a one-shot write silently reverts the first time you sprint. The original speed is learned once so 4x can never compound into 16x. Hotkey toggles it.",
      files: [{ path: "Scripts/main.lua", template: "player_speed.lua" }],
      params: [
        { token: "MULTIPLIER", label: "Speed multiplier", type: "number", def: 4 },
        { token: "INTERVAL_MS", label: "Re-assert every (ms)", type: "number", def: 100 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F6" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "attack_speed",
      name: "AttackSpeed",
      title: "Attack speed multiplier (default 4x)",
      blurb: "EnhAtkSpeed on URODAvatarAttributeSet — a plain float, not a GAS attribute like HP/Stamina, so it's written directly. It's an enhancement value layered on the base attack rate, so the mod multiplies whatever the game currently has rather than assuming a scale; if the base is 0 (no bonus) it applies the multiplier as a flat bonus and says so in the log instead of silently doing nothing.",
      files: [{ path: "Scripts/main.lua", template: "attack_speed.lua" }],
      params: [
        { token: "MULTIPLIER", label: "Attack speed multiplier", type: "number", def: 4 },
        { token: "INTERVAL_MS", label: "Re-assert every (ms)", type: "number", def: 200 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F3" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "always_full_hp",
      experimental: "Does nothing in testing. Attribute-set resolution is the prime suspect; run DebugProbe.",
      name: "AlwaysFullHP",
      title: "Always 100% HP",
      blurb: "Restores HP to max whenever it drops. HP is URODDefensiveAttributeSet.Health — a Gameplay Ability System attribute, NOT a field on the character (the character has no .Health at all, which is why any mod doing hero.Health = x writes into nothing and fails silently). The set is matched back to the hero through its owner, so enemies are never healed.",
      files: [{ path: "Scripts/main.lua", template: "always_full_hp.lua" }],
      params: [
        { token: "INTERVAL_MS", label: "Check every (ms)", type: "number", def: 200 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F5" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "always_full_sp",
      experimental: "Does nothing in testing. Same suspected cause as AlwaysFullHP.",
      name: "AlwaysFullSP",
      title: "Always 100% SP",
      blurb: "SP is 'Soul' in the code — confirmed by the game's own SP bar widget, URODHeroStatusSoulGaugeWidgetBase. Restores Avatar.Soul to MaxSoul whenever it drops.",
      files: [{ path: "Scripts/main.lua", template: "always_full_sp.lua" }],
      params: [
        { token: "INTERVAL_MS", label: "Check every (ms)", type: "number", def: 200 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F5" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "always_full_stamina",
      experimental: "Does nothing in testing. Same suspected cause as AlwaysFullHP.",
      name: "AlwaysFullStamina",
      title: "Always 100% Stamina",
      blurb: "Restores Avatar.Stamina to MaxStamina whenever it drops. Polls fast by default because stamina drains continuously while sprinting — a slow poll shows a visible sawtooth on the bar.",
      files: [{ path: "Scripts/main.lua", template: "always_full_stamina.lua" }],
      params: [
        { token: "INTERVAL_MS", label: "Check every (ms)", type: "number", def: 150 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F5" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "stamina_max_multiplier",
      experimental: "Unconfirmed \u2014 depends on the same attribute-set access as the HP mods.",
      name: "StaminaMax",
      title: "Multiply MAX Stamina (default 4x)",
      blurb: "Multiplies Avatar.MaxStamina. Learns the game's own max from any value that isn't its own output, so 4x can never compound into 16x on the next tick. Restores the original on toggle-off.",
      files: [{ path: "Scripts/main.lua", template: "stamina_max_multiplier.lua" }],
      params: [
        { token: "MULTIPLIER", label: "Max stamina multiplier", type: "number", def: 4 },
        { token: "INTERVAL_MS", label: "Re-assert every (ms)", type: "number", def: 500 },
        { token: "TOGGLE_KEY", label: "Toggle hotkey", type: "text", def: "F2" },
        { token: "START_ENABLED", label: "Enabled on load", type: "bool", def: true },
      ],
    },
    {
      key: "grant_col",
      name: "GrantCol",
      title: "Grant Col on a hotkey (default 9000)",
      blurb: "Standalone. Uses ARODPlayerState::AddCol — the game's own grant path, the same one a real pickup runs, so balance, UI and save all agree.",
      files: [{ path: "Scripts/main.lua", template: "grant_col.lua" }],
      params: [
        { token: "COL_KEY", label: "Hotkey", type: "text", def: "F8" },
        { token: "COL_AMOUNT", label: "Col per press", type: "number", def: 9000 },
      ],
    },
    {
      key: "grant_exp",
      experimental: "Installs but does nothing in testing. Run DebugProbe: DebugAddHeroExp may not be callable from Lua, or may be server-gated. KillNearby may be the real answer \u2014 killing an enemy the game's own way awards EXP through the normal path.",
      name: "GrantEXP",
      title: "Grant player EXP on a hotkey (default 9000)",
      blurb: "Replaces the level-swap mod, which didn't work — and your diagnosis was right. Col worked because it used the game's OWN grant function; the level swap poked URODUserInfo::Level, a field the game recomputes from EXP, so the write didn't stick. This uses ARODInGamePlayerController::ServerDebugAddHeroExp (falling back to the local DebugAddHeroExp), so level-ups, stat points and the UI all follow naturally — it's the path the game runs when you kill something.",
      files: [{ path: "Scripts/main.lua", template: "grant_exp.lua" }],
      params: [
        { token: "EXP_KEY", label: "Hotkey", type: "text", def: "F7" },
        { token: "EXP_AMOUNT", label: "EXP per press", type: "number", def: 9000 },
      ],
    },
    {
      key: "teleport_safe_area",
      name: "TeleportSafeArea",
      title: "Teleport to the nearest Safe Area",
      blurb: "Replaces the fast-travel-map mod, which opened a half-built screen you couldn't close. That menu is opened BY a Safe Area terminal, which supplies the state the widget needs and owns the close path — calling the opener without that context gives you a broken screen with no way out. Rather than fake the context, this does what you actually wanted: finds the nearest SA_ terminal actor and moves you to it. No menu, so nothing can trap you. Skips WT_ town warp terminals (you don't need this in town) and refuses to teleport to an unplaced (0,0,0) actor.",
      files: [{ path: "Scripts/main.lua", template: "teleport_safe_area.lua" }],
      params: [
        { token: "TELEPORT_KEY", label: "Hotkey", type: "text", def: "F9" },
        { token: "MAX_DISTANCE", label: "Max distance in cm (0 = no limit)", type: "number", def: 0 },
        { token: "Z_OFFSET", label: "Land this far above the terminal (cm)", type: "number", def: 150 },
      ],
    },
    {
      key: "character_creator",
      experimental: "Doesn't travel in testing. Kept as a placeholder \u2014 it correctly identifies PL_CharacterMake as the level to investigate.",
      name: "CharacterCreator",
      title: "Open the Character Creator level (experimental)",
      blurb: "Built from your UE4SS console find: the creator is its own LEVEL (/Game/ROD/Maps/ROD/PL_CharacterMake), not a widget. So this travels to it with the engine's own `open` command. WARNING — this is a map change, not an overlay: it unloads the world you're standing in, anything unsaved is lost, and the creator's exit flow may not know where to send you back. Double-press by default so a stray keypress can't yank you out of the world. Whether edits carry back to your character is exactly what testing will answer.",
      files: [{ path: "Scripts/main.lua", template: "character_creator.lua" }],
      params: [
        { token: "OPEN_KEY", label: "Hotkey", type: "text", def: "F4" },
        { token: "LEVEL", label: "Level to open", type: "text", def: "/Game/ROD/Maps/ROD/PL_CharacterMake" },
        { token: "CONFIRM_WINDOW_MS", label: "Double-press window (ms, 0 = no confirm)", type: "number", def: 3000 },
      ],
    },
    {
      key: "town_chest_999",
      experimental: "Installs but does nothing in testing. Either RegisterHook is rejected or the item manager isn't reachable \u2014 DebugProbe reports which.",
      name: "TownChest999",
      title: "Town Chest: set items & materials to 999 on open",
      blurb: "Hooks ARODChestBase:BP_OnOpenUI — the town chest's own open event (field treasure boxes are a different class, ARODTBoxBase, which is the chest_town vs chest split the gimmick dump already shows). Sets Num on every entry in the item manager's Items and MaterialItems arrays. Quantities are SET, not topped up, so a stack already above 999 comes down to it, as asked. Equipment is excluded by default: weapons and armour are unique instances with their own upgrade state, and a stack of 999 of one sword isn't something the game models — enabling it is more likely to corrupt an inventory than help. A hotkey fallback is included in case a patch ever breaks the hook.",
      files: [{ path: "Scripts/main.lua", template: "town_chest_999.lua" }],
      params: [
        { token: "QUANTITY", label: "Quantity", type: "number", def: 999 },
        { token: "INCLUDE_ITEMS", label: "Consumables (Items)", type: "bool", def: true },
        { token: "INCLUDE_MATERIALS", label: "Materials", type: "bool", def: true },
        { token: "INCLUDE_EQUIPMENT", label: "Equipment (NOT recommended)", type: "bool", def: false },
        { token: "MANUAL_KEY", label: "Manual trigger hotkey", type: "text", def: "F4" },
      ],
    },
    {
      key: "gimmick_dump",
      name: "GimmickDump",
      title: "Dump ALL gimmick locations (chests, arks, seals, trinkets, lore…)",
      blurb: "v2 of the chest dumper. Every gimmick derives from ARODGimmickBase, so one sweep captures chests, side-quest trinkets, seals, sealed arks, lore tips, terminals, gift pillars and the town Smithy/Item Seller — instead of walking the world once per type. Each capture records the CHUNK the actor lives in (from its own package path, not where you were standing) and the quest active at the time. Gimmicks only exist while their streaming cell is loaded, and a named area spans several cells — so walk the ground. Uploads MERGE, so many sessions add up.",
      files: [{ path: "Scripts/main.lua", template: "gimmick_dump.lua" }],
      params: [
        { token: "SCAN_INTERVAL_MS", label: "Re-scan every (ms)", type: "number", def: 20000 },
        { token: "AUTOSAVE_EVERY_SCANS", label: "Auto-save every N scans (0 = off)", type: "number", def: 3 },
        { token: "DUMP_KEY", label: "Dump hotkey", type: "text", def: "F10" },
        { token: "VERBOSE", label: "Log every new capture (id + kind + chunk)", type: "bool", def: true },
      ],
    },
    {
      key: "chest_locations_dump",
      name: "ChestLocatorDump",
      title: "Dump chest coordinates only (v1 — superseded by GimmickDump)",
      blurb: "DT_FixTBoxTable carries only loot keys — no coordinates, and the chest IDs appear in NO level file. The SDK explains why: a chest is ARODTBoxBase, whose ID is a LocatorName assigned by a gimmick locator that isn't in the export. But it's all there at runtime, typed — so this reads LocatorName + world location straight off the live actors. No memory scanning, no signatures. Walk the world, press F10, upload the JSON.",
      files: [{ path: "Scripts/main.lua", template: "chest_locations_dump.lua" }],
      params: [
        { token: "SCAN_INTERVAL_MS", label: "Re-scan every (ms)", type: "number", def: 5000 },
        { token: "AUTOSAVE_EVERY_SCANS", label: "Auto-save every N scans (0 = off)", type: "number", def: 12 },
        { token: "DUMP_KEY", label: "Dump hotkey", type: "text", def: "F10" },
        { token: "INCLUDE_LOCATORS", label: "Also read gimmick locators (captures more)", type: "bool", def: true },
      ],
    },
    {
      key: "battle_healing",
      experimental: "Rewritten to use attribute sets (it previously wrote hero.Health \u2014 a field that does not exist \u2014 and searched for 'ROHeroCharacter', missing the D). Unverified since the rewrite.",
      name: "BattleHealing",
      title: "Battle healing passive (staged HP/SP regen)",
      blurb: "Simplified single-file version of the Kirito_Battle_Healing example: staged regeneration that ramps the longer you stay in combat.",
      files: [{ path: "Scripts/main.lua", template: "battle_healing.lua" }],
      params: [
        { token: "BATTLE_HEAL_DELAY", label: "Seconds in combat before healing", type: "number", def: 5 },
        { token: "RECOVERY_INTERVAL_MS", label: "Tick interval (ms)", type: "number", def: 1000 },
        { token: "STAGE_1_HP_RECOVERY", label: "Stage 1 HP %/tick", type: "number", def: 2 },
        { token: "STAGE_1_SP_RECOVERY", label: "Stage 1 SP %/tick", type: "number", def: 2 },
        { token: "STAGE_2_START_SECONDS", label: "Stage 2 starts at (s)", type: "number", def: 10 },
        { token: "STAGE_2_HP_RECOVERY", label: "Stage 2 HP %/tick", type: "number", def: 4 },
        { token: "STAGE_2_SP_RECOVERY", label: "Stage 2 SP %/tick", type: "number", def: 4 },
        { token: "STAGE_3_START_SECONDS", label: "Stage 3 starts at (s)", type: "number", def: 25 },
        { token: "STAGE_3_HP_RECOVERY", label: "Stage 3 HP %/tick", type: "number", def: 8 },
        { token: "STAGE_3_SP_RECOVERY", label: "Stage 3 SP %/tick", type: "number", def: 8 },
      ],
    },
    {
      key: "companion_be_quiet",
      name: "CompanionBeQuiet",
      title: "Mute companion callout voice-lines",
      blurb: "Your own multi-file mod, packaged as-is (main.lua + features/eoa31_voice.lua + config.lua). Edit config.lua after install for finer control — the toggle below just flips VoiceLineReducer.Enabled.",
      files: [
        { path: "Scripts/main.lua", template: "companion_be_quiet/main.lua" },
        { path: "Scripts/features/eoa31_voice.lua", template: "companion_be_quiet/eoa31_voice.lua" },
        { path: "Scripts/config.lua", template: "companion_be_quiet/config.lua" },
      ],
      params: [{ token: "__ENABLED__", label: "Enabled", type: "bool", def: true }],
    },
  ],

  async render(container) {
    container.innerHTML = "";
    if (!this.state.loaded) {
      try {
        this.state.fns = await (await fetch("Content/ROD/DataAssets/Database/Modding/LuaFunctions.json")).json();
      } catch (e) {
        container.innerHTML = `<div class="hud-panel"><div class="empty-state"><p>Lua function index not built yet.</p><p style="font-size:11px; opacity:0.75;">Run the <b>Lua Function Index</b> section from the Build Dashboard after uploading Blueprint exports.</p></div></div>`;
        return;
      }
      if (this.state.script == null) this.state.script = this.baseScript();
      this.state.loaded = true;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="coverage-banner">
        <span><b>${this.state.fns.length}</b> hookable Blueprint functions across <b>${new Set(this.state.fns.map((f) => f.blueprint)).size}</b> blueprints</span>
        <span style="margin-left:auto; opacity:0.6;" title="Only functions the JSON export contains are listed. Native C++ UFunctions live in the binary — that's the RODSchema Memory Signatures workflow. ExecuteUbergraph_* is the whole event graph (hook it to catch every BP event, coarse); BndEvt__* are component delegate bindings.">what's listed — hover</span>
      </div>
      <div class="sub-tabs" style="margin-bottom:12px;">
        <button class="toggle-btn${this.state.tab !== "build" ? " active" : ""}" data-luatab="presets">Mod Presets</button>
        <button class="toggle-btn${this.state.tab === "build" ? " active" : ""}" data-luatab="build">Function Browser</button>
      </div>
      <div id="luaPresetsPane" style="${this.state.tab === "build" ? "display:none;" : ""}"></div>
      <div class="equip-layout two-col" id="luaBuildPane" style="--list-col: 420px; ${this.state.tab === "build" ? "" : "display:none;"}">
        <div>
          <input id="luaSearch" class="hud-input" type="text" placeholder="Search functions / blueprints (e.g. Pickup, Equip, Damage)…" value="${escapeHtml(this.state.q)}" style="width:100%; margin-bottom:6px;"/>
          <div id="luaFnList" style="max-height:calc(100vh - 320px); overflow-y:auto;"></div>
        </div>
        <div>
          <div class="hud-panel" style="padding:12px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
              <span style="font-family:var(--font-display); font-size:12px; font-weight:600; color:var(--db-cyan-bright);">SCRIPT</span>
              <input id="luaModName" value="${escapeHtml(this.state.modName)}" style="font-family:var(--font-mono); font-size:11px; background:rgba(4,12,16,0.7); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:3px; padding:3px 6px; width:180px;" title="Mod folder name (ue4ss/Mods/<name>)"/>
              <button class="toggle-btn" id="luaDownload" style="margin-left:auto; border-color:var(--db-cyan-bright); color:var(--db-cyan-bright);">⬇ Download mod ZIP</button>
            </div>
            <div id="luaSnippetBtns" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;"></div>
            <textarea id="luaScript" spellcheck="false" style="width:100%; min-height:340px; background:rgba(4,12,16,0.7); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:4px; font-family:var(--font-mono); font-size:11px; padding:8px;"></textarea>
            <div style="font-size:9.5px; color:var(--hud-text-dim); margin-top:4px;">ZIP layout: <code>&lt;name&gt;/Scripts/main.lua</code> + <code>enabled.txt</code> — drop into <code>ue4ss/Mods/</code>. Snippet families are modeled on the three working example mods (RegisterHook · FindAllOf loop · AOB byte patch).</div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(wrap);
    wrap.querySelectorAll("[data-luatab]").forEach((b) => b.addEventListener("click", () => {
      this.state.tab = b.dataset.luatab;
      this.render(container);
    }));
    this.renderPresets();
    document.getElementById("luaScript").value = this.state.script;
    document.getElementById("luaScript").addEventListener("input", (e) => { this.state.script = e.target.value; });
    document.getElementById("luaModName").addEventListener("input", (e) => { this.state.modName = e.target.value; });
    document.getElementById("luaSearch").addEventListener("input", (e) => { this.state.q = e.target.value; this.renderList(); });
    document.getElementById("luaDownload").addEventListener("click", () => this.download());
    this.renderList();
    this.renderSnippetBtns();
  },

  filtered() {
    const q = this.state.q.trim().toLowerCase();
    let fns = this.state.fns;
    if (q) fns = fns.filter((f) => f.functionName.toLowerCase().includes(q) || f.blueprint.toLowerCase().includes(q));
    return fns.slice(0, 400); // render cap; search narrows
  },

  renderList() {
    const pane = document.getElementById("luaFnList");
    const fns = this.filtered();
    pane.innerHTML = fns.map((f) => {
      const gi = this.state.fns.indexOf(f);
      return `
      <div class="weapon-list-row${gi === this.state.selectedIdx ? " selected" : ""}" data-fn="${gi}">
        <div style="flex:1; min-width:0;">
          <div class="wl-name" style="font-family:var(--font-mono); font-size:11px;">${escapeHtml(f.functionName)}</div>
          <div class="wl-id">${escapeHtml(f.blueprint)}${f.isUbergraph ? " · event graph" : ""}${f.isDelegateBinding ? " · delegate binding" : ""}${f.classNameDerived ? " · class name derived" : ""}</div>
        </div>
      </div>`;
    }).join("") + (this.state.fns.length > fns.length && this.state.q ? "" : this.state.fns.length > 400 && !this.state.q ? `<div style="font-size:10px; color:var(--hud-text-dim); padding:6px;">Showing first 400 — search to narrow ${this.state.fns.length} functions.</div>` : "");
    pane.querySelectorAll("[data-fn]").forEach((row) => row.addEventListener("click", () => {
      this.state.selectedIdx = +row.dataset.fn;
      this.renderList();
      this.renderSnippetBtns();
    }));
  },

  renderSnippetBtns() {
    const el = document.getElementById("luaSnippetBtns");
    const fn = this.state.selectedIdx != null ? this.state.fns[this.state.selectedIdx] : null;
    el.innerHTML = `
      ${fn ? `<span style="font-family:var(--font-mono); font-size:9.5px; color:var(--hud-text-dim); align-self:center; max-width:100%; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(fn.hookPath)}">${escapeHtml(fn.hookPath)}</span><br/>` : `<span style="font-size:10px; color:var(--hud-text-dim); align-self:center;">Select a function to insert targeted snippets:</span>`}
      <button class="toggle-btn" id="luaInsHook" ${fn ? "" : "disabled"} title="RegisterHook on the selected function (Yui_NoDemoBounds pattern)">+ RegisterHook</button>
      <button class="toggle-btn" id="luaInsPoll" ${fn ? "" : "disabled"} title="FindAllOf over the selected function's class (AutoPickupMod pattern)">+ FindAllOf loop</button>
      <button class="toggle-btn" id="luaInsSig" title="AOB byte-patch table mod skeleton (NoCharacterFade pattern)">+ AOB patch skeleton</button>
    `;
    const ins = (text) => {
      this.state.script += "\n" + text.replaceAll("{MOD}", this.state.modName);
      document.getElementById("luaScript").value = this.state.script;
    };
    if (fn) {
      document.getElementById("luaInsHook").addEventListener("click", () => ins(this.TEMPLATES.hook(fn)));
      document.getElementById("luaInsPoll").addEventListener("click", () => ins(this.TEMPLATES.poll(fn)));
    }
    document.getElementById("luaInsSig").addEventListener("click", () => ins(this.TEMPLATES.sigpatch()));
  },

  renderPresets() {
    const pane = document.getElementById("luaPresetsPane");
    if (!pane) return;
    this.presetState = this.presetState || {};
    pane.innerHTML = this.PRESETS.map((p) => {
      const st = (this.presetState[p.key] = this.presetState[p.key] || Object.fromEntries(p.params.map((x) => [x.token, x.def])));
      return `
      <div class="hud-panel" style="padding:14px; margin-bottom:12px;">
        <div style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--db-cyan-bright); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span>${escapeHtml(p.title)}</span>
          ${p.experimental ? `<span class="pill unverified" style="font-size:9px; flex-shrink:0;">EXPERIMENTAL</span>` : ""}
        </div>
        <div style="font-size:10.5px; color:var(--hud-text-dim); margin:4px 0 8px;">${escapeHtml(p.blurb)}</div>
        ${p.experimental ? `
          <div class="mod-callout unresolved" style="margin:0 0 8px;">
            <div class="mod-name">Doesn't work yet — tracked, not abandoned</div>
            <div class="mod-effect-line">${escapeHtml(p.experimental)}</div>
          </div>` : ""}
        <div style="display:flex; flex-wrap:wrap; gap:10px 16px; margin-bottom:8px;">
          ${p.params.filter((x) => x.token !== "__ENABLED__" || p.key === "companion_be_quiet").map((x) => `
            <label style="font-size:11px; color:var(--hud-text); display:flex; align-items:center; gap:5px;">
              ${x.type === "bool"
                ? `<input type="checkbox" data-pk="${p.key}" data-pt="${x.token}" ${st[x.token] ? "checked" : ""}/>`
                : `<input type="${x.type === "number" ? "number" : "text"}" data-pk="${p.key}" data-pt="${x.token}" value="${escapeHtml(String(st[x.token]))}" style="width:${x.type === "number" ? "70px" : "110px"}; background:rgba(4,12,16,0.7); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:3px; padding:2px 5px; font-family:var(--font-mono); font-size:11px;"/>`}
              ${escapeHtml(x.label)}
            </label>`).join("")}
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input data-pname="${p.key}" value="${escapeHtml(p.name)}" style="font-family:var(--font-mono); font-size:11px; background:rgba(4,12,16,0.7); color:var(--hud-text); border:1px solid var(--hud-border); border-radius:3px; padding:3px 6px; width:170px;" title="Mod folder name"/>
          <button class="toggle-btn" data-pdl="${p.key}" style="border-color:var(--db-cyan-bright); color:var(--db-cyan-bright);">⬇ Download mod ZIP</button>
          <button class="toggle-btn" data-pload="${p.key}" title="Load into the Function Browser's editor to tweak by hand">Open in editor</button>
        </div>
      </div>`;
    }).join("") + `
      <div class="mod-callout" style="margin-top:0;">
        <div class="mod-name">Shop / Smithy stocking is NOT a Lua job</div>
        <div class="mod-effect-line">
          "Add every item to the shop" and "add every recipe to the blacksmith" are <b>DataTable edits</b>
          (DT_ShopItemList's single Shop row), not runtime object writes — doing them in Lua would mean
          fighting the game's own table every load. They're in <b>Tools › RODSchema</b> as one-click presets
          ("Fill the Item Seller — all 59 recipes", "Fill the Smithy — all 186 recipes"), generated from your
          real export's ids.
        </div>
      </div>`;

    pane.querySelectorAll("[data-pk]").forEach((inp) => inp.addEventListener("input", () => {
      const st = this.presetState[inp.dataset.pk];
      st[inp.dataset.pt] = inp.type === "checkbox" ? inp.checked
        : (inp.type === "number" ? Number(inp.value) : inp.value);
    }));
    pane.querySelectorAll("[data-pdl]").forEach((b) => b.addEventListener("click", () => this.downloadPreset(b.dataset.pdl, false)));
    pane.querySelectorAll("[data-pload]").forEach((b) => b.addEventListener("click", () => this.downloadPreset(b.dataset.pload, true)));
  },

  async buildPresetFiles(key) {
    const p = this.PRESETS.find((x) => x.key === key);
    const st = this.presetState[key];
    const nameEl = document.querySelector(`[data-pname="${key}"]`);
    const modName = (nameEl && nameEl.value) || p.name;
    const files = [];
    for (const f of p.files) {
      let text = await (await fetch(`app/lua-templates/${f.template}`)).text();
      text = text.replaceAll("{MOD}", modName);
      for (const param of p.params) {
        const v = st[param.token];
        const rendered = param.type === "bool" ? (v ? "true" : "false") : String(v);
        text = text.replaceAll(`{${param.token}}`, rendered);
      }
      // CompanionBeQuiet ships a real config.lua rather than tokens --
      // the Enabled toggle rewrites that one line in place.
      if (key === "companion_be_quiet" && f.path.endsWith("config.lua")) {
        text = text.replace(/Enabled\s*=\s*(true|false)/, `Enabled = ${st.__ENABLED__ ? "true" : "false"}`);
      }
      files.push({ path: f.path, content: text });
    }
    return { modName, files };
  },

  async downloadPreset(key, toEditor) {
    const { modName, files } = await this.buildPresetFiles(key);
    if (toEditor) {
      this.state.tab = "build";
      this.state.modName = modName;
      this.state.script = files[0].content +
        (files.length > 1 ? `\n-- NOTE: this preset also ships ${files.length - 1} more file(s) (${files.slice(1).map((f) => f.path).join(", ")}).\n-- The editor only holds main.lua -- use "Download mod ZIP" on the preset to get the complete mod.\n` : "");
      this.render(document.getElementById("luaPresetsPane").parentElement);
      return;
    }
    const r = await fetch("/api/luamods/package", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modName, files }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || `Package failed (${r.status}). If this says the route is missing, restart the Node server.`);
      return;
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${modName}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async download() {
    const name = this.state.modName;
    if (!/^[\w-]+$/.test(name)) { alert("Mod name must be letters/digits/_/- only"); return; }
    const r = await fetch("/api/luamods/package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, lua: this.state.script }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Package failed: ${j.error || r.status}`); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};
