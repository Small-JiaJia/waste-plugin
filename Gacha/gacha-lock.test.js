import test from 'node:test'
import assert from 'node:assert/strict'
import { getGachaStateKey, withGachaLock } from './gacha-lock.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('gacha state keys distinguish group and private users', () => {
  assert.equal(getGachaStateKey({ isGroup: true, group_id: 12, user_id: 34 }), 'waste-plugin:gacha:12:34')
  assert.equal(getGachaStateKey({ isGroup: false, user_id: 34 }), 'waste-plugin:gacha:private:34')
})

test('concurrent operations for the same gacha state are serialized', async () => {
  const previousRedis = globalThis.redis
  const values = new Map()
  globalThis.redis = {
    async set (key, value, options) {
      if (options.NX && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async eval (script, { keys, arguments: args }) {
      const [key] = keys
      if (script.includes("redis.call('SET', KEYS[2]")) {
        if (values.get(key) !== args[0]) return 0
        values.set(keys[1], args[1])
        return 1
      }
      if (script.includes("redis.call('DEL'")) {
        if (values.get(key) !== args[0]) return 0
        values.delete(key)
        return 1
      }
      if (values.has(key) && values.get(key) === args[0]) return 1
      return 0
    }
  }

  try {
    const event = { isGroup: true, group_id: 123, user_id: 456 }
    const order = []
    let active = 0
    let maxActive = 0
    const operation = name => withGachaLock(event, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`${name}:start`)
      await delay(75)
      order.push(`${name}:end`)
      active--
    })

    await Promise.all([operation('first'), operation('second')])

    assert.equal(maxActive, 1)
    assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end'])
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})

test('state writes require the current lock token', async () => {
  const previousRedis = globalThis.redis
  const values = new Map()
  globalThis.redis = {
    async set (key, value, options) {
      if (options.NX && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async eval (script, { keys, arguments: args }) {
      const [lockKey] = keys
      if (script.includes("redis.call('SET', KEYS[2]")) {
        if (values.get(lockKey) !== args[0]) return 0
        values.set(keys[1], args[1])
        return 1
      }
      if (script.includes("redis.call('DEL'")) {
        if (values.get(lockKey) !== args[0]) return 0
        values.delete(lockKey)
        return 1
      }
      return values.get(lockKey) === args[0] ? 1 : 0
    }
  }

  try {
    const event = { isGroup: true, group_id: 123, user_id: 456 }
    const stateKey = getGachaStateKey(event)
    await withGachaLock(event, lock => lock.saveState(stateKey, '{"num5":1}'))
    assert.equal(values.get(stateKey), '{"num5":1}')

    await assert.rejects(withGachaLock(event, async lock => {
      values.set(`${stateKey}:lock`, 'new-owner')
      await lock.saveState(stateKey, '{"num5":2}')
    }), /lock was lost/)
    assert.equal(values.get(stateKey), '{"num5":1}')
    assert.equal(values.get(`${stateKey}:lock`), 'new-owner')
  } finally {
    if (previousRedis === undefined) delete globalThis.redis
    else globalThis.redis = previousRedis
  }
})
