import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import plugin from '../../../lib/plugins/plugin.js'

// 资源路径配置
const DATA_PATH = path.join(process.cwd(), './plugins/waste-plugin/data/roleId.js')
const AVATAR_DIR = path.join(process.cwd(), './plugins/waste-plugin/resources/genshin/logo/role')
const BODY_DIR = path.join(process.cwd(), './plugins/waste-plugin/resources/genshin/gacha/character')

// 游戏常量
const INIT_CROP_SIZE = 60
const CROP_SCALE = 1.6
const GAME_EXPIRE = 3 * 60 * 60 * 1000 // 3小时过期
const WRONG_REACT = 123
const RIGHT_REACT = 144
// 模式枚举
const MODE = {
  AVATAR: 'avatar',    // 猜头像
  NORMAL: 'normal',    // 普通全身
  HARD: 'hard',        // 黑白局部
  HELL: 'hell'         // 反色局部
}

// 全局游戏缓存
const gameMap = new Map()

// 工具函数
const clamp = (val, min, max) => Math.max(min, Math.min(max, val))
const randomInt = max => Math.floor(Math.random() * max)

// 清理过期对局
function cleanExpireGame() {
  const now = Date.now()
  for (const [msgId, game] of gameMap) {
    if (game.expire <= now) gameMap.delete(msgId)
  }
}

// 读取角色别名数据
function getRoleData() {
  try {
    const absPath = path.resolve(DATA_PATH)
    delete require.cache[require.resolve(absPath)]
    const roleId = require(absPath)
    logger.info(`[猜角色] 成功读取roleId，共${Object.keys(roleId).length}个角色配置`)
    return roleId
  } catch (e) {
    logger.error(`[猜角色] 读取roleId失败: ${e.message}，请检查data/roleId.js是否存在并添加module.exports = roleId`)
    return {}
  }
}

// 获取全部可用角色ID
function getAllRoleIds() {
  const roleData = getRoleData()
  if (!roleData || typeof roleData !== 'object') return []
  const ids = Object.keys(roleData).filter(id => {
    const alias = roleData[id]
    if (!Array.isArray(alias) || alias.length === 0) return false
    // 过滤空占位角色
    if (['10000000', '10000117', '10000118', '10000130'].includes(id)) return false
    return true
  })
  logger.info(`[猜角色] 筛选后有效角色ID数量：${ids.length}`)
  return ids
}

// 获取角色匹配标准名称
function matchRoleName(input) {
  const roleData = getRoleData()
  const inputTrim = input.trim().toLowerCase()
  for (const [rid, aliasList] of Object.entries(roleData)) {
    if (!Array.isArray(aliasList)) continue
    for (const name of aliasList) {
      if (String(name).toLowerCase() === inputTrim) {
        return { rid, name: aliasList[0] }
      }
    }
  }
  return null
}

// 随机裁剪区域计算
function randomCropPos(imgW, imgH, cropSize) {
  const w = Math.min(imgW, cropSize)
  const h = Math.min(imgH, cropSize)
  const maxX = Math.max(1, imgW - w)
  const maxY = Math.max(1, imgH - h)
  const centerX = w / 2 + randomInt(maxX)
  const centerY = h / 2 + randomInt(maxY)
  return { centerX, centerY, cropW: w, cropH: h }
}

// 生成裁剪边界
function getCropBound(game) {
  const { centerX, centerY, cropW, cropH, imgW, imgH } = game
  const left = clamp(Math.round(centerX - cropW / 2), 0, imgW - cropW)
  const top = clamp(Math.round(centerY - cropH / 2), 0, imgH - cropH)
  return { left, top, width: cropW, height: cropH }
}

