// Gacha/singlegacha.js
// 抽卡核心：单抽概率计算 + 捕获明光社区模型 + 武器定轨

import lodash from 'lodash'
import { POOL, PROB, getCurrentPool } from '../data/gacha-pool.js'
import { getFiveStarProbability, migrateCaptureMisses, resolveRoleFiveStar } from './gacha-rules.js'
import { getGachaStateKey } from './gacha-lock.js'

export class SingleGacha {
  constructor (e, options = {}) {
    this.e = e
    this.type = options.type || 'role'   // role / weapon / permanent
    this.role2 = options.role2 || false
    this.pool = {}
    this.user = null
    this.res = null
    this.NowPool = null
  }

  async init () {
    this.NowPool = getCurrentPool()
    this.user = await this.loadUser()
    this.pool = this.buildPool()
    return this
  }

  // ---------- 用户状态 ----------

  get key () {
    return getGachaStateKey(this.e)
  }

  async loadUser () {
    const stored = await redis.get(this.key)
    const user = stored ? JSON.parse(stored) : this.createUser()
    const defaults = this.createUser()
    const storedRole = user.role || {}
    const hadKMiss = storedRole.kMiss !== undefined && storedRole.kMiss !== null
    const legacyCaptureCount = storedRole.captureCount

    for (const type of ['permanent', 'role', 'weapon']) {
      user[type] = { ...defaults[type], ...(user[type] || {}) }
      delete user[type].captureCount
    }
    if (!hadKMiss) {
      const legacy = Number(legacyCaptureCount)
      user.role.kMiss = Number.isFinite(legacy)
        ? (legacy >= PROB.captureMaxMiss ? PROB.captureMaxMiss : Math.max(0, Math.floor(legacy) - 1))
        : 0
    }
    migrateCaptureMisses(user.role)

    user.today = { ...defaults.today, ...(user.today || {}) }
    user.week = { ...defaults.week, ...(user.week || {}) }
    const now = Date.now() / 1000
    if (!user.today.expire || now > user.today.expire) {
      user.today = { star: [], expire: this.getEnd4(), num: 0, weaponNum: 0 }
    }
    if (!user.week.expire || now > user.week.expire) {
      user.week = { num: 0, expire: this.getWeekEnd() }
    }

    const weaponBannerId = this.getWeaponBannerId()
    if (weaponBannerId && user.weapon.bannerId !== weaponBannerId) {
      user.weapon.lifeNum = 0
      user.weapon.dingTrack = null
      user.weapon.bannerId = weaponBannerId
    }
    return user
  }

  createUser () {
    const common = { num4: 0, isUp4: 0, num5: 0, isUp5: 0 }
    return {
      permanent: { ...common },
      role: { ...common, kMiss: 0 },
      weapon: { ...common, lifeNum: 0, dingTrack: null, bannerId: null },
      today: { star: [], expire: this.getEnd4(), num: 0, weaponNum: 0 },
      week: { num: 0, expire: this.getWeekEnd() }
    }
  }

  async saveUser (lock) {
    const value = JSON.stringify(this.user)
    if (lock?.saveState) {
      await lock.saveState(this.key, value)
      return
    }
    await redis.set(this.key, value)
  }

  getWeaponBannerId () {
    if (!this.NowPool?.from || !this.NowPool?.to) return null
    return [this.NowPool.version || '', this.NowPool.half || '', this.NowPool.from, this.NowPool.to].join(':')
  }

  // ---------- 池子装配 ----------

  buildPool () {
    const now = this.NowPool

    if (this.type === 'permanent') {
      return {
        up4: [], up5: [],
        role4: POOL.role4,
        weapon4: POOL.weapon4,
        five: POOL.role5,
        fiveW: POOL.weapon5,
        weapon3: POOL.weapon3
      }
    }

    if (this.type === 'weapon') {
      const up5 = now?.weapon5 || []
      const up4 = now?.weapon4 || []
      return {
        up4, up5,
        role4: POOL.role4,
        weapon4: lodash.difference(POOL.weapon4, up4),
        five: lodash.difference(POOL.weapon5, up5),
        weapon3: POOL.weapon3
      }
    }

    const up5 = this.role2 ? (now?.char5_2 || now?.char5 || []) : (now?.char5 || [])
    const up4 = now?.char4 || []
    return {
      up4, up5,
      role4: lodash.difference(POOL.role4, up4),
      weapon4: POOL.weapon4,
      five: lodash.difference(POOL.role5, up5),
      weapon3: POOL.weapon3
    }
  }

  // ---------- 抽卡主流程 ----------

  lottery () {
    if (!this.lottery5()) {
      if (!this.lottery4()) {
        this.lottery3()
      }
    }
    return this.res
  }

