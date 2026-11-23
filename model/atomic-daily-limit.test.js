import test from 'node:test'
import assert from 'node:assert/strict'
import { claimDailyCooldown, reserveDailyCount } from './atomic-daily-limit.js'

function mockRedis () {
  const values = new Map()
  return {
    values,
    eval: async (script, { keys, arguments: args }) => {
      const [key] = keys
      if (script.includes('cjson.decode')) {
        let count = 0
        try {
          const stored = JSON.parse(values.get(key) || 'null')
          if (stored?.date === args[0]) count = Number(stored.count) || 0
        } catch {}
        const limit = Number(args[1])
        if (count >= limit) return [0, count]
        count++
        values.set(key, JSON.stringify({ date: args[0], count }))
        return [1, count]
      }

      const currentExpiry = Number(values.get(key) || 0)
      const now = Number(args[0])
      if (currentExpiry > 0 && now <= currentExpiry) return [0, currentExpiry]
      values.set(key, args[1])
      return [1, Number(args[1])]
    }
  }
}

test('daily counter atomically allows only the remaining request at the limit', async () => {
  const previousRedis = globalThis.redis
  const redisMock = mockRedis()
  const key = 'oracle:user:123'
  globalThis.redis = redisMock
  redisMock.values.set(key, JSON.stringify({ date: '2026-11-22', count: 1 }))

  try {
    const results = await Promise.all([
      reserveDailyCount({ key, date: '2026-11-22', limit: 2, expiresIn: 3600 }),
      reserveDailyCount({ key, date: '2026-11-22', limit: 2, expiresIn: 3600 })
    ])

    assert.deepEqual(results.map(result => result.ok).sort(), [false, true])
    assert.equal(JSON.parse(redisMock.values.get(key)).count, 2)
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('daily cooldown atomically claims the first request and allows the next day', async () => {
  const previousRedis = globalThis.redis
  const redisMock = mockRedis()
  const key = 'fortune:user:123'
  globalThis.redis = redisMock

  try {
    const now = 1000
    const firstDayExpiry = 2000
    const sameDayResults = await Promise.all([
      claimDailyCooldown({ key, now, expiresAt: firstDayExpiry, ttlSeconds: 86400 }),
      claimDailyCooldown({ key, now, expiresAt: firstDayExpiry, ttlSeconds: 86400 })
    ])

    assert.deepEqual(sameDayResults.map(result => result.ok).sort(), [false, true])
    assert.equal(redisMock.values.get(key), String(firstDayExpiry))

    const nextDay = await claimDailyCooldown({
      key,
      now: firstDayExpiry + 1,
      expiresAt: 3000,
      ttlSeconds: 86400
    })
    assert.equal(nextDay.ok, true)
    assert.equal(redisMock.values.get(key), '3000')
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})
