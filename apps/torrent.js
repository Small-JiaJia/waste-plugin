// apps/torrent.js
// 抽卡主类：命令解析 + 次数校验 + 百连调度 + 图源对接 + 消息发送
// 单抽走 single.html，十连/百连走 gacha.html

import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import common from '../../../lib/common/common.js'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SingleGacha } from '../Gacha/singlegacha.js'
import { getImg, getStar, getElem } from '../Gacha/gacha-res.js'
import { checkDailyLimit, getRecallTime } from '../Gacha/gacha-config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RES_ROOT = path.resolve(__dirname, '../resources/genshin')

export class torrent extends plugin {
  constructor () {
    super({
      name: '抽卡插件十连',
      dsc: '模拟抽卡，支持单抽、十连、百连',
      event: 'message',
      priority: 99,
      rule: [
        { reg: '^#*(单抽|单|10|[武器池常驻]*([一二三四五六七八九]?[十百]+)|抽)[连抽卡奖][123武器池常驻]*$', fnc: 'gacha' },
        { reg: '^#*定轨(.*)$', fnc: 'weaponBing' }
      ]
    })
  }

  // ==================== 命令：抽卡 ====================

  async gacha () {
    const gachacishu = this.cishu()
    if (isNaN(gachacishu) || gachacishu < 1) return true

    const type = this.parseType()

    // 初始化抽卡核心
    const core = await new SingleGacha(this.e, {
      type,
      role2: this.e.msg.includes('2')
    }).init()

    // ---- 每日次数校验 ----
    const groupId = this.e.group_id || 'private'
    const isSingle = this.isSingleDraw()
    const totalDraw = isSingle ? 1 : gachacishu * 10
    const todayUsed = this.getTodayUsed(core, type)
    const limitCheck = checkDailyLimit(groupId, type, todayUsed, totalDraw)
    if (!limitCheck.ok) {
      await this.reply(
        `今日「${this.typeName(type)}」已抽 ${todayUsed} 抽，上限 ${limitCheck.limit} 抽，本次还需 ${totalDraw} 抽，无法继续。`,
        false, { at: this.e.user_id }
      )
      return true
    }

    // ---- 撤回时间 ----
    const recallTime = getRecallTime(groupId)

    // ---- 单抽分支 ----
    if (isSingle) {
      const data = await this.runSingle(core)
      const img = await this.screenshot(data)
      if (!img) return false
      await core.saveUser()
      const recallMsg = data.star >= 4 ? 0 : recallTime
      await this.reply(img, false, { recallMsg })
      return true
    }

    // ---- 十连 / 百连分支 ----
    const imgs = []
    let all5 = 0
    let all4 = 0

    for (let i = 1; i <= gachacishu; i++) {
      const data = await this.runTen(core)
      all5 += data.nowFive
      all4 += data.nowFour
      const img = await this.screenshot(data)
      if (img) imgs.push(img)
    }
    await core.saveUser()

    const recallMsg = (all5 >= 2 || all4 >= 25) ? 0 : recallTime

    if (this.e.isGroup) {
      const forward = await common.makeForwardMsg(this.e, imgs, '点我查看抽卡结果')
      await this.reply(forward, false, { recallMsg })
    } else {
      await this.reply(imgs, false, { recallMsg })
    }
    return true
  }

  // ==================== 命令：定轨 ====================

