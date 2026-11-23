// apps/torrent.js
// 抽卡主类：命令解析 + 次数校验 + 百连调度 + 图源对接 + 消息发送
// 单抽走 single.html，十连/百连走 gacha.html

import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import common from '../../../lib/common/common.js'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SingleGacha } from '../Gacha/singlegacha.js'
import { GachaLockTimeoutError, withGachaLock } from '../Gacha/gacha-lock.js'
import { getImg, getStar, getElem } from '../Gacha/gacha-res.js'
import { getDailyLimit, getRecallTime } from '../Gacha/gacha-config.js'
import { reserveDailyDraws } from '../Gacha/gacha-quota.js'
import { GACHA_DRAW_REGEXP, parseTenPullBatches } from '../Gacha/gacha-command.js'

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
        { reg: GACHA_DRAW_REGEXP, fnc: 'gacha' },
        { reg: '^#*定轨(.*)$', fnc: 'weaponBing' }
      ]
    })
  }

  // ==================== 命令：抽卡 ====================

  async gacha () {
    const gachacishu = this.cishu()
    if (isNaN(gachacishu) || gachacishu < 1) return true

    const type = this.parseType()
    const groupId = this.e.group_id || 'private'
    const isSingle = this.isSingleDraw()
    const totalDraw = isSingle ? 1 : gachacishu * 10
    let drawResult
    try {
      drawResult = await withGachaLock(this.e, async lock => {
        const core = await new SingleGacha(this.e, {
          type,
          role2: this.e.msg.includes('2')
        }).init()

        const limitCheck = await reserveDailyDraws({
          groupId,
          userId: this.e.user_id,
          type,
          count: totalDraw,
          limit: getDailyLimit(groupId, type),
          expiresAt: core.user.today.expire
        })

        if (!limitCheck.ok) return { ok: false, limitCheck }

        const recallTime = getRecallTime(groupId)
        if (isSingle) {
          const data = await this.runSingle(core)
          await core.saveUser(lock)
          return { ok: true, isSingle, data, recallTime }
        }

        const batches = []
        let all5 = 0
        let all4 = 0
        for (let i = 1; i <= gachacishu; i++) {
          const data = await this.runTen(core)
          all5 += data.nowFive
          all4 += data.nowFour
          batches.push(data)
        }
        await core.saveUser(lock)
        return { ok: true, isSingle, batches, all5, all4, recallTime }
      })
    } catch (err) {
      if (err instanceof GachaLockTimeoutError) {
        await this.reply('你的祈愿正在处理中，请稍后再试。', false, { at: this.e.user_id })
        return true
      }
      logger.error('[waste-plugin] 祈愿状态处理失败：', err)
      await this.reply('祈愿处理失败，请稍后重试。', false, { at: this.e.user_id })
      return true
    }

    if (!drawResult.ok) {
      const { limitCheck } = drawResult
      await this.reply(
        `你今日「${this.typeName(type)}」已抽 ${limitCheck.used} 抽，每人上限 ${limitCheck.limit} 抽，本次还需 ${totalDraw} 抽，无法继续。`,
        false, { at: this.e.user_id }
      )
      return true
    }

    // ---- 单抽分支 ----
    if (drawResult.isSingle) {
      const { data, recallTime } = drawResult
      const img = await this.screenshot(data)
      if (!img) {
        await this.reply(`抽卡已完成，但结果图片生成失败：${data.name}（${data.star}星）`, false, { at: this.e.user_id })
        return true
      }
      const recallMsg = data.star >= 4 ? 0 : recallTime
      await this.reply(img, false, { recallMsg })
      return true
    }

    // ---- 十连 / 百连分支 ----
    const { batches, all5, all4, recallTime } = drawResult

    const imgs = []
    for (const data of batches) {
      const img = await this.screenshot(data)
      if (img) imgs.push(img)
    }

    if (!imgs.length) {
      await this.reply(`抽卡已完成，共 ${totalDraw} 抽，但结果图片均生成失败。`, false, { at: this.e.user_id })
      return true
    }

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
    let result
    try {
      result = await withGachaLock(this.e, async lock => {
        const core = await new SingleGacha(this.e, { type: 'weapon' }).init()
        const up5 = core.pool.up5
        if (!up5.length) return { ok: false }

        const match = this.e.msg.replace(/^#*定轨\s*/, '').trim()
        let target = match
        if (target && !up5.includes(target)) return { ok: false, invalid: true, up5 }
        if (!target) target = up5[0]

        core.setDingTrack(target)
        await core.saveUser(lock)
        return { ok: true, up5, target }
      })
    } catch (err) {
      if (err instanceof GachaLockTimeoutError) {
        await this.reply('你的祈愿正在处理中，请稍后再试。', false, { at: this.e.user_id })
        return true
      }
      logger.error('[waste-plugin] 定轨状态处理失败：', err)
      await this.reply('定轨处理失败，请稍后重试。', false, { at: this.e.user_id })
      return true
    }

    if (!result.ok && !result.invalid) {
      await this.reply('当前没有可定轨的武器。', false, { at: this.e.user_id })
      return true
    }

    if (result.invalid) {
      await this.reply(`当期UP武器为：${result.up5.join('、')}，请从中选择。`, false, { at: this.e.user_id })
      return true
    }

    const lines = result.up5.map(v => (v === result.target ? `[√] ${v}` : `[ ] ${v}`))
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
    return parseTenPullBatches(this.e.msg)
  }

  parseType () {
    if (this.e.msg.includes('武器')) return 'weapon'
    if (this.e.msg.includes('常驻')) return 'permanent'
    return 'role'
  }

  /** 池子中文名 */
  typeName (type) {
    if (type === 'weapon') return '武器池'
    if (type === 'permanent') return '常驻池'
    return '角色池'
  }
}
