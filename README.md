# waste-plugin

### 介绍
- Miao-Yunzai的个人自用向小型插件，收集一些自用的小玩具。

- yoimiya-kokomi，其实我一直是你的粉丝，从Miao-Yunzai诞生开始，我就已经被你吸引深深吸引~

安装
推荐使用git进行安装，以方便后续升级。在BOT根目录夹打开终端，运行

// 使用github
```
git clone --depth=1 https://github.com/Small-JiaJia/waste-plugin.git plugins/waste-plugin.git
pnpm install -P
```
### 功能一览列表

|指令|说明|
|-----|-----|
|1+1|=2|
|#抽签/#求签/#御神签|模仿鸣神大社抽签|
|#6.6深渊/#6.6剧诗/#6.6幽境 |原神各版本三路模式资源，保留玉衡杯风格|
|#占卜 |模仿月谕圣牌占卜|
|#深渊配队 |深境螺旋 · 出场配队建议，保留原版 miao 风格渲染|
|#幽境配队/#危战配队 |幽境危战 · 出场配队建议，保留原版 miao 风格渲染|

### 注意
waste-plugin加载插件时，为了实现配队相关功能，检查 miao-plugin 的 stat 目录下是否存在，不存在则直接复制；存在则计算哈希，不一致则覆盖，介意勿安装本插件
必需：miao-plugin（原版！！！fork？俺不知道~不懂的，就问Ai吧）

### 更新插件
没有内置更新功能，更新请手动拉取本项目

### 致谢
| 贡献 | 项目 |
| :--- | :--- |
| constant.js和index.js代码 | 来自[TianRu-plugin](https://gitee.com/HDTianRu/TianRu-plugin)| 
| 计算器| 来自[suiyue](https://gitee.com/Acceleratorsky/suiyue)| 
| #求签| 来自[l-plugin](https://github.com/liuly0322/l-plugin)| 
| abyssVersion.js | 来自[mora-plugin](https://gitcode.com/jiuyixian/mora-plugin)| 
| 原神各版本三路模式资源 | 来自[B站妮可少女HomDGCat](https://space.bilibili.com/3537104994831140)| 
| 深境螺旋配队和幽境危战配队 | 来自[xhh-TL](https://github.com/cchanlan/xhh-TL/tree/master)| 

### Ciallo～(∠・ω< )⌒☆
* 如果你觉得本插件还行，不妨请留下一个免费的star吧，你的支持是我们前进的最大动力
* 有新的想法可以在issue中提出来改进这个插件
* 严禁用于任何商业用途和非法行为