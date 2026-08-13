/**
 * ============================================================
 * 月谕圣牌 - 占卜插件（Miao-Yunzai）
 * ============================================================
 * 功能：用户发送「占卜」或「#占卜」，随机抽取一张月谕圣牌
 * 特色：
 *   - 洗牌动画（仪式感）
 *   - 每日限制（默认 1 次，可配置）
 *   - 本地图片读取（支持 .png / .webp）
 *   - 优雅排版（@用户后换行）
 *   - 配置文件控制启用/禁用和次数
 * ============================================================
 * 数据来源：./plugins/waste-plugin/data/Moon Oracle Cards.js
 * 图片路径：./plugins/waste-plugin/resources/genshin/月谕圣牌/
 * 配置文件：./plugins/waste-plugin/data/moonOracleConfig.yaml
 * ============================================================
 */

// ---------- 导入依赖 ----------
import fs from 'fs';                     // 文件系统，用于读取图片和配置
import lodash from 'lodash';            // 提供 _.sample 随机抽取
import moment from 'moment';            // 时间处理，用于计算次日零点
import plugin from '../../../lib/plugins/plugin.js'; // Yunzai 插件基类
import { cards } from '../data/Moon Oracle Cards.js'; // 牌面数据（22张）
import YAML from 'yaml';                // 解析 YAML 配置文件
import { segment } from 'oicq';         // 构造图片消息（某些环境可能已全局，显式导入更安全）

// ---------- 常量定义 ----------
const _path = process.cwd();                                       // 机器人根目录
const imagePath = `${_path}/plugins/waste-plugin/resources/genshin/月谕圣牌/`; // 牌面图片存放目录
const configPath = `${_path}/plugins/waste-plugin/data/moonOracleConfig.yaml`; // 配置文件路径

// ---------- 默认配置 ----------
const DEFAULT_CONFIG = {
  enable: true,   // 功能总开关（true=启用，false=禁用）
  limit: 1        // 每日每人占卜次数上限
};

let config = { ...DEFAULT_CONFIG };   // 运行时配置对象

// ============================================================
// 插件主类
// ============================================================
export class MoonOracleCards extends plugin {
  constructor() {
    super({
      name: '月谕圣牌',                     // 插件名称
      dsc: '月谕圣牌占卜',                   // 描述
      event: 'message',                     // 监听消息事件
      priority: 5000,                      // 优先级（数字越小越先响应，可根据需要调整）
      rule: [
        {
          reg: '^#?占卜$',                // 触发正则：占卜 或 #占卜
          fnc: 'moonOracle'               // 匹配后执行的方法
        }
      ]
    });
    this.prefix = 'waste:moonOracle:';      // Redis 键前缀，用于区分不同插件
    this.loadConfig();                      // 加载配置文件
    logger.info(`[月谕圣牌] 已加载 ${cards?.length || 0} 张牌`); // 启动时打印牌数，便于确认
  }

