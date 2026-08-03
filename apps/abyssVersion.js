import plugin from '../../../lib/plugins/plugin.js'
import _ from 'lodash'
import fs from 'node:fs'
import path from 'path'

/**
 * 原神深渊版本查询插件
 * 存放路径：plugins/waste-plugin/apps/abyssVersion.js
 * 仅本地读取图片，无远程下载、无缓存、无定时清理
 * 本地图片目录：plugins/waste-plugin/resources/Version/
 * 支持：深境螺旋、幽境危战、幻想真境剧诗
 */

export class abyssVersion extends plugin {
  constructor() {
    // 构建匹配正则别名
    const aliasDict = abyssVersion.getAliasesStatic()
    const aliasList = Array.from(new Set(
      Object.values(aliasDict).flatMap(obj => Object.entries(obj).flatMap(([key, arr]) => [key, ...arr]))
    ))
    const typeReg = aliasList.map(_.escapeRegExp).join("|")

    super({
      name: '原神深渊版本查询',
      dsc: '原神各版本深境螺旋、幽境危战、幻想真境剧诗本地图片查询',
      event: 'message',
      priority: 5,
      rule: [
        {
          reg: `^#?(原神)?([1-9]\\.\\d{1})(${typeReg})$`,
          fnc: 'abyssVersion'
        }
      ]
    })

    // 本地图片根目录
    this.imgRoot = path.join(process.cwd(), 'plugins', 'waste-plugin', 'resources', 'genshin')
    // 不存在则自动创建文件夹
    if (!fs.existsSync(this.imgRoot)) {
      fs.mkdirSync(this.imgRoot, { recursive: true })
    }
  }

  /** 静态别名对照表 - 仅保留原神内容 */
  static getAliasesStatic() {
    return {
      ys: {
        "深境螺旋": ["深渊", "深境", "螺旋"],
        "幽境危战": ["幽境", "危战"],
        "幻想真境剧诗": ["幻想", "真境", "剧诗"]
      }
    }
  }

  getAliases() {
    return abyssVersion.getAliasesStatic()
  }

  /** 别名转标准名称 */
  getFormalName(role, game) {
    const aliases = this.getAliases()[game] || {}
    for (const [stdName, aliasArr] of Object.entries(aliases)) {
      if (aliasArr.includes(role) || stdName === role) return stdName
    }
    return role
  }

  /** 根据版本、玩法计算图片文件名编号 */
  calculateNumber(version, formalAbyss) {
    // 幽境危战直接使用版本号
    if (formalAbyss === '幽境危战') {
      return [version]
    }
    // 深境螺旋、幻想真境剧诗区分 A/B 上下半
    if (formalAbyss === '深境螺旋' || formalAbyss === '幻想真境剧诗') {
      return [version, `${version}A`, `${version}B`]
    }
    return [version]
  }

  /** 读取本地图片，无下载逻辑 */
  getLocalImage(formalName, number) {
    const imgPath = path.join(this.imgRoot, formalName, `${number}.png`)
    if (fs.existsSync(imgPath)) {
      return imgPath
    }
    return null
  }

  // 主指令：#版本深渊
  async abyssVersion() {
    await this.e.reply('查询中，请稍后', true, { recallMsg: 20 })
    const aliasList = Array.from(new Set(
      Object.values(this.getAliases()).flatMap(obj => Object.entries(obj).flatMap(([k, a]) => [k, ...a]))
    ))
    const typeReg = aliasList.map(_.escapeRegExp).join("|")
    const reg = new RegExp(`^#?(原神)?([1-9]\\.\\d{1})(${typeReg})$`)
    const match = reg.exec(this.e.msg)
    if (!match) return false

    let [, gameTag, ver, abyssRaw] = match
    const formalAbyss = this.getFormalName(abyssRaw, 'ys')
    const numList = this.calculateNumber(ver, formalAbyss)

    const imgs = []
    for (const num of numList) {
      const imgPath = this.getLocalImage(formalAbyss, num)
      if (imgPath) imgs.push(segment.image(`file://${imgPath}`))
    }

    if (imgs.length > 0) {
      const title = `原神 ${ver} ${formalAbyss}`
      await this.e.reply([title, ...imgs])
      return true
    } else {
      await this.e.reply(`暂无原神 ${ver}版本 ${formalAbyss} 资源图片`)
      return false
    }
  }
}