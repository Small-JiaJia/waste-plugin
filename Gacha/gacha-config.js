// Gacha/gacha-config.js
// 抽卡设置读写：每日次数上限 + 撤回时间，按群组隔离，持久化到 data/gacha-set.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CFG_PATH = path.resolve(__dirname, '../data/gacha-set.json')

/** 默认设置：0 表示不限制 */
const DEFAULT = {
  pinkBall: 0,     // 角色池每日抽数上限
  blueBall: 0,     // 常驻池每日抽数上限
  weaponBall: 0,   // 武器池每日抽数上限
  recallTime: 60   // 未出货时撤回秒数
}

let cache = null

/** 加载全部配置（内存缓存） */
function load () {
  if (cache) return cache
  try {
    if (fs.existsSync(CFG_PATH)) {
      cache = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))
    } else {
      cache = {}
    }
  } catch (err) {
    logger.error('[waste-plugin] 抽卡设置读取失败：', err)
    cache = {}
  }
  return cache
}

/** 写回磁盘 */
function save () {
  try {
    const dir = path.dirname(CFG_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CFG_PATH, JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    logger.error('[waste-plugin] 抽卡设置保存失败：', err)
  }
}

/**
 * 获取某群组的设置（合并默认值）
 * @param {string|number} groupId 群号，私聊传 'private'
 */
export function getSetting (groupId) {
  const cfg = load()
  return { ...DEFAULT, ...(cfg[groupId] || {}) }
}

/**
 * 更新某群组的设置
 * @param {string|number} groupId
 * @param {object} patch 要覆盖的字段
 */
export function setSetting (groupId, patch) {
  const cfg = load()
  if (!cfg[groupId]) cfg[groupId] = { ...DEFAULT }
  Object.assign(cfg[groupId], patch)
  save()
}

/**
 * 检查抽数是否超限
 * @param {string|number} groupId
 * @param {'role'|'weapon'|'permanent'} type
 * @param {number} currentCount 今日已抽数
 * @param {number} addCount 本次计划抽数（总抽数，非十连次数）
 * @returns {{ ok: boolean, limit: number, remain: number }}
 */
export function checkDailyLimit (groupId, type, currentCount, addCount) {
  const s = getSetting(groupId)
  let limit = 0
  if (type === 'role') limit = s.pinkBall
  else if (type === 'weapon') limit = s.weaponBall
  else if (type === 'permanent') limit = s.blueBall

  if (limit === 0) return { ok: true, limit: 0, remain: Infinity }
  const remain = limit - currentCount
  return { ok: currentCount + addCount <= limit, limit, remain }
}

/** 获取撤回时间（秒） */
export function getRecallTime (groupId) {
  return getSetting(groupId).recallTime
}