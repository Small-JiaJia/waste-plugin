// Gacha/singlegacha.js
// 抽卡核心：单抽概率计算 + 捕获明光（计数器 + 0.018% 基础概率）+ 武器定轨（命定值上限1）

import lodash from 'lodash'
import { POOL, PROB, getCurrentPool } from '../data/gacha-pool.js'

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
    if (!this.e) return 'waste-plugin:gacha:unknown'
    const prefix = 'waste-plugin:gacha'
    if (this.e.isGroup) return `${prefix}:${this.e.group_id}:${this.e.user_id}`
    return `${prefix}:private:${this.e.user_id}`
  }

  async loadUser () {
    let user = await redis.get(this.key)
    if (user) {
      user = JSON.parse(user)
      const now = Date.now() / 1000
      if (now > user.today.expire) {
        user.today = { star: [], expire: this.getEnd4(), num: 0, weaponNum: 0 }
      }
      if (now > user.week.expire) {
        user.week = { num: 0, expire: this.getWeekEnd() }
      }
      return user
    }
    const common = { num4: 0, isUp4: 0, num5: 0, isUp5: 0, captureCount: 1 }
    return {
      permanent: { ...common },
      role: { ...common },
      weapon: { ...common, lifeNum: 0, dingTrack: null },
      today: { star: [], expire: this.getEnd4(), num: 0, weaponNum: 0 },
      week: { num: 0, expire: this.getWeekEnd() }
    }
  }

  async saveUser () {
    await redis.setEx(this.key, 3600 * 24 * 7, JSON.stringify(this.user))
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
      isBing = true
    }
    // 大保底
    else if (state.isUp5 === 1) {
      isBigUP = true
      state.isUp5 = 0
      tmpName = lodash.sample(this.pool.up5)
      if (tmpName === this.getDingWeapon()) state.lifeNum = 0
    }
    // 小保底：角色池走捕获明光
    else if (this.type === 'role') {
      const result = this.rollCapturingRadiance(state)
      tmpName = result.name
      isBigUP = result.isBigUP
    }
    // 武器池小保底 / 常驻池
    else {
      const tmpUp = this.type === 'permanent' ? 0 : PROB.wai
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

  /**
   * 捕获明光判定（精确模型）
   * 计数器初始 1，歪 +1，不歪 -1（最低 0），达到 3 必触发，触发后重置为 1
   * 另有 0.018% 无条件基础触发概率
   */
  rollCapturingRadiance (state) {
    if (state.captureCount >= PROB.captureMax) {
      state.captureCount = 1
      state.isUp5 = 0
      return { name: lodash.sample(this.pool.up5), isBigUP: false }
    }

    if (Math.random() * 100 < PROB.captureBase) {
      state.captureCount = 1
      state.isUp5 = 0
      return { name: lodash.sample(this.pool.up5), isBigUP: false }
    }

    if (lodash.random(1, 100) <= PROB.wai) {
      state.captureCount = Math.min(state.captureCount + 1, PROB.captureMax)
      state.isUp5 = 1
      return { name: lodash.sample(this.pool.five), isBigUP: false }
    } else {
      state.captureCount = Math.max(state.captureCount - 1, 0)
      state.isUp5 = 0
      return { name: lodash.sample(this.pool.up5), isBigUP: false }
    }
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
    let tmpChance5 = PROB.chance5

    if (this.type === 'role' || this.type === 'permanent') {
      if (this.user.week.num === 1) tmpChance5 *= 2
      if (state.num5 >= 90) {
        tmpChance5 = 10000
      } else if (state.num5 >= 74) {
        tmpChance5 = 590 + (state.num5 - 74) * 530
      } else if (state.num5 >= 60) {
        tmpChance5 = PROB.chance5 + (state.num5 - 50) * 40
      }
    }

    if (this.type === 'weapon') {
      tmpChance5 = PROB.chanceW5
      if (this.user.week.num === 1) tmpChance5 *= 3
      if (state.num5 >= 80) {
        tmpChance5 = 10000
      } else if (state.num5 >= 62) {
        tmpChance5 += (state.num5 - 61) * 700
      } else if (state.num5 >= 45) {
        tmpChance5 += (state.num5 - 45) * 60
      } else if (state.num5 >= 10 && state.num5 <= 20) {
        tmpChance5 += (state.num5 - 10) * 30
      }
    }

    return tmpChance5
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