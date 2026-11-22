import test from 'node:test'
import assert from 'node:assert/strict'
import { reserveDailyDraws } from './gacha-quota.js'

const resetAt = Math.floor(Date.now() / 1000) + 3600

test('reserves the requested draw count atomically for a group user and pool', async () => {
  const previousRedis = globalThis.redis
  let script
  let options
  globalThis.redis = {
    eval: async (lua, args) => {
      script = lua
      options = args
      return [1, 30]
    }
  }

  try {
    const result = await reserveDailyDraws({
      groupId: 12345,
      userId: 67890,
      type: 'role',
      count: 10,
      limit: 100,
      expiresAt: resetAt
    })

    assert.deepEqual(result, { ok: true, used: 30, limit: 100, remain: 70 })
    assert.equal(options.keys[0], 'waste-plugin:gacha:daily:group:12345:67890:role')
    assert.deepEqual(options.arguments, ['100', '10', String(resetAt)])
    assert.match(script, /current \+ count > limit/)
    assert.match(script, /INCRBY/)
    assert.match(script, /EXPIREAT/)
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('a request that would exceed the cap is rejected without counting the request', async () => {
  const previousRedis = globalThis.redis
  globalThis.redis = { eval: async () => [0, 95] }

  try {
    const result = await reserveDailyDraws({
      groupId: 12345,
      userId: 67890,
      type: 'weapon',
      count: 10,
      limit: 100,
      expiresAt: resetAt
    })

    assert.deepEqual(result, { ok: false, used: 95, limit: 100, remain: 5 })
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('unlimited pools still track usage until the daily reset', async () => {
  const previousRedis = globalThis.redis
  let options
  globalThis.redis = {
    eval: async (_script, args) => {
      options = args
      return [1, 12]
    }
  }

  try {
    const result = await reserveDailyDraws({
      groupId: 'private',
      userId: 67890,
      type: 'permanent',
      count: 1,
      limit: 0,
      expiresAt: resetAt
    })

    assert.deepEqual(result, { ok: true, used: 12, limit: 0, remain: Infinity })
    assert.equal(options.keys[0], 'waste-plugin:gacha:daily:private:67890:permanent')
    assert.equal(options.arguments[0], '0')
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('invalid reservation inputs are rejected before contacting Redis', async () => {
  const previousRedis = globalThis.redis
  let called = false
  globalThis.redis = { eval: async () => { called = true; return [1, 1] } }

  try {
    await assert.rejects(reserveDailyDraws({
      groupId: 12345,
      userId: 67890,
      type: 'role',
      count: 0,
      limit: 100,
      expiresAt: resetAt
    }), TypeError)
    assert.equal(called, false)
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})
