-- Companion Be Quiet! — configuration
-- Edit a value, then press Ctrl+R in-game to hot-reload (or restart the game).
-- Full details: README.md
return {

    VoiceLineReducer = {
        Enabled = true,

        -- Which companion SPOKEN callouts to silence (EAvatarVoiceType values).
        -- The game's own voice code skips these before playing them, so the line
        -- never sounds. Your own voice and the companions' combat grunts use other
        -- values and are NOT affected.
        --   4  = FindGimmick        chest / gimmick spotted
        --   5  = FarEnemy           "an enemy!"
        --   6  = FarPowerfulEnemy   "it's a ___ type"
        --   7  = Defeat             enemy-kill callout
        --   8  = BattleEnd          "we beat it" (battle finish)
        --   11 = BossBattleEnd      boss battle finish
        -- Optional extras you can add: 9 = ChanceTime, 20 = Guide, 25 = QuestStart.
        RestrictVoiceTypes = { 4, 5, 6, 7, 8, 11 },

        -- Gimmick-chatter kinds to silence (EPartnerVoiceGimmickKind). Covers the
        -- chest / drop / safe-area / arc / goal barks.
        --   0 = DropItem  1 = TreasureBox  2 = SafetyArea  3 = Arc  4 = Goal
        RestrictGimmickKinds = { 0, 1, 2, 3, 4 },

        -- Only silence speakers whose class name contains this text. The AI companion
        -- is "BP_RODPartnerCharacter_C", so "Partner" targets companions and keeps
        -- YOUR character audible. Set to "" to silence every speaker (not recommended).
        RestrictOnlyClass = "Partner",

        -- OPTIONAL live-tuning: set this to an absolute path to a text file holding a
        -- comma-separated VoiceType list (e.g. "4,5,6,7,8,11,25"). It is re-read about
        -- once per second, so you can change the mute set WITHOUT restarting. Leave nil
        -- to use RestrictVoiceTypes above and just Ctrl+R after edits.
        RestrictListFile = nil,

        -- Diagnostics. false = silent (recommended for normal play). true = write every
        -- companion voice call to DiscoveryLog, useful for finding extra callout
        -- VoiceTypes to add to the lists above.
        LogEvents = false,
        DiscoveryLog = "CBQ_discovery.log",
    },

}
