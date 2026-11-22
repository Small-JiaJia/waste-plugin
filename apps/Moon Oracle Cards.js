/**
 * ============================================================
 * 月谕圣牌 - 占卜插件 (Moon Oracle Cards)
 * ============================================================
 * 插件名称：月谕圣牌
 * 触发指令：占卜 或 #占卜
 * 功能说明：随机抽取一张月谕圣牌，合成牌面与解读图片
 *
 * 核心特性：
 *   ✅ 每日限制 1 次（可配置），基于日期自动重置，不依赖 Redis TTL
 *   ✅ 洗牌动画（约 3 秒延迟），增加仪式感
 *   ✅ 自动读取本地图片（支持 .png / .webp）
 *   ✅ 完整的错误处理，图片缺失不影响文字输出
 *   ✅ 配置化开关和限制次数（YAML 配置）
 *   ✅ 日志精简，仅在启动时输出配置信息
 *
 * 文件依赖：
 *   - 数据文件：./plugins/waste-plugin/data/Moon Oracle Cards.js
 *   - 图片目录：./plugins/waste-plugin/resources/genshin/月谕圣牌/
 *   - 配置文件：./plugins/waste-plugin/data/moonOracleConfig.yaml
 *
 * 作者：小佳佳
 * 版本：2.0 (基于日期重置版)
 * ============================================================
 */

// ===================== 依赖导入 =====================
import fs from 'fs';                          // 文件系统操作
import path from 'node:path';                // 临时渲染文件路径
import { randomUUID } from 'node:crypto';     // 每次渲染使用唯一文件名
import lodash from 'lodash';                 // 工具库，用于随机抽样
import moment from 'moment';                 // 时间处理库，用于日期格式化和计算
import plugin from '../../../lib/plugins/plugin.js'; // Yunzai 插件基类
import { cards } from '../data/Moon Oracle Cards.js'; // 22 张月谕圣牌数据
import YAML from 'yaml';                     // YAML 配置文件解析器
import { segment } from 'oicq';              // 构造图片消息段（显式导入确保可用）
import { pluginName } from '../config/constant.js';
import { reserveDailyCount } from '../model/atomic-daily-limit.js';

// ===================== 路径常量 =====================
const _path = process.cwd();                 // 机器人根目录
const imagePath = `${_path}/plugins/waste-plugin/resources/genshin/月谕圣牌/`; // 图片存放路径
const configPath = `${_path}/plugins/waste-plugin/data/moonOracleConfig.yaml`; // 配置文件路径

// ===================== 默认配置 =====================
const DEFAULT_CONFIG = {
  enable: true,   // 功能总开关：true=启用，false=禁用
  limit: 1        // 每日每人最多占卜次数
};

const ARCANA_NUMERALS = [
  '0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'
];

// ===================== 模块级配置加载 =====================
// 说明：将配置加载放在模块顶层，确保只在插件加载时执行一次，
// 避免每次命令都重复打印日志，使控制台更加清爽。

let config = { ...DEFAULT_CONFIG };  // 运行时配置对象
let configLoaded = false;            // 标记是否已加载配置

/**
 * 加载或创建配置文件，并与默认配置合并
 * 若配置文件不存在，则自动创建；若存在，则解析并覆盖默认值
 * @returns {Object} 最终生效的配置对象
 */
