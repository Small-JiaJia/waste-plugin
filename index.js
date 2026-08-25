import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  pluginName,
  pluginApplications
} from "./config/constant.js"

// 获取当前文件所在目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 源目录（本插件资源）和目标目录（miao-plugin 的 stat 目录）
const srcStatDir = path.resolve(__dirname, './resources/stat')
const targetStatDir = path.resolve(__dirname, '../miao-plugin/resources/stat')

// 需要同步的文件列表
const filesToSync = [
  'abyss-team.html',
  'abyss-team.css',
  'hard-team.html',
  'hard-team.css'
]

/**
 * 计算文件的 SHA256 哈希值（hex）
 */
function getFileHash(filePath) {
  const data = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * 同步资源文件：目标不存在或哈希不同则复制覆盖
 */
function syncStatFiles() {
  if (!fs.existsSync(srcStatDir)) {
    logger.warn('[waste-plugin] 源资源目录不存在，跳过同步:', srcStatDir)
    return
  }

  if (!fs.existsSync(targetStatDir)) {
    fs.mkdirSync(targetStatDir, { recursive: true })
    logger.info('[waste-plugin] 创建目标目录:', targetStatDir)
  }

  let synced = false
  for (const file of filesToSync) {
    const srcFile = path.join(srcStatDir, file)
    const targetFile = path.join(targetStatDir, file)

    if (!fs.existsSync(srcFile)) {
      logger.warn(`[waste-plugin] 源文件不存在: ${srcFile}`)
      continue
    }

    if (!fs.existsSync(targetFile)) {
      try {
        fs.copyFileSync(srcFile, targetFile)
        logger.info(`[waste-plugin] 已复制 ${file} 到 ${targetStatDir}`)
        synced = true
        continue
      } catch (err) {
        logger.error(`[waste-plugin] 复制 ${file} 失败:`, err)
        continue
      }
    }

    // 比较哈希
    let srcHash, targetHash
    try {
      srcHash = getFileHash(srcFile)
      targetHash = getFileHash(targetFile)
    } catch (err) {
      logger.error(`[waste-plugin] 计算哈希失败 ${file}:`, err)
      continue
    }

    if (srcHash !== targetHash) {
      try {
        fs.copyFileSync(srcFile, targetFile)
        logger.info(`[waste-plugin] 更新 ${file}（内容已变更）`)
        synced = true
      } catch (err) {
        logger.error(`[waste-plugin] 覆盖 ${file} 失败:`, err)
      }
    } else {
      logger.debug(`[waste-plugin] ${file} 已是最新，跳过`)
    }
  }

  if (synced) {
    logger.info('[waste-plugin] 模板同步完成，部分文件已更新')
  } else {
    logger.info('[waste-plugin] 所有模板文件均为最新，无需同步')
  }
}

// 执行同步
syncStatFiles()

// 加载插件 apps（原有逻辑）
const files = fs.readdirSync(pluginApplications).filter(file => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')

  if (ret[i].status !== 'fulfilled') {
    logger.error(`载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

logger.info('------(ˊ·ω·ˋ)------')
logger.info('waste-plugin载入成功!')
logger.info('仓库地址 https://github.com/Small-JiaJia/waste-plugin.git')
logger.info('Created By 小佳佳')
logger.info('-------------------')

export { apps }