// data/gacha-pool.js
// 卡池数据：常驻池列表 + 基础概率参数 + 当期UP读取
// 常驻池来源：flower-plugin 的 gacha.yaml（不随版本变化）
// 当期UP来源：miao-plugin 的 resources/meta-gs/info/pool.js

import { poolDetail } from '../../miao-plugin/resources/meta-gs/info/pool.js'

export { PROB } from '../Gacha/gacha-rules.js'

/**
 * 常驻池候选列表（从 gacha.yaml 完整迁移）
 * 这些角色/武器始终在常驻池中，歪了之后也从这里取
 */
export const POOL = {
  // 常驻五星角色
  role5: [
    '刻晴', '莫娜', '七七', '迪卢克', '琴',
    '提纳里', '迪希雅', '梦见月瑞希'
  ],
  // 常驻四星角色
  role4: [
    '香菱', '辛焱', '迪奥娜', '班尼特', '凝光', '北斗',
    '行秋', '重云', '雷泽', '诺艾尔', '砂糖', '菲谢尔',
    '芭芭拉', '罗莎莉亚', '烟绯', '早柚', '托马', '九条裟罗',
    '五郎', '云堇', '鹿野院平藏', '柯莱', '多莉', '坎蒂丝',
    '莱依拉', '珐露珊', '瑶瑶', '米卡', '卡维', '绮良良',
    '琳妮特', '菲米尼', '夏洛蒂', '夏沃蕾', '嘉明', '赛索斯',
    '卡齐娜', '欧洛伦', '蓝砚', '伊安珊', '伊法', '塔利雅',
    '爱诺', '雅珂达', '叶洛亚', '阿罗夏'
  ],
  // 常驻五星武器
  weapon5: [
    '阿莫斯之弓', '天空之翼', '天空之卷', '天空之脊', '天空之傲',
    '天空之刃', '四风原典', '和璞鸢', '狼的末路', '风鹰剑'
  ],
  // 常驻四星武器
  weapon4: [
    '弓藏', '祭礼弓', '绝弦', '西风猎弓', '昭心', '祭礼残章',
    '流浪乐章', '西风秘典', '西风长枪', '匣里灭辰', '雨裁',
    '祭礼大剑', '钟剑', '西风大剑', '匣里龙吟', '祭礼剑',
    '笛剑', '西风剑'
  ],
  // 三星武器（仅武器池的三星兜底）
  weapon3: [
    '弹弓', '神射手之誓', '鸦羽弓', '翡玉法球', '讨龙英杰谭',
    '魔导绪论', '黑缨枪', '以理服人', '沐浴龙血的剑', '铁影阔剑',
    '飞天御剑', '黎明神剑', '冷刃'
  ]
}

/**
 * 从 miao-plugin 的 poolDetail 中按当前时间匹配当期卡池
 * @param {Date} now 当前时间
 * @returns {object|null} 当期卡池记录，找不到返回 null
 *   { version, half, from, to, char5, char4, weapon5, weapon4 }
 */
export function getCurrentPool (now = new Date()) {
  for (let i = poolDetail.length - 1; i >= 0; i--) {
    const p = poolDetail[i]
    if (now >= new Date(p.from) && now <= new Date(p.to)) return p
  }
  return null
}

/**
 * 获取当期 UP 武器列表
 * @returns {string[]} 当期 UP 五星武器，找不到返回空数组
 */
export function getCurrentUpWeapons () {
  const p = getCurrentPool()
  return p?.weapon5 || []
}
