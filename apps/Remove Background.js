import plugin from '../../../lib/plugins/plugin.js'
import common from "../../../lib/common/common.js";
import axios from 'axios'

const URL = 'https://huggingface.co/spaces/tvt/anime-remove-background'
const REQUEST_TIMEOUT = 30_000
const PUSH_TIMEOUT = 60_000
const TASK_TIMEOUT = 180_000
const POLL_INTERVAL = 1_000
const ACTIVE_STATUSES = new Set([
    'PENDING', 'QUEUED', 'IN_QUEUE', 'STARTING', 'RUNNING',
    'PROCESSING', 'GENERATING', 'IN_PROGRESS', 'WAITING'
])
const FAILED_STATUSES = new Set([
    'ERROR', 'FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'REJECTED', 'QUEUE_FULL'
])

let isProcessing = false

export class RemoveBackground extends plugin {
    constructor() {
        super({
            /** 功能名称 */
            name: '图像去背景',
            /** 功能描述 */
            dsc: '图像去背景',
            event: 'message',
            /** 优先级，数字越小等级越高 */
            priority: 1010,
            rule: [
                {
                    /** 命令正则匹配 */
                    reg: '^#?(去背景|抠图|扣图)$',
                    /** 执行方法 */
                    fnc: 'AnimeRemoveBackground'
                }
            ]
        })
    }

  async AnimeRemoveBackground(e) {
    if (!URL) return true
    if (isProcessing) {
      await e.reply('当前有任务正在执行，请稍后再试。', true, { recallMsg: 10 })
      return true
    }

    const image = await this.getImage(e)
    if (!image) return true

    // getImage awaits; recheck before acquiring the process-wide lock.
    if (isProcessing) {
      await e.reply('当前有任务正在执行，请稍后再试。', true, { recallMsg: 10 })
      return true
    }
    isProcessing = true

    const API = 'https://' + URL.split('/')[4] + '-anime-remove-background.hf.space/api/queue/'
    const deadline = Date.now() + TASK_TIMEOUT
    let outputMessage
    let failed = false

    try {
      Promise.resolve(e.reply('正在为图像去背景，请稍候...', true, { recallMsg: 10 }))
        .catch(error => logger.warn('[waste-plugin] 发送抠图提示失败：', error))

      const img = await axios.get(image, {
        responseType: 'arraybuffer',
        timeout: requestTimeout(deadline)
      })
      const base64 = Buffer.from(img.data).toString('base64')
      const response = await axios.post(
        API + 'push/',
        {
          fn_index: 1,
          data: ['data:image/jpeg;base64,' + base64],
          action: 'predict',
          session_hash: getHash()
        },
        { timeout: requestTimeout(deadline, PUSH_TIMEOUT) }
      )
      const statusHash = response.data?.hash
      if (!statusHash) throw new Error('抠图服务未返回任务编号')

      const result = await waitForResult(API, statusHash, deadline)
      const outputs = result?.data?.data
      if (!Array.isArray(outputs) || outputs.length < 2 || outputs.slice(0, 2).some(value => typeof value !== 'string')) {
        throw new Error('抠图服务返回的数据格式无效')
      }

      const buffer0 = Buffer.from(outputs[0].replace(/^data:image\/[^;,]+;base64,/i, ''), 'base64')
      const buffer = Buffer.from(outputs[1].replace(/^data:image\/[^;,]+;base64,/i, ''), 'base64')
      const msgs = [
        '====图片去背景处理完成====',
        segment.image(image),
        '========处理结果========',
        segment.image(buffer0),
        segment.image(buffer)
      ]
      outputMessage = await common.makeForwardMsg(e, msgs)
    } catch (error) {
      logger.warn('[waste-plugin] 去背景请求失败：', error)
      failed = true
    } finally {
      isProcessing = false
    }

    if (failed) await e.reply('抠图请求失败或超时，请稍后重试。', true)
    else await e.reply(outputMessage)
    return true
  }

  async getImage(e) {
    let imgUrls = []
	  if (e.source || e.reply_id ) {
        // 优先从回复找图
        let reply
        if (this.e.getReply) {
          reply = await this.e.getReply()
        } else if (this.e.source) {
          if (this.e.group?.getChatHistory)
            reply = (await this.e.group.getChatHistory(this.e.source.seq, 1)).pop()
          else if (this.e.friend?.getChatHistory)
            reply = (await this.e.friend.getChatHistory(this.e.source.time, 1)).pop()
        }
        if (reply?.message) {
          for (let val of reply.message) {
            if (val.type === 'image') {
                imgUrls.push(val.url)
            }
          }
        }
      }
	  else if (e.img) {
        // 一起发的图
        imgUrls.push(...e.img)
      }   
	if (imgUrls.length) {
        return imgUrls[0]
	} else {
		return ''
	}
  }
}

function requestTimeout(deadline, maxTimeout = REQUEST_TIMEOUT) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('抠图任务超时')
  return Math.min(maxTimeout, remaining)
}

async function waitForResult(api, hash, deadline) {
  while (Date.now() < deadline) {
    const response = await axios.post(
      api + 'status/',
      { hash },
      { timeout: requestTimeout(deadline) }
    )
    const status = String(response.data?.status || '').toUpperCase()

    if (status === 'COMPLETE') return response.data
    if (FAILED_STATUSES.has(status)) throw new Error(`抠图任务结束，服务状态：${status}`)
    if (!ACTIVE_STATUSES.has(status)) throw new Error(`抠图服务返回未知状态：${status || '空状态'}`)

    await new Promise(resolve => setTimeout(resolve, Math.min(POLL_INTERVAL, deadline - Date.now())))
  }
  throw new Error('抠图任务超时')
}

function getHash() {
    let hash = '';
    let chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 10; i++) {
        hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return hash;
}
