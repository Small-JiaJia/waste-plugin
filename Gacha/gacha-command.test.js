import test from 'node:test'
import assert from 'node:assert/strict'
import { GACHA_DRAW_REGEXP, parseTenPullBatches } from './gacha-command.js'

test('parses supported Chinese draw counts into ten-pull batches', () => {
  const matcher = new RegExp(GACHA_DRAW_REGEXP)
  const cases = new Map([
    ['#十抽', 1],
    ['#二十抽', 2],
    ['#百连', 10],
    ['#一百连', 10],
    ['#二百连', 20],
    ['#二百抽', 20],
    ['#常驻池二百抽', 20],
    ['#10连', 1],
    ['#单抽', 1]
  ])

  for (const [command, expectedBatches] of cases) {
    assert.equal(matcher.test(command), true, command)
    assert.equal(parseTenPullBatches(command), expectedBatches, command)
  }

  assert.equal(matcher.test('#二十百连'), false)
})
