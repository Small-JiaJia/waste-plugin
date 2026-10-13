// Gacha/gacha-res.js
// 资源索引：扫描 miao-plugin 的角色/武器数据，建立名字到星级、元素、图片路径的映射

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// miao-plugin 根目录（waste-plugin 和 miao-plugin 同级在 plugins/ 下）
const MIAO_ROOT = path.resolve(__dirname, '../../miao-plugin')
const CHAR_ROOT = path.join(MIAO_ROOT, 'resources/meta-gs/character')
const WEAPON_ROOT = path.join(MIAO_ROOT, 'resources/meta-gs/weapon')

/** miao 的元素键名 → 图片文件名（中文） */
const ELEM_MAP = {
  pyro: '火',
  hydro: '水',
  anemo: '风',
  electro: '雷',
  dendro: '草',
  cryo: '冰',
  geo: '岩'
}

/** 角色映射表：name → { star, elem, img } */
export const charMap = {}
/** 武器映射表：name → { star, type, img } */
export const weaponMap = {}

function buildIndex () {
  // ---- 角色 ----
  if (!fs.existsSync(CHAR_ROOT)) {
    logger.error('[waste-plugin] 找不到 miao-plugin 角色目录：', CHAR_ROOT)
    return
  }
  for (const name of fs.readdirSync(CHAR_ROOT)) {
    const dataPath = path.join(CHAR_ROOT, name, 'data.json')
    if (!fs.existsSync(dataPath)) continue
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    const key = data.name || name
    charMap[key] = {
      star: data.star,
      elem: data.elem,        // 原始键名，如 'electro'
      img: path.join(CHAR_ROOT, name, 'imgs', 'gacha.webp')
    }
  }

  // ---- 武器 ----
  if (!fs.existsSync(WEAPON_ROOT)) {
    logger.error('[waste-plugin] 找不到 miao-plugin 武器目录：', WEAPON_ROOT)
    return
  }
  for (const type of fs.readdirSync(WEAPON_ROOT)) {
    const typeDir = path.join(WEAPON_ROOT, type)
    if (!fs.statSync(typeDir).isDirectory()) continue
    for (const name of fs.readdirSync(typeDir)) {
      const dataPath = path.join(typeDir, name, 'data.json')
      if (!fs.existsSync(dataPath)) continue
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
      const key = data.name || name
      weaponMap[key] = {
        star: data.star,
        type,
        img: path.join(typeDir, name, 'gacha.webp')
      }
    }
  }

  logger.mark(`[waste-plugin] 资源索引完成：角色 ${Object.keys(charMap).length} 个，武器 ${Object.keys(weaponMap).length} 把`)
}

buildIndex()

/** 取图片绝对路径 */
export function getImg (name, isWeapon = false) {
  const entry = isWeapon ? weaponMap[name] : charMap[name]
  return entry ? entry.img : null
}

/** 取星级 */
export function getStar (name, isWeapon = false) {
  const entry = isWeapon ? weaponMap[name] : charMap[name]
  return entry ? entry.star : null
}

/**
 * 取中文元素名（用于模板 {{element}}.png）
 * 武器无元素，返回空字符串
 */
export function getElem (name, isWeapon = false) {
  if (isWeapon) return ''
  const entry = charMap[name]
  if (!entry || !entry.elem) return ''
  return ELEM_MAP[entry.elem] || ''
}