// Probability model based on community analysis; per-state Capturing Radiance
// rates are not fully specified in the official wish details.

export const PROB = {
  chance5: 60, // 1/10000 units
  chance4: 510,
  chanceW5: 70,
  chanceW4: 600,
  wai: 50, // percent
  weaponUp5: 75, // percent
  captureChancePctByMiss: [0.018, 9.6, 18.3, 100],
  captureMaxMiss: 3
}

const clampMisses = value => Math.min(Math.max(Math.floor(Number(value) || 0), 0), PROB.captureMaxMiss)

export function migrateCaptureMisses (state) {
  if (Number.isFinite(Number(state.kMiss))) {
    state.kMiss = clampMisses(state.kMiss)
  } else {
    const legacy = Number(state.captureCount)
    state.kMiss = Number.isFinite(legacy)
      ? (legacy >= PROB.captureMaxMiss ? PROB.captureMaxMiss : Math.max(0, Math.floor(legacy) - 1))
      : 0
  }
  delete state.captureCount
}

export function getFiveStarProbability (type, failedCount, weeklyFiveStarCount = 0) {
  const nextWish = Math.max(0, Math.floor(Number(failedCount) || 0)) + 1
  const hasWeeklyBonus = Number(weeklyFiveStarCount) === 1

  if (type === 'weapon') {
    if (nextWish >= 80) return 10000
    if (nextWish >= 74) return 7770 + (nextWish - 73) * 350
    if (nextWish >= 63) return PROB.chanceW5 + (nextWish - 62) * 700
    return hasWeeklyBonus ? PROB.chanceW5 * 3 : PROB.chanceW5
  }

  if (nextWish >= 90) return 10000
  if (nextWish >= 74) return PROB.chance5 + (nextWish - 73) * 600
  return hasWeeklyBonus ? PROB.chance5 * 2 : PROB.chance5
}

export function resolveRoleFiveStar (state, random = Math.random) {
  if (state.isUp5 === 1) {
    state.isUp5 = 0
    return { outcome: 'guaranteed', isBigUP: true }
  }

  const kMiss = clampMisses(state.kMiss)
  const captureChance = PROB.captureChancePctByMiss[kMiss]
  if (random() * 100 < captureChance) {
    state.kMiss = 0
    state.isUp5 = 0
    return { outcome: 'captured', isBigUP: false }
  }

  if (random() * 100 < PROB.wai) {
    state.kMiss = 0
    state.isUp5 = 0
    return { outcome: 'featured', isBigUP: false }
  }

  state.kMiss = Math.min(kMiss + 1, PROB.captureMaxMiss)
  state.isUp5 = 1
  return { outcome: 'offrate', isBigUP: false }
}
