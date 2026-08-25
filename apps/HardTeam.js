/**
 * 原神 #危战配队
 * 幽境危战出场配队建议，保留原版 miao 风格渲染。
 * 地址：https://github.com/cchanlan/xhh-TL
 * 数据源：提瓦特小助手 api.yshelper.com/getAbyssRank2.php。
 * 与深渊不同：危战配队分「上半区 / 中半区 / 下半区」三关强敌，每个 combo
 * 本身就是完整 4 人队，不需要像深渊那样把上下半拼成 4+4 双队。
 * 因此这里对每个半区各取高频完整队，按出场热度 + 本人练度打分排序取 Top。
 * 无 CK 也能出通用榜（不含练度）。
 *
 * 命令：#危战配队 / #危战组队 / #危战配对
 *       #幽境危战配队 / #幽境危战组队 / #幽境危战配对
 *       #幽境配队 / #幽境组队 / #幽境配对
 * 支持 @某人：用被 @ 的人的账号练度来推荐。
 */

import _ from 'lodash'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Common } from '../../miao-plugin/components/index.js'
import { Character, MysApi, Player } from '../../miao-plugin/models/index.js'
import { getHardRank, pickTeamList, buildAvatarUrlNameMap } from './yshelperApi.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const wasteStatDir = path.join(__dirname, '../resources/stat')
const miaoStatDir = path.join(__dirname, '../../miao-plugin/resources/stat')

// 确保模板文件存在于 miao-plugin 目录
let _templateReady = false
function ensureTemplate() {
  if (_templateReady) return true
  try {
    if (!fs.existsSync(miaoStatDir)) {
      fs.mkdirSync(miaoStatDir, { recursive: true })
    }
    const htmlSrc = path.join(wasteStatDir, 'hard-team.html')
    const cssSrc = path.join(wasteStatDir, 'hard-team.css')
    const htmlDst = path.join(miaoStatDir, 'hard-team.html')
    const cssDst = path.join(miaoStatDir, 'hard-team.css')
    if (!fs.existsSync(htmlDst) && fs.existsSync(htmlSrc)) {
      fs.copyFileSync(htmlSrc, htmlDst)
      console.log('[HardTeam] 已复制模板 hard-team.html 到 miao-plugin')
    }
    if (!fs.existsSync(cssDst) && fs.existsSync(cssSrc)) {
      fs.copyFileSync(cssSrc, cssDst)
      console.log('[HardTeam] 已复制样式 hard-team.css 到 miao-plugin')
    }
    _templateReady = true
    return true
  } catch (err) {
    console.error('[HardTeam] 复制模板失败:', err)
    return false
  }
}

// 三半区元数据
const HALVES = [
  { key: 'up', numKey: 'up_use_num', label: '上半区', cls: 'up' },
  { key: 'mid', numKey: 'mid_use_num', label: '中半区', cls: 'mid' },
  { key: 'down', numKey: 'down_use_num', label: '下半区', cls: 'down' },
]

/**
 * 将危战配队数据整理成 { up:[{ids,rate}], mid:[...], down:[...] }
 */
function buildHalfData(data) {
  const teamList = pickTeamList(data)
  if (!teamList) return null

  const urlToName = buildAvatarUrlNameMap(data)

  const half = { up: [], mid: [], down: [] }
  for (const ds of teamList) {
    const ids = []
    for (const role of ds.role || []) {
      const name = urlToName[role.avatar]
      const char = name ? Character.get(name) : null
      if (char) ids.push(String(char.id))
    }
    if (!ids.length) continue
    for (const h of HALVES) {
      const num = ds[h.numKey]
      if (num > 0) half[h.key].push({ ids, rate: num })
    }
  }
  if (!half.up.length && !half.mid.length && !half.down.length) return null
  return half
}

/**
 * 对每个半区：合并相同队伍，按出场次数+练度分排序取 TopN
 */