  lottery5 () {
    const state = this.user[this.type]
    const tmpChance5 = this.probability()

    if (lodash.random(1, 10000) > tmpChance5) {
      state.num5++
      return false
    }

    const nowCardNum = state.num5 + 1
    state.num5 = 0
    state.num4++

    let tmpName = ''
    let isBigUP = false
    let isBing = false
    let type = this.type

    // 武器池定轨（命定值上限 1）
    if (this.type === 'weapon' && state.lifeNum >= 1) {
      tmpName = this.getDingWeapon()
      state.lifeNum = 0
      state.isUp5 = 0
      isBing = true
    }
    // 小保底：角色池走捕获明光
    else if (this.type === 'role') {
      const result = resolveRoleFiveStar(state)
      tmpName = result.outcome === 'offrate'
        ? lodash.sample(this.pool.five)
        : lodash.sample(this.pool.up5)
      isBigUP = result.isBigUP
    }
    // 大保底
    else if (state.isUp5 === 1) {
      isBigUP = true
      state.isUp5 = 0
      tmpName = lodash.sample(this.pool.up5)
      if (tmpName === this.getDingWeapon()) state.lifeNum = 0
    }
    // 武器池小保底 / 常驻池
    else {
      const tmpUp = this.type === 'permanent'
        ? 0
        : (this.type === 'weapon' ? PROB.weaponUp5 : PROB.wai)
      if (lodash.random(1, 100) <= tmpUp) {
        tmpName = lodash.sample(this.pool.up5)
        if (tmpName === this.getDingWeapon()) state.lifeNum = 0
      } else {
        if (this.type === 'permanent') {
          if (lodash.random(1, 100) <= 50) {
            tmpName = lodash.sample(this.pool.five)
            type = 'role'
          } else {
            tmpName = lodash.sample(this.pool.fiveW)
            type = 'weapon'
          }
        } else {
          state.isUp5 = 1
          tmpName = lodash.sample(this.pool.five)
        }
      }
    }

    if (this.type === 'weapon' && tmpName !== this.getDingWeapon()) {
      state.lifeNum++
    }

    this.user.today.star.push({ name: tmpName, num: nowCardNum })
    this.user.week.num++
    if (this.type === 'weapon') this.user.today.weaponNum++

    this.res = {
      name: tmpName,
      star: 5,
      type,
      num: nowCardNum,
      element: '',
      isBigUP,
      isBing,
      rand: lodash.random(1, 7)   // 阴影变体 1-7
    }
    return true
  }

  lottery4 () {
    const state = this.user[this.type]
    let tmpChance4 = PROB.chance4

    if (state.num4 >= 9) {
      tmpChance4 += 10000
    } else if (state.num4 >= 5) {
      tmpChance4 += Math.pow(state.num4 - 4, 2) * 500
    }

    if (lodash.random(1, 10000) > tmpChance4) {
      state.num4++
      return false
    }
    state.num4 = 0

    let tmpUp = 50
    if (this.type === 'weapon') tmpUp = 75
    if (state.isUp4 === 1) {
      state.isUp4 = 0
      tmpUp = 100
    }
    if (this.type === 'permanent') tmpUp = 0

    let type = 'role'
    let tmpName = ''

    if (lodash.random(1, 100) <= tmpUp) {
      tmpName = lodash.sample(this.pool.up4)
      type = this.type
    } else {
      state.isUp4 = 1
      if (lodash.random(1, 100) <= 50) {
        tmpName = lodash.sample(this.pool.role4)
        type = 'role'
      } else {
        tmpName = lodash.sample(this.pool.weapon4)
        type = 'weapon'
      }
    }

    this.res = { name: tmpName, star: 4, type, element: '' }
    return true
  }

  lottery3 () {
    const tmpName = lodash.sample(this.pool.weapon3)
    this.res = { name: tmpName, star: 3, type: 'weapon', element: '' }
    return true
  }

  // ---------- 概率计算 ----------

  probability () {
    const state = this.user[this.type]
    return getFiveStarProbability(this.type, state.num5, this.user.week.num)
  }

  // ---------- 武器定轨 ----------

  getDingWeapon () {
    if (this.type !== 'weapon') return null
    const state = this.user.weapon
    if (state.dingTrack) return state.dingTrack
    return this.pool.up5[0] || null
  }

  setDingTrack (name) {
    if (this.type !== 'weapon') return false
    if (!this.pool.up5.includes(name)) return false
    this.user.weapon.dingTrack = name
    this.user.weapon.lifeNum = 0
    return true
  }

  // ---------- 抽卡结果信息 ----------

  /**
   * 生成抽卡结果信息（用于 gacha.html / single.html 的 info / poolName）
   * @returns {{ info: string, poolName: string }}
   */
  lotteryInfo () {
    const state = this.user[this.type]
    let info = `累计「${state.num5}抽」`

    if (this.res && this.res.star === 5) {
      info = `${this.res.name}「${this.res.num}抽」`
      if (this.res.isBigUP) info += '大保底'
      if (this.res.isBing) info += '定轨'
    }

    let poolName = ''
    if (this.type === 'permanent') {
      poolName = '常驻池'
    } else if (this.type === 'weapon') {
      poolName = `武器池：${this.pool.up5.join(' / ')}`
    } else {
      poolName = `角色池：${this.pool.up5.join(' / ')}`
    }

    return { info, poolName }
  }

  // ---------- 辅助 ----------

  getEnd4 () {
    const now = new Date()
    const end = new Date(now)
    end.setHours(4, 0, 0, 0)
    if (now.getHours() < 4) end.setDate(end.getDate())
    else end.setDate(end.getDate() + 1)
    return Math.floor(end.getTime() / 1000)
  }

  getWeekEnd () {
    const now = new Date()
    const day = now.getDay() || 7
    const end = new Date(now)
    end.setDate(now.getDate() + (7 - day))
    end.setHours(23, 59, 59, 999)
    return Math.floor(end.getTime() / 1000)
  }
}
