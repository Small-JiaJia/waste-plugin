import lodash from 'lodash'
import moment from 'moment'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import plugin from '../../../lib/plugins/plugin.js'
import cards from '../data/kauChim.js'
import { pluginName } from '../config/constant.js'
import { claimDailyCooldown } from '../model/atomic-daily-limit.js'

export class kauChim extends plugin {
  constructor () {
    super({
      name: 'kauChim',
      dsc: '求签',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(抽签|求签|御神签)(\\s|$)',
          fnc: 'kauChim'
        }
      ]
    })
    this.prefix = 'L:other:kauChim:'
  }

  get key () {
    /** 群，私聊分开 */
    if (this.e.isGroup) {
      return `${this.prefix}${this.e.group_id}:${this.e.user_id}`
    } else {
      return `${this.prefix}private:${this.e.user_id}`
    }
  }

  async checkUser () {
    const now = moment()
    const result = await claimDailyCooldown({
      key: this.key,
      now: now.unix(),
      expiresAt: now.clone().endOf('day').unix(),
      ttlSeconds: 3600 * 24
    })
    return result.ok
  }

  async kauChim () {
    const card = lodash.sample(cards)
    const valid = await this.checkUser()
    if (!valid) {
      await this.reply('（今天已经抽过了，明天再来看看吧…）')
      return true
    }

    let msg = `${card?.name}\n${card?.dsc}`
    if (this.e.isGroup) {
      msg = '\n' + msg
    }

    const replyText = async () => {
      await this.reply(msg, false, { at: true })
      if (card?.item) await this.reply(card.item)
    }

    if (!card || !this.e.runtime) {
      await replyText()
      return true
    }

    const saveId = `fortune-${randomUUID()}`
    const renderFile = path.join(
      process.cwd(), 'temp', 'html', pluginName, 'fortune', 'kauChim', `${saveId}.html`
    )

    try {
      const rank = card.name?.split('·')[0] || '吉'
      const title = card.name?.split('·').slice(1).join('·') || card.name || '今日御神签'
      const image = await this.e.runtime.render(pluginName, 'fortune/kauChim', {
        fortune: {
          rank,
          title,
          description: card.dsc || '',
          item: card.item || '',
          tone: rank.includes('凶') ? 'low' : rank === '大吉' ? 'high' : 'steady'
        },
        date: moment().format('YYYY.MM.DD'),
        saveId
      }, { retType: 'base64' })

      if (image) {
        await this.reply(image, false, { at: true })
        return true
      }
    } catch (error) {
      logger.error('[waste-plugin] 御神签图片渲染失败：', error)
    } finally {
      await fs.unlink(renderFile).catch(() => {})
    }

    await replyText()
    return true
  }
}
