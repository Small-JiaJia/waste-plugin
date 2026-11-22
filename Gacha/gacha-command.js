const DIGITS = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

export const GACHA_DRAW_REGEXP = '^#*(单抽|单|10|[武器池常驻]*([一二三四五六七八九]?(?:十|百))|抽)[连抽卡奖][123武器池常驻]*$'

/** Return the number of ten-pull batches encoded in a command. */
export function parseTenPullBatches (message) {
  const match = String(message).match(/([一二三四五六七八九]?)(十|百)/)
  if (!match) return 1

  const coefficient = match[1] ? DIGITS[match[1]] : 1
  return match[2] === '百' ? coefficient * 10 : coefficient
}
