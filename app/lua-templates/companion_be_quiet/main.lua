-- Companion Be Quiet! — UE4SS Lua mod for Echoes of Aincrad
-- Mutes the repeated companion/partner callout voice-lines during gameplay
-- (enemy spotted, chest, victory, quest-gimmick barks ...). Your own combat voice,
-- normal chatter, and story/cutscene VO stay. Single feature, config-driven.
--
-- Compatibility-first: everything local, pcall-guarded. Uses the game's own
-- per-avatar voice-restrict lists via pre-hooks (no asset edits, no audio-stop).
-- Entry point UE4SS runs automatically: Scripts/main.lua
-- Config: Scripts/config.lua  (edit -> Ctrl+R hot-reload or restart the game)

local VERSION = "1.0.0"
local NAME    = "Companion Be Quiet!"

local function log(msg) print("[" .. NAME .. "] " .. tostring(msg)) end

local ok, config = pcall(require, "config")
if not ok or type(config) ~= "table" then
    log("FATAL: config.lua failed to load: " .. tostring(config))
    return
end

log("loading v" .. VERSION .. " ...")

local fcfg = config.VoiceLineReducer
if type(fcfg) ~= "table" or not fcfg.Enabled then
    log("disabled in config (VoiceLineReducer.Enabled = false) — nothing to do.")
    return
end

local okReq, mod = pcall(require, "features.eoa31_voice")
if okReq and type(mod) == "table" and type(mod.init) == "function" then
    local okInit, err = pcall(mod.init, fcfg, function(m) log(m) end)
    if okInit then log("loaded.")
    else log("init ERROR: " .. tostring(err)) end
else
    log("LOAD FAIL: " .. tostring(mod))
end