  async weaponBing () {
    const core = await new SingleGacha(this.e, { type: 'weapon' }).init()
    const up5 = core.pool.up5

    if (!up5.length) {
      await this.reply('当前没有可定轨的武器。', false, { at: this.e.user_id })
      return true
    }

    const match = this.e.msg.replace(/^#*定轨\s*/, '').trim()
    let target = match
    if (target && !up5.includes(target)) {
      await this.reply(`当期UP武器为：${up5.join('、')}，请从中选择。`, false, { at: this.e.user_id })
      return true
    }
    if (!target) target = up5[0]

    core.setDingTrack(target)
    await core.saveUser()

    const lines = up5.map(v => (v === target ? `[√] ${v}` : `[ ] ${v}`))
    await this.reply(`定轨成功\n${lines.join('\n')}\n命定值已重置`, false, { at: this.e.user_id })
    return true
  }

  // ==================== 渲染数据构造 ====================

  /** 单抽：渲染 1 张卡，走 single.html */
  async runSingle (core) {
    const res = core.lottery()
    const isWeapon = res.type === 'weapon'

    const rawPath = getImg(res.name, isWeapon)
    res.imgPath = rawPath ? pathToFileURL(rawPath).href : ''
    res.element = getElem(res.name, isWeapon)

    const { info, poolName } = core.lotteryInfo()

    return {
      name: res.name,
      star: res.star,
      element: res.element,
      imgPath: res.imgPath,
      info,
      poolName,
      isWeapon,
      isWeaponPool: core.type === 'weapon',
      bingWeapon: core.getDingWeapon(),
      lifeNum: core.user[core.type]?.lifeNum || 0,
      tplFile: path.join(RES_ROOT, 'html/single/single.html'),
      pluResPath: RES_ROOT + '/'
    }
  }

  /** 十连：渲染 10 张卡，走 gacha.html */
  async runTen (core) {
    const list = []
  
    for (let i = 1; i <= 10; i++) {
      const res = core.lottery()
      res.index = i
  
      const isWeapon = res.type === 'weapon'
      const rawPath = getImg(res.name, isWeapon)
      res.imgPath = rawPath ? pathToFileURL(rawPath).href : ''
      res.starIcon = getStar(res.name, isWeapon)
      res.element = getElem(res.name, isWeapon)
  
      list.push(res)
    }
  
    list.sort((a, b) => {
      if (b.star !== a.star) return b.star - a.star
      if (a.type !== b.type) return a.type === 'role' ? -1 : 1
      return a.index - b.index
    })
  
    const nowFive = list.filter(v => v.star === 5).length
    const nowFour = list.filter(v => v.star === 4).length
    const { info, poolName } = core.lotteryInfo()
  
    return {
      name: this.e.sender.card,
      list,
      nowFive,
      nowFour,
      info,
      poolName,
      isWeapon: core.type === 'weapon',
      isWeaponPool: core.type === 'weapon',
      bingWeapon: core.getDingWeapon(),
      lifeNum: core.user[core.type]?.lifeNum || 0,
      tplFile: path.join(RES_ROOT, 'html/gacha/gacha.html'),
      pluResPath: RES_ROOT + '/'
    }
  }

  async screenshot (data) {
    try {
      return await puppeteer.screenshot('gacha', data)
    } catch (err) {
      logger.error('[waste-plugin] 抽卡截图失败：', err)
      return null
    }
  }

  // ==================== 解析辅助 ====================

  isSingleDraw () {
    const msg = this.e.msg
    if (msg.includes('十') || msg.includes('百') || msg.includes('连')) return false
    if (msg.includes('单')) return true
    return this.cishu() === 1
  }

  cishu () {
    const each = this.e.msg.replace(/(0|1|池|武器|十|抽|单|连|卡|奖|2|3)/g, '').trim()
    const arr = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '百']
    for (let i = 0; i <= 9; i++) {
      if (each.includes(arr[i])) return i + 1
    }
    return 1
  }

  parseType () {
    if (this.e.msg.includes('武器')) return 'weapon'
    if (this.e.msg.includes('常驻')) return 'permanent'
    return 'role'
  }

  /** 今日已抽数（角色池/武器池/常驻池分别统计） */
  getTodayUsed (core, type) {
    const t = core.user.today
    if (!t) return 0
    // today.num 记录角色/常驻总抽数，today.weaponNum 记录武器池抽数
    // 原版只区分"粉球"（角色+常驻）和"蓝球"（常驻），此处按池子细分
    if (type === 'weapon') return t.weaponNum || 0
    return t.num || 0
  }

  /** 池子中文名 */
  typeName (type) {
    if (type === 'weapon') return '武器池'
    if (type === 'permanent') return '常驻池'
    return '角色池'
  }
}