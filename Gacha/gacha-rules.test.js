import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getFiveStarProbability,
  migrateCaptureMisses,
  resolveRoleFiveStar
} from './gacha-rules.js'
import { SingleGacha } from './singlegacha.js'

function sequence (...values) {
  return () => values.shift() ?? 0.999
}

test('role five-star rates follow next-wish count and hard pity', () => {
  assert.equal(getFiveStarProbability('role', 0), 60)
  assert.equal(getFiveStarProbability('role', 72), 60)
  assert.equal(getFiveStarProbability('role', 73), 660)
  assert.equal(getFiveStarProbability('role', 88), 9660)
  assert.equal(getFiveStarProbability('role', 89), 10000)
})

test('weapon five-star rates follow both soft-pity stages and hard pity', () => {
  assert.equal(getFiveStarProbability('weapon', 0), 70)
  assert.equal(getFiveStarProbability('weapon', 61), 70)
  assert.equal(getFiveStarProbability('weapon', 62), 770)
  assert.equal(getFiveStarProbability('weapon', 72), 7770)
  assert.equal(getFiveStarProbability('weapon', 73), 8120)
  assert.equal(getFiveStarProbability('weapon', 78), 9870)
  assert.equal(getFiveStarProbability('weapon', 79), 10000)
})

test('weekly bonus only modifies the base-rate range', () => {
  assert.equal(getFiveStarProbability('role', 0, 1), 120)
  assert.equal(getFiveStarProbability('weapon', 0, 1), 210)
  assert.equal(getFiveStarProbability('role', 73, 1), 660)
})

test('capturing radiance uses the state-specific community model', () => {
  const state = { kMiss: 1, isUp5: 0 }
  assert.equal(resolveRoleFiveStar(state, sequence(0.095)).outcome, 'captured')
  assert.equal(state.kMiss, 0)

  state.kMiss = 2
  assert.equal(resolveRoleFiveStar(state, sequence(0.182)).outcome, 'captured')

  state.kMiss = 3
  assert.equal(resolveRoleFiveStar(state, sequence(0.999)).outcome, 'captured')
})

test('three losses retain the counter through guarantees and force capture next', () => {
  const state = { kMiss: 0, isUp5: 0 }
  for (let i = 0; i < 3; i++) {
    assert.equal(resolveRoleFiveStar(state, sequence(0.999, 0.999)).outcome, 'offrate')
    assert.equal(state.kMiss, i + 1)
    assert.equal(resolveRoleFiveStar(state).outcome, 'guaranteed')
    assert.equal(state.kMiss, i + 1)
  }
  assert.equal(resolveRoleFiveStar(state, sequence(0.999)).outcome, 'captured')
})

test('a direct featured win resets the miss counter', () => {
  const state = { kMiss: 2, isUp5: 0 }
  assert.equal(resolveRoleFiveStar(state, sequence(0.999, 0.25)).outcome, 'featured')
  assert.equal(state.kMiss, 0)
  assert.equal(state.isUp5, 0)
})

test('legacy capture counters migrate without retaining the old field', () => {
  const state = { captureCount: 2 }
  migrateCaptureMisses(state)
  assert.equal(state.kMiss, 1)
  assert.equal('captureCount' in state, false)
})

test('loading a legacy user preserves pity and resets weapon path on banner change', async () => {
  const previousRedis = globalThis.redis
  const expiresAt = Date.now() / 1000 + 3600
  const savedUser = {
    permanent: { num4: 3, isUp4: 0, num5: 12, isUp5: 0, captureCount: 1 },
    role: { num4: 4, isUp4: 1, num5: 44, isUp5: 1, captureCount: 2 },
    weapon: { num4: 2, isUp4: 0, num5: 63, isUp5: 1, captureCount: 1, lifeNum: 1, dingTrack: 'Old weapon' },
    today: { star: [], expire: expiresAt, num: 5, weaponNum: 2 },
    week: { num: 1, expire: expiresAt }
  }
  globalThis.redis = { get: async () => JSON.stringify(savedUser) }

  try {
    const core = new SingleGacha({ user_id: 'test-user', isGroup: false }, { type: 'weapon' })
    core.NowPool = {
      version: '6.0',
      half: 1,
      from: '2026-01-01 00:00:00',
      to: '2026-01-21 00:00:00'
    }
    const user = await core.loadUser()

    assert.equal(user.role.kMiss, 1)
    assert.equal(user.role.num5, 44)
    assert.equal(user.role.isUp5, 1)
    assert.equal(user.weapon.num5, 63)
    assert.equal(user.weapon.isUp5, 1)
    assert.equal(user.weapon.lifeNum, 0)
    assert.equal(user.weapon.dingTrack, null)
    assert.equal(user.weapon.bannerId, '6.0:1:2026-01-01 00:00:00:2026-01-21 00:00:00')
    assert.equal('captureCount' in user.role, false)
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('saving gacha state does not attach a short expiration', async () => {
  const previousRedis = globalThis.redis
  let args
  globalThis.redis = { set: async (...values) => { args = values } }

  try {
    const core = new SingleGacha({ user_id: 'test-user', isGroup: false })
    core.user = { role: { num5: 42 } }
    await core.saveUser()
    assert.equal(args.length, 2)
    assert.equal(args[0], 'waste-plugin:gacha:private:test-user')
    assert.equal(JSON.parse(args[1]).role.num5, 42)
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('a fate-point weapon hit consumes the featured guarantee too', () => {
  const core = new SingleGacha({}, { type: 'weapon' })
  core.pool = { up5: ['Path Weapon'], five: ['Standard Weapon'] }
  core.user = {
    weapon: { num5: 79, num4: 0, isUp5: 1, lifeNum: 1, dingTrack: 'Path Weapon' },
    today: { star: [], weaponNum: 0 },
    week: { num: 0 }
  }

  const result = core.lottery5()

  assert.equal(result, true)
  assert.equal(core.res.name, 'Path Weapon')
  assert.equal(core.res.isBing, true)
  assert.equal(core.user.weapon.lifeNum, 0)
  assert.equal(core.user.weapon.isUp5, 0)
})
