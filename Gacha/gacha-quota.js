const RESERVE_DRAWS_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local count = tonumber(ARGV[2])
local expiresAt = tonumber(ARGV[3])

if limit > 0 and current + count > limit then
  return {0, current}
end

local updated = redis.call('INCRBY', KEYS[1], count)
redis.call('EXPIREAT', KEYS[1], expiresAt)
return {1, updated}
`

const POOL_TYPES = new Set(['role', 'permanent', 'weapon'])

function quotaKey (groupId, userId, type) {
  const scope = groupId === 'private' ? 'private' : `group:${groupId}`
  return `waste-plugin:gacha:daily:${scope}:${userId}:${type}`
}

/** Atomically reserve today's requested wishes for this user and pool. */
export async function reserveDailyDraws ({ groupId, userId, type, count, limit, expiresAt }) {
  const drawCount = Number(count)
  const dailyLimitValue = Number(limit)
  const dailyLimit = Number.isFinite(dailyLimitValue) && dailyLimitValue > 0
    ? Math.floor(dailyLimitValue)
    : 0
  const resetAt = Math.ceil(Number(expiresAt))

  if (!userId || !POOL_TYPES.has(type)) {
    throw new TypeError('A user ID and valid gacha pool are required to reserve daily draws.')
  }
  if (!Number.isSafeInteger(drawCount) || drawCount < 1) {
    throw new TypeError('The requested draw count must be a positive integer.')
  }
  if (!Number.isSafeInteger(resetAt) || resetAt <= Math.floor(Date.now() / 1000)) {
    throw new TypeError('The next daily reset time must be a future Unix timestamp in seconds.')
  }

  const result = await redis.eval(RESERVE_DRAWS_SCRIPT, {
    keys: [quotaKey(groupId, userId, type)],
    arguments: [String(dailyLimit), String(drawCount), String(resetAt)]
  })
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Redis returned an invalid daily quota result.')
  }

  const [allowed, used] = result.map(Number)
  if (![0, 1].includes(allowed) || !Number.isSafeInteger(used) || used < 0) {
    throw new Error('Redis returned an invalid daily quota result.')
  }

  return {
    ok: allowed === 1,
    used,
    limit: dailyLimit,
    remain: dailyLimit > 0 ? Math.max(dailyLimit - used, 0) : Infinity
  }
}
