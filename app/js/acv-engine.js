// ============================================================
// acv-engine.js
// The reverse-engineered ACV / ATK formula, implemented as pure
// functions so it can be unit tested independent of the UI.
//
// ACV formula (verified against EOA-SAO-Weapons-Updated.xlsx
// ACV_Research sheet -- 11/11 empirical data points matched exactly,
// and cross-checked against in-game screenshots: Decapitator's
// DEX-RankB contribution of 181 at DEX=37, Steel Knife's DEX-RankD
// contribution of ~40 at DEX=37):
//
//   contribution(rank, statValue):
//     mult0, mult1, mult2 = AbilityScoreTable[rank] at tiers
//                            AbilityValue 1 / 31 / 61, each / 100
//     if statValue <= 30:  statValue * mult0
//     if statValue <= 60:  30*mult0 + (statValue-30)*mult1
//     else:                30*mult0 + 30*mult1 + (statValue-60)*mult2
//
//   ACV = sum of contribution(rank_i, stat_i) for STR, DEX, AGI, INT
//
// Total ATK formula (verified against screenshot breakdown text,
// e.g. "232 (36 + 181 + 15)" and "292 (75 + 182 + 35)"):
//
//   TotalATK = BaseWeaponATK[enhancementTier] + ACV + EX-MOD bonus ATK
// ============================================================

const RANK_ORDER = ["RankD", "RankC", "RankB", "RankA", "RankS"];
const STATS = ["STR", "DEX", "AGI", "INT"];

/**
 * Build the three-tier multiplier table from the raw AbilityScoreTable.
 * Input shape: { "1": {RankD:100,...}, "31": {...}, "61": {...} }
 */
function buildMultiplierTable(abilityScoreTable) {
  const tierKeys = Object.keys(abilityScoreTable)
    .map(Number)
    .sort((a, b) => a - b); // [1, 31, 61]

  const table = {};
  for (const rank of RANK_ORDER) {
    table[rank] = tierKeys.map((k) => abilityScoreTable[k][rank] / 100);
  }
  return table; // { RankD: [mult0, mult1, mult2], ... }
}

/**
 * contribution(rank, statValue, multiplierTable) -> integer
 *
 * NOTE: the game floors each stat's contribution to a whole number
 * BEFORE summing them into the total ACV (confirmed: Steel Knife at
 * DEX=37 RankD gives a raw contribution of 33.5, and the in-game ACV
 * breakdown shows "+40" total = floor(1)+floor(33.5)+floor(5)+floor(1)
 * = 1+33+5+1 = 40, not round(40.5)=41 and not floor(40.5)=40 applied
 * to the pre-summed total). We floor per-stat to match exactly.
 */
function statContribution(rank, statValue, multiplierTable) {
  if (rank === "None" || !multiplierTable[rank]) return 0;
  const [m0, m1, m2] = multiplierTable[rank];
  const v = Math.max(1, statValue);

  let raw;
  if (v <= 30) raw = v * m0;
  else if (v <= 60) raw = 30 * m0 + (v - 30) * m1;
  else raw = 30 * m0 + 30 * m1 + (v - 60) * m2;

  return Math.floor(raw);
}

/**
 * Compute ACV (and per-stat breakdown) for a weapon at a given
 * enhancement tier and a set of player ability scores.
 *
 * @param {object} weapon - weapon record from the built JSON
 * @param {number} enhancementTier - 0-20 (the "+N" level)
 * @param {{STR:number,DEX:number,AGI:number,INT:number}} abilities
 * @param {object} multiplierTable - from buildMultiplierTable()
 */
function computeACV(weapon, enhancementTier, abilities, multiplierTable) {
  const ranksAtTier = {};
  for (const stat of STATS) {
    const arr = weapon.enhancement.abilityCorrectionRank[stat] || [];
    ranksAtTier[stat] = arr[enhancementTier] || arr[0] || "None";
  }

  const breakdown = {};
  let total = 0;
  for (const stat of STATS) {
    const rank = ranksAtTier[stat];
    const val = statContribution(rank, abilities[stat] || 1, multiplierTable);
    breakdown[stat] = { rank, statValue: abilities[stat] || 1, contribution: val };
    total += val;
  }

  return { total, breakdown, ranksAtTier };
}

/**
 * Look up base weapon ATK at a given enhancement tier (+0 .. +20).
 */
function getBaseWeaponATK(weapon, enhancementTier) {
  const arr = weapon.enhancement.baseWeaponATK || [];
  const idx = Math.min(enhancementTier, arr.length - 1);
  return arr[idx] ?? 0;
}

/**
 * Full ATK simulation: BaseATK + ACV + EX-MOD bonus.
 * exModBonusATK is an optional flat ATK add-on from an EX-MOD roll
 * (the "ATK +15" style bonus seen in the equip screen) -- since our
 * data export doesn't carry rolled EX-MOD instances, this is exposed
 * as a free user-adjustable input in the simulator rather than guessed.
 */
function simulateTotalATK({ weapon, enhancementTier, abilities, multiplierTable, exModBonusATK = 0 }) {
  const baseATK = getBaseWeaponATK(weapon, enhancementTier);
  const acvResult = computeACV(weapon, enhancementTier, abilities, multiplierTable);
  const total = baseATK + acvResult.total + exModBonusATK;

  return {
    baseATK,
    acv: acvResult.total,
    acvBreakdown: acvResult.breakdown,
    exModBonusATK,
    total: Math.round(total),
  };
}

/**
 * Enhancement cost lookup (RefiningCost / EnhancementCost / EXP) from
 * the ClassTable, keyed by the weapon's rank and the *target* tier
 * (1-indexed into the per-rank arrays, since EnhancementCost[0] is the
 * cost of going from +0 to +1).
 */
function getEnhancementCost(classTable, rank, targetTier) {
  const entry = classTable[rank];
  if (!entry || targetTier < 1) return null;
  const i = targetTier - 1;
  return {
    refiningCost: entry.refiningCost,
    enhancementCost: entry.enhancementCost[i] ?? null,
    requiredCraftLv: entry.requiredCraftLv[i] ?? null,
    requiredEnhanceEXP: entry.requiredEnhanceEXP[i] ?? null,
    grantEnhanceEXP: entry.grantEnhanceEXP[i] ?? null,
    sellAmount: entry.sellAmount[i] ?? null,
  };
}

/**
 * Total cumulative cost to go from +0 to +targetTier.
 */
function getCumulativeEnhancementCost(classTable, rank, targetTier) {
  const entry = classTable[rank];
  if (!entry) return null;
  let totalCost = 0;
  let totalEXP = 0;
  for (let i = 0; i < targetTier; i++) {
    totalCost += entry.enhancementCost[i] ?? 0;
    totalEXP += entry.requiredEnhanceEXP[i] ?? 0;
  }
  return { totalCost, totalEXP };
}