  /**
   * 加载 YAML 配置文件
   * 如果文件不存在，则创建默认配置
   * 如果解析失败，使用默认配置并记录错误
   */
  loadConfig() {
    try {
      if (!fs.existsSync(configPath)) {
        // 配置文件不存在，写入默认配置
        fs.writeFileSync(configPath, YAML.stringify(DEFAULT_CONFIG));
        config = { ...DEFAULT_CONFIG };
        return;
      }
      const configStr = fs.readFileSync(configPath, 'utf8');
      const parsed = YAML.parse(configStr);
      // 合并配置，确保必填字段存在，且 limit 至少为 1
      config = {
        enable: parsed?.enable ?? DEFAULT_CONFIG.enable,
        limit: Math.max(parseInt(parsed?.limit) || DEFAULT_CONFIG.limit, 1)
      };
      logger.info(`[月谕圣牌] 配置加载成功: enable=${config.enable}, limit=${config.limit}`);
    } catch (err) {
      logger.error('[月谕圣牌] 配置加载失败，使用默认配置', err);
      config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * 生成 Redis 存储键
   * 群聊与私聊分开，避免不同场景互相影响
   * 格式：waste:moonOracle:[群号/private]:[用户QQ]
   */
  get key() {
    if (this.e.isGroup) {
      return `${this.prefix}${this.e.group_id}:${this.e.user_id}`;
    } else {
      return `${this.prefix}private:${this.e.user_id}`;
    }
  }

  /**
   * 计算到次日 00:00:00 的剩余秒数（整数）
   * 用于设置 Redis 键的过期时间，确保每日重置计数
   * @returns {number} 剩余秒数（至少为 1）
   */
  getSecondsUntilNextDay() {
    const dateTime = 'YYYY-MM-DD 00:00:00';
    const time = moment(Date.now()).add(1, 'days').format(dateTime);
    const seconds = (new Date(time).getTime() - new Date().getTime()) / 1000;
    // 取整，并保证至少为 1 秒（避免 Redis 报错）
    return Math.max(Math.floor(seconds), 1);
  }

  /**
   * 检查当前用户是否可以访问（每日次数限制）
   * 逻辑：
   *   - 如果 Redis 中没有记录，说明今天第一次，设置计数为1，过期时间为次日零点
   *   - 如果已存在且小于 limit，则允许访问，并增加计数
   *   - 如果已存在且 >= limit，则拒绝访问
   * @returns {Promise<boolean>} true=可访问，false=已达上限
   */
  async canAccess() {
    const counter = await redis.get(this.key);
    if (counter === null) {
      // 第一次访问：设置计数为 1，并设置过期时间到次日 00:00:00
      const remainingSeconds = this.getSecondsUntilNextDay();
      await redis.set(this.key, '1', 'EX', remainingSeconds);
      return true;
    }
    if (parseInt(counter) >= config.limit) {
      return false; // 已达上限
    }
    // 未达上限，计数 +1
    await redis.incr(this.key);
    return true;
  }

  /**
   * 工具函数：延时（用于洗牌动画）
   * @param {number} ms 毫秒
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 核心占卜方法（由 rule 触发）
   * 流程：
   *   1. 检查数据有效性
   *   2. 检查功能是否启用
   *   3. 检查每日次数限制
   *   4. 发送洗牌提示（保留不撤回，无错误日志）
   *   5. 延时模拟洗牌过程
   *   6. 随机抽取一张牌
   *   7. 发送文字解读（@用户后换行）
   *   8. 发送本地图片（若存在），否则提示缺失
   *   9. 异常捕获并记录
   */
  async moonOracle() {
    try {
      // ---------- 前置检查 ----------
      // 确保牌组数据有效
      if (!cards || !Array.isArray(cards) || cards.length === 0) {
        throw new Error('牌组数据无效或为空');
      }

      // 检查功能开关
      if (!config.enable) {
        logger.debug('[月谕圣牌] 功能已禁用');
        return false;
      }

      // 检查每日次数
      const canAccess = await this.canAccess();
      if (!canAccess) {
        return await this.reply('你今天已经抽过啦，明天再来吧~', false, { at: true });
      }

      // ---------- 洗牌动画 ----------
      // 发送洗牌提示（不撤回，避免产生错误日志）
      await this.reply('🔮 月谕圣牌正在感应你的命运，开始洗牌......', false, { at: true });
      await this.sleep(2800); // 等待约 2.8 秒，模拟洗牌过程

      // ---------- 抽牌 ----------
      const card = lodash.sample(cards);
      if (!card) {
        throw new Error('随机抽牌失败（返回空）');
      }

      // ---------- 发送结果 ----------
      // 文字部分：内容前加 \n，使 @用户 之后空一行，排版更美观
      const fullName = card.name_full || card.name_cn;
      await this.reply(
        `\n✨ 月谕圣牌 · ${fullName}\n「${card.name_cn}」\n\n${card.meaning}`,
        false,
        { at: true }
      );

      // ---------- 发送图片 ----------
      const localPath = imagePath + card.pic;
      if (fs.existsSync(localPath)) {
        const pic = segment.image(localPath);
        await this.reply(pic);
      } else {
        // 图片缺失：记录错误并提示用户，同样加上换行
        logger.error(`[月谕圣牌] 图片缺失：${localPath}`);
        await this.reply(
          `\n图片文件缺失：${card.pic}\n请将牌面图片放置于：${imagePath}`,
          false,
          { at: true }
        );
      }

    } catch (err) {
      // ---------- 统一错误处理 ----------
      // 记录详细错误信息（包括堆栈）
      logger.error(`[月谕圣牌] 执行出错 - 类型: ${typeof err}, 内容: ${err}`);
      if (err instanceof Error && err.stack) {
        logger.error(`[月谕圣牌] 堆栈:\n${err.stack}`);
      }
      // 友好提示用户
      await this.reply('占卜时出了点小问题，请稍后再试~', false, { at: true });
    }
  }
}