function loadConfig() {
  if (configLoaded) return config; // 已加载则直接返回，避免重复执行

  try {
    // 检查配置文件是否存在，不存在则创建默认配置
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, YAML.stringify(DEFAULT_CONFIG));
      config = { ...DEFAULT_CONFIG };
      logger.info('[月谕圣牌] 配置文件不存在，已自动创建默认配置');
    } else {
      // 读取并解析 YAML 配置
      const configStr = fs.readFileSync(configPath, 'utf8');
      const parsed = YAML.parse(configStr);
      // 合并配置：若 YAML 中缺少某字段，则使用默认值
      config = {
        enable: parsed?.enable ?? DEFAULT_CONFIG.enable,
        limit: Math.max(parseInt(parsed?.limit) || DEFAULT_CONFIG.limit, 1)
      };
    }
    configLoaded = true;

    // 仅在启动时打印一次配置信息，避免重复输出
    logger.info(`[月谕圣牌] 配置加载成功: enable=${config.enable}, limit=${config.limit}`);
    logger.info(`[月谕圣牌] 已加载 ${cards?.length || 0} 张牌`);

  } catch (err) {
    // 配置加载失败时使用默认配置，并记录错误
    logger.error('[月谕圣牌] 配置文件加载失败，使用默认配置:', err);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

// 立即执行配置加载（模块初始化时执行一次）
loadConfig();

// ===================== 插件主类 =====================
export class MoonOracleCards extends plugin {
  constructor() {
    super({
      name: '月谕圣牌',          // 插件名称
      dsc: '月谕圣牌占卜',        // 插件描述
      event: 'message',         // 监听消息事件
      priority: 5000,           // 优先级（数字越小越先响应）
      rule: [
        {
          reg: '^#?占卜$',      // 匹配指令：占卜 或 #占卜
          fnc: 'moonOracle'     // 匹配后执行的方法名
        }
      ]
    });
    // Redis 键前缀，用于区分不同插件，格式：waste:moonOracle:xxx
    this.prefix = 'waste:moonOracle:';
    // 配置已在模块顶层加载，此处无需重复加载
  }

  /**
   * 生成 Redis 存储键
   * 群聊和私聊分开存储，避免互相干扰
   * @returns {string} Redis 键，如 "waste:moonOracle:123456:789" 或 "waste:moonOracle:private:789"
   */
  get key() {
    if (this.e.isGroup) {
      return `${this.prefix}${this.e.group_id}:${this.e.user_id}`;
    } else {
      return `${this.prefix}private:${this.e.user_id}`;
    }
  }

  /**
   * 获取今天的日期字符串（格式：YYYY-MM-DD）
   * 用于与 Redis 中存储的日期进行比较，判断是否为同一天
   * @returns {string} 如 "2026-08-21"
   */
  getToday() {
    return moment().format('YYYY-MM-DD');
  }

  /**
   * 计算当前时间到次日 00:00:00 的剩余秒数（整数）
   * 用于设置 Redis 键的过期时间，作为数据清理的备份机制
   * @returns {number} 剩余秒数，最小为 1 秒
   */
  getSecondsUntilNextDay() {
    const dateTime = 'YYYY-MM-DD 00:00:00';
    const time = moment(Date.now()).add(1, 'days').format(dateTime);
    const seconds = (new Date(time).getTime() - new Date().getTime()) / 1000;
    return Math.max(Math.floor(seconds), 1); // 取整并确保至少 1 秒
  }

  async canAccess() {
    const result = await reserveDailyCount({
      key: this.key,
      date: this.getToday(),
      limit: config.limit,
      expiresIn: this.getSecondsUntilNextDay()
    });
    return result.ok;
  }

  /**
   * 延时工具函数（用于洗牌动画）
   * @param {number} ms 延迟毫秒数
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * ==========================================================
   * 核心占卜方法（由规则触发）
   * ==========================================================
   * 执行流程：
   *   1. 数据有效性检查（确保 cards 加载成功）
   *   2. 功能开关检查（config.enable）
   *   3. 每日次数限制检查（canAccess）
   *   4. 洗牌动画（发送提示 + 延迟 2.8 秒）
   *   5. 随机抽牌（lodash.sample）
   *   6. 合成牌名、解读文字及牌面图片
   *   7. 渲染失败或图片缺失时回退到文字回复
   * 
   * 整个流程包裹在 try-catch 中，任何异常都会捕获并友好提示用户，
   * 不会导致插件崩溃或暴露内部错误信息。
   */
  async moonOracle() {
    try {
      // ----- 1. 数据有效性检查 -----
      if (!cards || !Array.isArray(cards) || cards.length === 0) {
        throw new Error('牌组数据无效或为空，请检查数据文件');
      }

      // ----- 2. 功能开关检查 -----
      if (!config.enable) {
        // 功能禁用时静默返回，不做任何响应
        logger.debug('[月谕圣牌] 功能已禁用');
        return false;
      }

      // ----- 3. 每日次数限制检查 -----
      const canAccess = await this.canAccess();
      if (!canAccess) {
        // 已达上限，回复提示并结束
        return await this.reply('你今天已经抽过啦，明天再来吧~', false, { at: true });
      }

      // ----- 4. 洗牌动画（仪式感） -----
      await this.reply('🔮 月谕圣牌正在感应你的命运，开始洗牌......', false, { at: true });
      await this.sleep(2800); // 等待约 2.8 秒，模拟洗牌过程

      // ----- 5. 随机抽牌 -----
      const card = lodash.sample(cards); // 从 22 张牌中等概率抽取一张
      if (!card) {
        throw new Error('随机抽牌失败（返回空对象）');
      }

      // ----- 6. 合成牌面与解读，渲染失败时回退到原有回复 -----
      const fullName = card.name_full || card.name_cn; // 优先使用全称
      const textReply = `\n✨ 月谕圣牌 · ${fullName}\n「${card.name_cn}」\n\n${card.meaning}`;
      const localPath = path.join(imagePath, card.pic);

      if (fs.existsSync(localPath)) {
        const saveId = `oracle-${randomUUID()}`;
        const renderFile = path.join(
          process.cwd(), 'temp', 'html', pluginName, 'fortune', 'moonOracle', `${saveId}.html`
        );

        try {
          const image = await this.e.runtime?.render(pluginName, 'fortune/moonOracle', {
            card: {
              number: ARCANA_NUMERALS[card.id] || '',
              name_cn: card.name_cn,
              pic: card.pic,
              meaning: card.meaning
            },
            date: moment().format('YYYY.MM.DD'),
            saveId
          }, { retType: 'base64' });

          if (image) {
            await this.reply(image, false, { at: true });
            return true;
          }
        } catch (error) {
          logger.error('[月谕圣牌] 图片渲染失败，回退至原有牌面回复：', error);
        } finally {
          await fs.promises.unlink(renderFile).catch(() => {});
        }

        await this.reply(textReply, false, { at: true });
        await this.reply(segment.image(localPath));
      } else {
        // ----- 7. 牌图缺失时发送原文字解读 -----
        await this.reply(textReply, false, { at: true });

        // 图片缺失：记录错误日志，并提示用户补全图片
        logger.error(`[月谕圣牌] 图片缺失：${localPath}`);
        await this.reply(
          `\n图片文件缺失：${card.pic}\n请将牌面图片放置于：${imagePath}`,
          false,
          { at: true }
        );
      }

      // 成功完成，无需返回额外信息

    } catch (err) {
      // ----- 8. 统一错误捕获处理 -----
      // 记录详细错误信息（包含堆栈），便于开发者调试
      logger.error(`[月谕圣牌] 执行出错 - 类型: ${typeof err}, 内容: ${err}`);
      if (err instanceof Error && err.stack) {
        logger.error(`[月谕圣牌] 堆栈:\n${err.stack}`);
      }
      // 向用户返回友好提示，不暴露内部错误细节
      await this.reply('占卜时出了点小问题，请稍后再试~', false, { at: true });
    }
  }
}
