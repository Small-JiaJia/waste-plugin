// apps/gacha-setting.js
// 抽卡设置管理：每日次数上限、撤回时间
// 命令：#设置抽卡 / #设置抽卡粉球100 / #设置抽卡蓝球10 / #设置抽卡撤回时间100

import plugin from '../../../lib/plugins/plugin.js'
import { getSetting, setSetting } from '../Gacha/gacha-config.js'

export class GachaSetting extends plugin {
  constructor () {
    super({
      name: '抽卡设置',
      dsc: '抽卡次数上限与撤回时间管理',
      event: 'message',
      priority: 90,
      rule: [
        { reg: '^#设置抽卡', fnc: 'setting' }
      ]
    })
  }

  async setting () {
    const msg = this.e.msg.replace(/^#设置抽卡\s*/, '').trim()
    const groupId = this.e.group_id || 'private'

    // 无参数：展示当前设置
    if (!msg) {
      const s = getSetting(groupId)
      const lines = [
        '【当前抽卡设置】',
        `粉球（角色池）每人每日上限：${s.pinkBall === 0 ? '不限制' : s.pinkBall}`,
        `蓝球（常驻池）每人每日上限：${s.blueBall === 0 ? '不限制' : s.blueBall}`,
        `武器池每人每日上限：${s.weaponBall === 0 ? '不限制' : s.weaponBall}`,
        `未出货撤回时间：${s.recallTime} 秒`,
        '',
        '修改示例：',
        '#设置抽卡粉球100',
        '#设置抽卡蓝球10',
        '#设置抽卡武器50',
        '#设置抽卡撤回时间100'
      ]
      await this.reply(lines.join('\n'), false, { at: this.e.user_id })
      return true
    }

    if (!this.e.isMaster) {
      await this.reply('仅机器人主人可以修改抽卡设置。', false, { at: this.e.user_id })
      return true
    }

    const patch = {}
    const tips = []

    const pink = msg.match(/粉球(\d+)/)
    if (pink) { patch.pinkBall = parseInt(pink[1]); tips.push(`粉球每日上限已设为 ${patch.pinkBall}`) }

    const blue = msg.match(/蓝球(\d+)/)
    if (blue) { patch.blueBall = parseInt(blue[1]); tips.push(`蓝球每日上限已设为 ${patch.blueBall}`) }

    const weapon = msg.match(/武器(?:池|球)?(\d+)/)
    if (weapon) { patch.weaponBall = parseInt(weapon[1]); tips.push(`武器池每日上限已设为 ${patch.weaponBall}`) }

    const recall = msg.match(/撤回时间(\d+)/)
    if (recall) { patch.recallTime = parseInt(recall[1]); tips.push(`撤回时间已设为 ${patch.recallTime} 秒`) }

    if (!Object.keys(patch).length) {
      await this.reply('未识别的设置项，发送「#设置抽卡」查看当前设置。', false, { at: this.e.user_id })
      return true
    }

    setSetting(groupId, patch)
    await this.reply(tips.join('\n'), false, { at: this.e.user_id })
    return true
  }
}