// 读取对应角色图片buffer（修改：用角色标准名做文件名）
async function getRoleImg(rid, mode) {
  const roleData = getRoleData()
  const roleName = roleData[rid][0] // 取第一个标准中文名作为图片文件名
  let imgPath
  if (mode === MODE.AVATAR) {
    imgPath = path.join(AVATAR_DIR, `${roleName}.png`)
  } else {
    imgPath = path.join(BODY_DIR, `${roleName}.png`)
  }
  if (!fs.existsSync(imgPath)) throw new Error(`图片不存在: ${imgPath}`)
  return fs.readFileSync(imgPath)
}

// 渲染局部提示图
async function renderCropImg(game) {
  const bound = getCropBound(game)
  let sp = sharp(game.imgBuffer)
  sp = sp.extract(bound).resize(360)
  if (game.mode === MODE.HARD) sp = sp.grayscale()
  if (game.mode === MODE.HELL) sp = sp.negate()
  return sp.webp({ quality: 90 }).toBuffer()
}

// 渲染完整揭晓图（暗化未展示区域）
async function renderFullReveal(game) {
  const { imgBuffer, shownBounds, imgW, imgH, mode } = game
  let raw = await sharp(imgBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { data, info } = raw
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const isShow = shownBounds.some(b =>
        x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height
      )
      if (!isShow) {
        const offset = (y * imgW + x) * info.channels
        data[offset] = Math.round(data[offset] * 0.4)
        data[offset + 1] = Math.round(data[offset + 1] * 0.4)
        data[offset + 2] = Math.round(data[offset + 2] * 0.4)
      }
    }
  }
  let sp = sharp(data, { raw: info }).resize(640)
  if (mode === MODE.HARD) sp = sp.grayscale()
  if (mode === MODE.HELL) sp = sp.negate()
  return sp.webp({ quality: 92 }).toBuffer()
}

// 创建新对局：循环遍历角色，跳过缺图角色
async function createGame(mode) {
  const allIds = getAllRoleIds()
  if (!allIds.length) throw new Error('roleId无有效角色配置，请检查data/roleId.js是否添加module.exports导出')

  // 打乱角色顺序，逐个尝试加载图片
  const shuffleIds = [...allIds].sort(() => Math.random() - 0.5)
  let errList = []
  for (const rid of shuffleIds) {
    try {
      const imgBuf = await getRoleImg(rid, mode)
      const meta = await sharp(imgBuf).metadata()
      const imgW = meta.width
      const imgH = meta.height
      if (!imgW || !imgH) throw new Error('图片尺寸异常')

      const roleData = getRoleData()
      const roleName = roleData[rid][0]
      const initCrop = Math.min(INIT_CROP_SIZE, imgW, imgH)
      const { centerX, centerY, cropW, cropH } = randomCropPos(imgW, imgH, initCrop)

      const game = {
        rid,
        roleName,
        mode,
        imgBuffer: imgBuf,
        imgW,
        imgH,
        centerX,
        centerY,
        cropW,
        cropH,
        hintCount: 0,
        shownBounds: [getCropBound({ rid, roleName, mode, imgBuffer: imgBuf, imgW, imgH, centerX, centerY, cropW, cropH })]
      }
      logger.info(`[猜角色] 成功出题，角色ID:${rid} ${roleName}`)
      return game
    } catch (e) {
      errList.push(`ID${rid}:${e.message}`)
      continue
    }
  }
  // 所有角色都缺少对应模式图片
  const modeName = mode === MODE.AVATAR ? '头像' : '全身立绘'
  throw new Error(`当前模式${modeName}无可用图片资源，图片需以角色标准中文名命名（如钟离.png），缺失示例：${errList.slice(0,5).join(';')}`)
}

// 放大裁剪区域（提示）
function expandCrop(game) {
  const newSize = Math.min(game.imgW, game.imgH, game.cropW * CROP_SCALE)
  const { centerX, centerY, cropW, cropH } = randomCropPos(game.imgW, game.imgH, newSize)
  game.centerX = centerX
  game.cropW = cropW
  game.cropH = cropH
  game.hintCount += 1
  const newBound = getCropBound(game)
  game.shownBounds.push(newBound)
  return newBound.width >= game.imgW && newBound.height >= game.imgH
}

