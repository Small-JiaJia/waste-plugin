import plugin from '../../../lib/plugins/plugin.js'
import common from "../../../lib/common/common.js";
import fetch from 'node-fetch'
import axios from 'axios'

const URL = 'https://huggingface.co/spaces/tvt/anime-remove-background'  

let zt = 0

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
    if (URL == '') return 
	if (zt == 1) {
		e.reply('当前有任务正在执行..', true, { recallMsg: 10 })
		return
	}
	let image = await this.getImage(e)
	if (!image) return
        const API = 'https://' + URL.split('/')[4] + '-anime-remove-background.hf.space/api/queue/'

            e.reply('正在为图像去背景，请稍候...', true, { recallMsg: 10 })
            zt = 1

        try {
            let img = await axios.get(image, {
                responseType: 'arraybuffer'
            });
            let base64 = Buffer.from(img.data, 'binary')
                .toString('base64');
            let hash = await getHash(e);
			
            let response = await axios.post(
                API + `push/`, {
                'fn_index': 1,
                'data': [
                    'data:image/jpeg;base64,' + base64
                ],
                'action': 'predict',
                'session_hash': hash
            },
            )
            let statushash = response.data.hash
            let res = await axios.post(
                API + 'status/',
                {
                    'hash': statushash
                },
            )
            let status = res.data.status
            while (status != 'COMPLETE') {
                res = await axios.post(
                    API + 'status/',
                    {
                        'hash': statushash
                    },
                )
                status = res.data.status
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
			let msgs = []
			//logger.info(JSON.stringify(res.data, null, 2))
			res.data.data.data[0] = res.data.data.data[0].replace(/^data:image\/png;base64,/, "")
			res.data.data.data[1] = res.data.data.data[1].replace(/^data:image\/png;base64,/, "")
			let buffer0 = Buffer.from(res.data.data.data[0], 'base64') 
            let buffer = Buffer.from(res.data.data.data[1], 'base64')
			
			msgs.push(`====图片去背景处理完成====`)
			msgs.push(segment.image(image))
			msgs.push(`========处理结果========`)
			msgs.push(segment.image(buffer0))
			msgs.push(segment.image(buffer))
            //await e.reply(segment.image(buffer), true)
			await e.reply(await common.makeForwardMsg(e, msgs))
			zt = 0
		} catch(error) {
			e.reply('请求失败', true)
		    zt = 0
            return
		}

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

async function getHash(e) {
    let hash = '';
    let chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 10; i++) {
        hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return hash;
}