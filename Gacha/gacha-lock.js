import { randomUUID } from 'node:crypto'

const LOCK_TTL_MS = 30000
const LOCK_WAIT_MS = 10000
const LOCK_RETRY_MS = 50

const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`

const SAVE_STATE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('DEL', KEYS[1])
`

export function getGachaStateKey (e) {
  if (!e) return 'waste-plugin:gacha:unknown'
  const prefix = 'waste-plugin:gacha'
  if (e.isGroup) return `${prefix}:${e.group_id}:${e.user_id}`
  return `${prefix}:private:${e.user_id}`
}

export class GachaLockTimeoutError extends Error {
  constructor () {
    super('Timed out waiting for the gacha state lock.')
    this.name = 'GachaLockTimeoutError'
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function withGachaLock (e, action) {
  const stateKey = getGachaStateKey(e)
  const lockKey = `${stateKey}:lock`
  const token = randomUUID()
  const deadline = Date.now() + LOCK_WAIT_MS

  while (true) {
    const acquired = await redis.set(lockKey, token, { NX: true, PX: LOCK_TTL_MS })
    if (acquired === 'OK') break
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new GachaLockTimeoutError()
    await delay(Math.min(LOCK_RETRY_MS, remaining))
  }

  let renewing = false
  let renewalPromise = Promise.resolve()
  let renewalError
  const renewalTimer = setInterval(() => {
    if (renewing) return
    renewing = true
    renewalPromise = redis.eval(RENEW_LOCK_SCRIPT, {
      keys: [lockKey],
      arguments: [token, String(LOCK_TTL_MS)]
    }).catch(err => {
      renewalError = err
    }).finally(() => { renewing = false })
  }, LOCK_TTL_MS / 3)
  renewalTimer.unref?.()

  const lock = {
    async saveState (key, value) {
      const saved = await redis.eval(SAVE_STATE_SCRIPT, {
        keys: [lockKey, key],
        arguments: [token, value, String(LOCK_TTL_MS)]
      })
      if (Number(saved) !== 1) {
        throw new Error('Gacha state lock was lost before saving.')
      }
    }
  }

  try {
    return await action(lock)
  } finally {
    clearInterval(renewalTimer)
    try {
      await renewalPromise
    } catch (err) {
      renewalError = err
    }
    if (renewalError) globalThis.logger?.warn('[waste-plugin] 续期祈愿状态锁失败：', renewalError)
    try {
      await redis.eval(RELEASE_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [token]
      })
    } catch (err) {
      globalThis.logger?.warn('[waste-plugin] 释放祈愿状态锁失败：', err)
    }
  }
}