// 根据引用消息获取对局
function getReplyGame(e) {
  cleanExpireGame()
  if (!e.reply_id) return null
  const replyId = String(e.reply_id)
  const game = gameMap.get(replyId)
  if (!game || game.groupId !== String(e.group_id)) return null
  return { game, key: replyId }
}

// 保存对局
function saveGame(msgId, groupId, game) {
  cleanExpireGame()
  const store = {
    ...game,
    groupId: String(groupId),
    expire: Date.now() + GAME_EXPIRE
  }
  gameMap.set(String(msgId), store)
  return true
}

// 删除同一局所有缓存
function clearGameData(targetGame) {
  for (const [mid, g] of gameMap) {
    if (g.rid === targetGame.rid && g.groupId === targetGame.groupId) {
      gameMap.delete(mid)
    }
  }
}

export class GuessRole extends plugin {
  constructor() {
    super({
      name: '猜原神角色',
      dsc: '四种模式猜原神角色，局部图片猜角色，图片文件名为角色中文名',
      event: 'message',
      priority: 4800,
      rule: [
        { reg: '^#猜头像$', fnc: 'startGame', desc: '猜头像模式' },
        { reg: '^#猜角色$', fnc: 'startGame', desc: '普通全身模式' },
        { reg: '^#困难猜角色$', fnc: 'startGame', desc: '黑白困难模式' },
        { reg: '^#地狱猜角色$', fnc: 'startGame', desc: '反色地狱模式' },
        { reg: '^#提示\\s*$', fnc: 'sendHint', log: false },
        { reg: '^(?!#).+$', fnc: 'checkAnswer', log: false }
      ]
    })
  }

  async startGame(e) {
    if (!e.group_id) return e.reply('仅群聊可用')
    let mode
    if (e.msg === '#猜头像') mode = MODE.AVATAR
    else if (e.msg === '#猜角色') mode = MODE.NORMAL
    else if (e.msg === '#困难猜角色') mode = MODE.HARD
    else if (e.msg === '#地狱猜角色') mode = MODE.HELL

    try {
      const game = await createGame(mode)
      const imgBuf = await renderCropImg(game)
      const res = await e.reply(segment.image(imgBuf))
      if (res?.message_id) saveGame(res.message_id, e.group_id, game)
    } catch (err) {
      logger.error('[猜角色] 开局失败', err)
      e.reply(`出题失败：${err.message}`)
    }
  }

  async sendHint(e) {
    const gameData = getReplyGame(e)
    if (!gameData) return e.reply('请引用本局猜图消息再发送#提示')
    const { game, key } = gameData

    const fullShow = expandCrop(game)
    if (fullShow) {
      const fullImg = await renderFullReveal(game)
      await e.reply([
        '全部显示完毕，答案：' + game.roleName,
        segment.image(fullImg)
      ])
      clearGameData(game)
      return
    }
    const newImg = await renderCropImg(game)
    const newMsg = await e.reply(segment.image(newImg))
    if (newMsg?.message_id) {
      gameMap.delete(key)
      saveGame(newMsg.message_id, e.group_id, game)
    }
  }

  async checkAnswer(e) {
    const gameData = getReplyGame(e)
    if (!gameData) return false
    const { game } = gameData
    const match = matchRoleName(e.msg.trim())
    if (!match) return false

    if (match.rid === game.rid) {
      await e.bot.setMsgEmojiLike(e.message_id, RIGHT_REACT)
      const fullImg = await renderFullReveal(game)
      await e.reply([
        segment.at(e.user_id),
        `🎉 答对啦！角色是 ${game.roleName}`,
        segment.image(fullImg)
      ])
      clearGameData(game)
    } else {
      await e.bot.setMsgEmojiLike(e.message_id, WRONG_REACT)
    }
    return true
  }
}