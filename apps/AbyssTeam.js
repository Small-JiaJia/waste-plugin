/**
 * 原神 #深渊配队
 * 从 miao-plugin fork 抄来的深渊配队建议，保留原版 miao 风格渲染。
 * 地址：https://github.com/cchanlan/xhh-TL
 * 数据源：提瓦特小助手 api.yshelper.com（result[3] 为配队组合列表）。
 * 算法沿用 miao-plugin：把「上半队」与「下半队」两两拼成完整 4+4 双队，
 * 按出场数据 + 本人练度打分，取每层 Top4。无 CK 也能出通用榜（不含练度）。
 *
 * 命令：#深渊配队 / #深渊组队 / #深渊配对
 * 支持 @某人：用被 @ 的人的账号练度来推荐。
 */

import _ from 'lodash'
import moment from 'moment'
import { Common } from '../../miao-plugin/components/index.js'
import { Character, MysApi, Player } from '../../miao-plugin/models/index.js'
import { getAbyssRank, pickTeamList, pickHasList } from './yshelperApi.js'

/**
 * 将 yshelper 原始配队数据转换成 miao-plugin 所需的格式
 * @param {Object} data - getAbyssRank() 返回的原始数据
 * @returns {Array|null} [{ floor: 12, up: [{item, rate}], down: [{item, rate}] }]
 * 说明：item 为逗号分隔的角色 id 字符串，rate 为出场次数
 */

function buildFloorData(data) {
  const teamList = pickTeamList(data)
  if (!teamList) return null

  const urlToId = {}
  for (const ds of pickHasList(data)) {
    const char = Character.get(ds.name)
    if (char && ds.avatar) urlToId[ds.avatar] = char.id
  }

  const floorData = { floor: 12, up: [], down: [] }
  for (const ds of teamList) {
    const ids = []
    for (const role of ds.role || []) {
      const id = urlToId[role.avatar]
      if (id) ids.push(String(id))
    }
    if (!ids.length) continue
    const item = ids.join(',')
    if (ds.up_use_num > 0) floorData.up.push({ item, rate: ds.up_use_num })
    if (ds.down_use_num > 0) floorData.down.push({ item, rate: ds.down_use_num })
  }
  if (!floorData.up.length && !floorData.down.length) return null
  return [floorData]
}

export class AbyssTeam extends plugin {
  constructor() {
    super({
      name: '[waste-plugin]深渊配队',
      dsc: '深渊配队建议（yshelper数据源）',
      event: 'message',
      priority: -999,
      rule: [
        {
          reg: '^\\s*#?深渊(配队|组队|配对)\\s*$',
          fnc: 'query'
        }
      ]
    })
  }