function computeHalves(half, avatarData, topN = 6) {
  const avatarRet = {}
  const noAvatar = {}
  _.forEach(avatarData, (avatar) => {
    const t = avatar.originalTalent || {}
    avatarRet[avatar.id] =
      Math.min(avatar.level, (avatar.weapon?.level || 1)) * 100 +
      Math.max(t?.a || 1, t?.e || 1, t?.q || 1) * 1000
  })

  const getTeamCfg = (ids) => {
    const arr = [...ids].sort()
    let mark = 0
    let hasTeam = true
    _.forEach(arr, (a) => {
      if (!avatarRet[a]) {
        hasTeam = false
        noAvatar[a] = true
      }
      if (hasTeam) mark += avatarRet[a] * 1
    })
    if (!hasTeam) mark = 1
    return { key: arr.join(','), mark, hasTeam }
  }

  const ret = {}
  _.forEach(HALVES, (h) => {
    const merged = {}
    _.forEach(half[h.key] || [], (row) => {
      const cfg = getTeamCfg(row.ids)
      if (!merged[cfg.key]) {
        merged[cfg.key] = { count: 0, mark: 0, hasTeam: cfg.hasTeam, cfgMark: cfg.mark }
      }
      merged[cfg.key].count += row.rate
      merged[cfg.key].mark += row.rate * cfg.mark
    })
    let arr = _.map(merged, (d, key) => ({
      ids: key.split(','),
      count: d.count,
      mark: d.hasTeam ? d.mark : d.count,
    }))
    arr = _.sortBy(arr, 'mark').reverse().slice(0, topN)
    _.forEach(arr, (team) => {
      team.ids = Character.sortIds(team.ids)
    })
    ret[h.key] = arr
  })

  // 构建头像映射
  const avatarMap = {}
  _.forEach(avatarData, (ds) => {
    const char = Character.get(ds.id)
    avatarMap[ds.id] = {
      id: ds.id,
      name: ds.name,
      star: ds.star,
      level: ds.level,
      cons: ds.cons,
      face: char.face,
    }
  })
  _.forEach(noAvatar, (d, id) => {
    const char = Character.get(id)
    if (!char) return
    avatarMap[id] = {
      id,
      name: char.name,
      face: char.face,
      star: char.star,
      level: 0,
      cons: 0,
    }
  })

  return { ret, avatarMap }
}

export class HardTeam extends plugin {
  constructor() {
    super({
      name: '[waste-plugin]危战配队',
      dsc: '幽境危战配队建议（yshelper数据源）',
      event: 'message',
      priority: -999,
      rule: [
        {
          reg: '^\\s*#?(?:幽境)?(?:危战)?(配队|组队|配对)\\s*$',
          fnc: 'query',
        },
      ],
    })
  }

  async query(e) {
    console.log('[waste-plugin][HardTeam] 开始处理')
    try {
      // 1. CK 绑定
      const mys = await MysApi.init(e, 'all')
      if (!mys || !mys.uid) {
        await e.reply(`请绑定ck后再使用${e.original_msg || e.msg}`)
        return true
      }

      const player = Player.create(e)
      await player.refreshMysDetail(2)
      await player.refreshTalent()
      console.log('[waste-plugin][HardTeam] 玩家数据拉取成功')

      // 2. 获取危战数据
      let rawData
      try {
        rawData = await getHardRank()
      } catch (err) {
        console.error('[waste-plugin][HardTeam] 数据源失败:', err)
        await e.reply('危战配队数据获取失败，请稍后重试~')
        return true
      }
      const halfData = buildHalfData(rawData)
      if (!halfData) {
        await e.reply('暂无可用的危战配队数据，请稍后重试~')
        return true
      }

      // 3. 计算配队
      const avatarData = player.getAvatarData()
      const { ret, avatarMap } = computeHalves(halfData, avatarData)

      // 4. 确保模板已复制到 miao-plugin
      ensureTemplate()

      // 5. 提取版本信息和生成时间
      const version = rawData.now_version || rawData.version || ''
      const lastUpdate = rawData.last_update || ''
      const now = new Date()
      const generatedAt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      // 如果 lastUpdate 包含冒号，则视为包含时间，否则使用 generatedAt
      const displayTime = (lastUpdate && lastUpdate.includes(':')) ? lastUpdate : generatedAt

      // 6. 渲染并返回
      console.log('[waste-plugin][HardTeam] 开始渲染')
      return await Common.render(
        'stat/hard-team',
        {
          teams: ret,
          avatars: avatarMap,
          version: version,
          displayTime: displayTime   // 直接使用处理后的时间
        },
        { e, scale: 1.5 }
      )
    } catch (err) {
      console.error('[waste-plugin][HardTeam] 未捕获异常:', err)
      await e.reply(`处理异常：${err.message || err}`)
      return true
    }
  }
}