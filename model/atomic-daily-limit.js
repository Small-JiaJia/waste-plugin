const RESERVE_DAILY_COUNT_SCRIPT = `
local current = 0
local stored = redis.call('GET', KEYS[1])
if stored then
  local ok, data = pcall(cjson.decode, stored)
  if ok and type(data) == 'table' and data.date == ARGV[1] then
    current = tonumber(data.count) or 0
  end
end

local limit = tonumber(ARGV[2])
if current >= limit then
  return {0, current}
end

current = current + 1
redis.call('SET', KEYS[1], cjson.encode({date = ARGV[1], count = current}), 'EX', ARGV[3])
return {1, current}
`

const CLAIM_DAILY_COOLDOWN_SCRIPT = `
local currentExpiry = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
local now = tonumber(ARGV[1])
if currentExpiry > 0 and now <= currentExpiry then
  return {0, currentExpiry}
end

redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return {1, tonumber(ARGV[2])}
`

function parseResult (result) {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Redis returned an invalid daily limit result.')
  }
  const [allowed, value] = result.map(Number)
  if (![0, 1].includes(allowed) || !Number.isFinite(value)) {
    throw new Error('Redis returned an invalid daily limit result.')
  }
  return { ok: allowed === 1, value }
}

export async function reserveDailyCount ({ key, date, limit, expiresIn }) {
  const dailyLimit = Number(limit)
  const ttl = Number(expiresIn)
  if (!key || !date || !Number.isSafeInteger(dailyLimit) || dailyLimit < 1) {
    throw new TypeError('A key, date, and positive integer daily limit are required.')
  }
  if (!Number.isSafeInteger(ttl) || ttl < 1) {
    throw new TypeError('The daily counter expiration must be a positive integer.')
  }

  const result = await redis.eval(RESERVE_DAILY_COUNT_SCRIPT, {
    keys: [key],
    arguments: [String(date), String(dailyLimit), String(ttl)]
  })
  return parseResult(result)
}

export async function claimDailyCooldown ({ key, now, expiresAt, ttlSeconds }) {
  const nowSeconds = Number(now)
  const expirySeconds = Number(expiresAt)
  const ttl = Number(ttlSeconds)
  if (!key || !Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(expirySeconds)) {
    throw new TypeError('A key and valid Unix timestamps are required.')
  }
  if (!Number.isSafeInteger(ttl) || ttl < 1) {
    throw new TypeError('The cooldown expiration must be a positive integer.')
  }

  const result = await redis.eval(CLAIM_DAILY_COOLDOWN_SCRIPT, {
    keys: [key],
    arguments: [String(nowSeconds), String(expirySeconds), String(ttl)]
  })
  return parseResult(result)
}