  async query(e) {
    console.log('[waste-plugin][AbyssTeam] 开始处理')
    try {
      // 1. CK 绑定检查
      const mys = await MysApi.init(e, 'all')
      if (!mys || !mys.uid) {
        await e.reply(`请绑定ck后再使用${e.original_msg || e.msg}`)
        return true
      }

      const player = Player.create(e)
      await player.refreshMysDetail(2)
      await player.refreshTalent()
      console.log('[waste-plugin][AbyssTeam] 玩家数据拉取成功')

      // 2. 获取配队数据
      let rawData
      try {
        rawData = await getAbyssRank()
      } catch (err) {
        console.error('[waste-plugin][AbyssTeam] 数据源失败:', err)
        await e.reply('深渊组队数据获取失败，请稍后重试~')
        return true
      }
      const floorDataList = buildFloorData(rawData)
      if (!floorDataList) {
        await e.reply('暂无可用的深渊配队数据，请稍后重试~')
        return true
      }

      // 3. 计算配队（原算法）
      const avatarData = player.getAvatarData()
      const avatarRet = {}
      const data = {}
      const noAvatar = {}

      _.forEach(avatarData, (avatar) => {
        const t = avatar.originalTalent || {}
        avatarRet[avatar.id] =
          Math.min(avatar.level, (avatar.weapon?.level || 1)) * 100 +
          Math.max(t?.a || 1, t?.e || 1, t?.q || 1) * 1000
      })

      const getTeamCfg = (str) => {
        const teams = str.split(',')
        teams.sort()
        let teamMark = 0
        _.forEach(teams, (a) => {
          if (!avatarRet[a]) {
            teamMark = -1
            noAvatar[a] = true
          }
          if (teamMark !== -1) teamMark += avatarRet[a] * 1
        })
        if (teamMark === -1) teamMark = 1
        return { key: teams.join(','), mark: teamMark }
      }

      const hasSame = (t1, t2) => {
        for (let i = 0; i < t1.length; i++) if (t2.includes(t1[i])) return true
        return false
      }

      _.forEach(floorDataList, (ds) => {
        const floor = ds.floor
        if (!data[floor]) data[floor] = { up: {}, down: {}, teams: [] }
        _.forEach(['up', 'down'], (halfKey) => {
          _.forEach(ds[halfKey], (row) => {
            const cfg = getTeamCfg(row.item)
            if (!cfg) return
            if (!data[floor][halfKey][cfg.key]) {
              data[floor][halfKey][cfg.key] = { count: 0, mark: 0, hasTeam: cfg.mark > 1 }
            }
            data[floor][halfKey][cfg.key].count += row.rate
            data[floor][halfKey][cfg.key].mark += row.rate * cfg.mark
          })
        })

        let temp = []
        _.forEach(['up', 'down'], (halfKey) => {
          _.forEach(data[floor][halfKey], (d, team) => {
            temp.push({
              team,
              teamArr: team.split(','),
              half: halfKey,
              count: d.count,
              mark: d.mark,
              mark2: 1,
              hasTeam: d.hasTeam,
            })
          })
          temp = _.sortBy(temp, 'mark')
          data[floor].teams = temp.reverse()
        })
      })

      const ret = {}
      _.forEach(data, (floorData, floor) => {
        ret[floor] = {}
        const ds = ret[floor]
        _.forEach(floorData.teams, (t1) => {
          if (t1.mark2 <= 0) return true
          _.forEach(floorData.teams, (t2) => {
            if (t1.mark2 <= 0) return true
            if (t1.half === t2.half || t2.mark2 <= 0) return true
            const teamKey = t1.half === 'up' ? t1.team + '+' + t2.team : t2.team + '+' + t1.team
            if (ds[teamKey]) return true
            if (hasSame(t1.teamArr, t2.teamArr)) return true
            ds[teamKey] = {
              up: t1.half === 'up' ? t1 : t2,
              down: t1.half === 'up' ? t2 : t1,
              count: Math.min(t1.count, t2.count),
              mark: t1.hasTeam && t2.hasTeam ? t1.mark + t2.mark : t1.count + t2.count,
            }
            t1.mark2--
            t2.mark2--
            return false
          })
          if (_.keys(ds).length >= 20) return false
        })
      })

      _.forEach(ret, (ds, floor) => {
        let arr = _.sortBy(_.values(ds), 'mark').reverse().slice(0, 4)
        _.forEach(arr, (team) => {
          team.up.teamArr = Character.sortIds(team.up.teamArr)
          team.down.teamArr = Character.sortIds(team.down.teamArr)
        })
        ret[floor] = arr
      })

      // 4. 构建头像映射
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

      // 5. 提取版本信息和时间
      const version = rawData.now_version || rawData.version || ''
      const lastUpdate = rawData.last_update || ''
      const generatedAt = moment().format('MM-DD HH:mm')
      // 判断是否有 CK（通过是否有 mys 对象，且 uid 存在）
      const hasCk = !!(mys && mys.uid)

      // 6. 渲染并返回
      console.log('[waste-plugin][AbyssTeam] 开始渲染')
      return await Common.render(
        'stat/abyss-team',
        {
          teams: ret,
          avatars: avatarMap,
          version: version,
          lastUpdate: lastUpdate,
          hasCk: hasCk,
          generatedAt: generatedAt
        },
        { e, scale: 1.5 }
      )
    } catch (err) {
      console.error('[waste-plugin][AbyssTeam] 未捕获异常:', err)
      await e.reply(`处理异常：${err.message || err}`)
      return true
    }
  }
}