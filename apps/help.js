import plugin from '../../../lib/plugins/plugin.js'
import { pluginName } from '../config/constant.js'

const helpGroups = [
  {
    name: '祈愿与命运',
    mark: '01',
    entries: [
      { command: '#单抽 · #十连 · #百连', description: '模拟角色活动祈愿，查看抽取结果。' },
      { command: '#十连2 · #常驻十连 · #武器十连', description: '选择第二期角色、常驻或武器祈愿。' },
      { command: '#定轨 武器名', description: '为当期 UP 武器定轨；不填名称时默认选择首把。' },
    ],
  },
  {
    name: '深境挑战',
    mark: '02',
    entries: [
      { command: '#深渊配队', description: '结合持有角色与练度推荐上下半阵容。' },
      { command: '#幽境配队 · #危战配队', description: '查看幽境危战挑战配队建议。' },
    ],
  },
  {
    name: '版本图鉴',
    mark: '03',
    entries: [
      { command: '#6.6深渊', description: '查看指定版本的深境螺旋参考图。' },
      { command: '#6.6剧诗', description: '查看幻想真境剧诗参考图。' },
      { command: '#6.6幽境', description: '查看幽境危战参考图。' },
    ],
  },
  {
    name: '占卜与签运',
    mark: '04',
    entries: [
      { command: '#抽签 · #求签 · #御神签', description: '鸣神大社每日签运。' },
      { command: '#占卜', description: '抽取月谕圣牌，查看牌面解读。' },
    ],
  },
  {
    name: '旅途工具',
    mark: '05',
    entries: [
      { command: '#帮我选 苹果 香蕉', description: '在空格分开的选项中替你做决定。' },
      { command: '1+1 · (2+3)*4', description: '直接发送算式即可计算。' },
      { command: '#去背景', description: '发送图片时附上指令，或回复一张图片。' },
    ],
  },
  {
    name: '祈愿设置',
    mark: '06',
    entries: [
      { command: '#设置抽卡', description: '查看当前会话的祈愿次数与撤回设置。' },
      { command: '#设置抽卡粉球100 · #设置抽卡蓝球100', description: '设置角色祈愿与常驻池每日上限。' },
      { command: '#设置抽卡武器100', description: '设置武器池每日上限。' },
      { command: '#设置抽卡撤回时间60', description: '设置未出货结果的撤回秒数。' },
    ],
  },
]

export class Help extends plugin {
  constructor() {
    super({
      name: '[waste-plugin]小佳佳帮助',
      dsc: 'waste-plugin 功能帮助',
      event: 'message',
      priority: 40,
      rule: [
        {
          reg: '^#小佳佳帮助$',
          fnc: 'showHelp',
        },
      ],
    })
  }

  async showHelp(e) {
    if (!e.runtime) {
      await e.reply('未找到图片渲染环境，请升级 Yunzai 后重试。')
      return true
    }

    try {
      const image = await e.runtime.render(pluginName, 'help/index', { helpGroups }, { retType: 'base64' })
      if (!image) {
        await e.reply('帮助图片生成失败，请稍后重试。')
        return true
      }

      await e.reply(image)
    } catch (error) {
      logger.error('[waste-plugin] 帮助图片渲染失败：', error)
      await e.reply('帮助图片生成失败，请稍后重试。')
    }

    return true
  }
}
