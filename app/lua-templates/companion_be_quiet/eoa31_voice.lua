-- Companion Be Quiet! — companion voice-line suppressor for Echoes of Aincrad
-- ============================================================================
-- Silences the companions' repeated SPOKEN callouts (chest / enemy-spotted /
-- kill / battle-finish / gimmick barks) while keeping:
--   * your own character's voice,
--   * the companions' non-verbal combat/movement grunts,
--   * story & cutscene VO.
--
-- HOW IT WORKS — game-native restrict (no asset edits, no audio-stop hacks):
-- Companion voice runs through RODAvatarCharacter:PlayVoice* which resolves an
-- EAvatarVoiceType (+ EPartnerVoiceGimmickKind) and posts a Wwise event. BEFORE it
-- posts, the native code checks two per-avatar lists — RestrictVoiceType and
-- RestrictPartnerVoiceGimmickKind — and self-skips any listed type. We hook the
-- voice functions and, in the PRE-hook (runs before the native body), write those
-- lists onto the SPEAKING companion instance. The engine then skips the line itself.
--   * PLAYER-SAFE : only written on speakers whose class matches cfg.RestrictOnlyClass
--     ("Partner"); the player (Hero) avatar has no callout tables anyway.
--   * GRUNT-SAFE  : grunt VoiceTypes (e.g. 16/17/18/19 = CombinationSlash/Reversal/
--     Dodge/Parry) are not in the list -> they still play.
--   * CUTSCENE-SAFE: cutscene VO is a separate path; we also reassert on every hook,
--     so the game's own voice-reset at story transitions can't unmute us.
--
-- Requires the retail GNatives UE4SS signature (else the hooks never fire).
-- Config: Scripts/config.lua.  Hot-reload with Ctrl+R.
-- ============================================================================

local M = {}

-- Companion voice entry points on RODAvatarCharacter (RPC + direct variants).
local DEFAULT_FUNCS = {
    "/Script/ROD.RODAvatarCharacter:MulticastPlayVoiceRequest",
    "/Script/ROD.RODAvatarCharacter:ServerPlayVoiceRequest",
    "/Script/ROD.RODAvatarCharacter:MulticastPlayVoice",
    "/Script/ROD.RODAvatarCharacter:PlayVoiceCallback",
    "/Script/ROD.RODAvatarCharacter:PlayVoiceRequest_Core",
    "/Script/ROD.RODAvatarCharacter:PlayVoiceRequest",
    "/Script/ROD.RODAvatarCharacter:PlayVoiceByType",
    "/Script/ROD.RODAvatarCharacter:PlayVoice",
}

function M.init(cfg, log)
    local funcs         = cfg.HookFunctions or DEFAULT_FUNCS
    local restrictVT    = cfg.RestrictVoiceTypes or {}
    local restrictGK    = cfg.RestrictGimmickKinds or {}
    local restrictClass = cfg.RestrictOnlyClass          -- e.g. "Partner"; nil/"" = all speakers
    local restrictFile  = cfg.RestrictListFile           -- optional live VoiceType list (abs path)
    local logEvents     = cfg.LogEvents == true          -- verbose per-call diagnostic log
    local dpath         = cfg.DiscoveryLog or "CBQ_discovery.log"

    -- LIVE VoiceType list (optional): comma/space-separated ints, re-read at most once
    -- per second so the mute set can be tuned WITHOUT a restart. nil = config list only.
    local lastRead = 0
    local function currentRestrict()
        pcall(function()
            if restrictFile and (os.time() - lastRead >= 1) then
                lastRead = os.time()
                local f = io.open(restrictFile, "r")
                if f then
                    local s = f:read("*a"); f:close()
                    local t = {}
                    for num in tostring(s):gmatch("%d+") do t[#t + 1] = tonumber(num) end
                    if #t > 0 then restrictVT = t end
                end
            end
        end)
        return restrictVT
    end

    -- seed the live-list file once (preserves later edits across reloads)
    if restrictFile then
        pcall(function()
            local rf = io.open(restrictFile, "r")
            if rf then rf:close()
            else
                local wf = io.open(restrictFile, "w")
                if wf then wf:write(table.concat(restrictVT, ",")); wf:close() end
            end
        end)
    end

    -- optional diagnostic log (own file, flushed per line -> crash-safe + live-readable)
    local flog
    local function dwrite(line)
        if not logEvents then return end
        if flog then pcall(function() flog:write(line .. "\n"); flog:flush() end)
        else log(line) end
    end
    if logEvents then
        pcall(function() flog = io.open(dpath, "w") end)
        if flog then pcall(function() flog:write("=== Companion Be Quiet! discovery log ===\n"); flog:flush() end) end
        log("LogEvents ON -> " .. dpath)
    end

    -- PRE-hook: write the speaking companion's native restrict lists so the engine
    -- self-skips the line. ctx = the speaking avatar (self); never null inside the hook.
    local function makeHandler(label)
        return function(ctx, p1)
            pcall(function()
                local av; pcall(function() av = ctx:get() end)   -- ctx is a RemoteUnrealParam -> unwrap
                if not av then return end
                local cls = "?"
                pcall(function() cls = tostring(av:GetClass():GetFullName()) end)
                -- companion-only gate: leave the player/hero avatar untouched
                if restrictClass and restrictClass ~= "" and not cls:find(restrictClass, 1, true) then
                    return
                end
                local rv = currentRestrict()
                pcall(function() av.RestrictVoiceType = rv end)
                if #restrictGK > 0 then
                    pcall(function() av.RestrictPartnerVoiceGimmickKind = restrictGK end)
                end
                if logEvents then
                    local vt; pcall(function() vt = p1 and p1:get() end)
                    local nV; pcall(function() nV = av.RestrictVoiceType:GetArrayNum() end)
                    local nG; pcall(function() nG = av.RestrictPartnerVoiceGimmickKind:GetArrayNum() end)
                    dwrite(("[%s] cls=%s vt=%s | VT[%s] num=%s | GK[%s] num=%s"):format(
                        label, cls, tostring(vt),
                        table.concat(rv, ","), tostring(nV),
                        table.concat(restrictGK, ","), tostring(nG)))
                end
            end)
        end
    end

    local hooked, failed = {}, {}
    for _, fn in ipairs(funcs) do
        local lbl = fn:match("([%w]+:[%w]+)$") or fn
        if pcall(function() RegisterHook(fn, makeHandler(lbl)) end) then
            hooked[#hooked + 1] = lbl
        else
            failed[#failed + 1] = lbl
        end
    end

    log(("ready - mute VT[%s] GK[%s] on class '%s'. Hooked %d/%d%s")
        :format(
            table.concat(restrictVT, ","),
            table.concat(restrictGK, ","),
            tostring(restrictClass or "*"),
            #hooked, #hooked + #failed,
            (#failed > 0 and (" (FAILED: " .. table.concat(failed, ", ") .. ")") or "")))
end

return M
