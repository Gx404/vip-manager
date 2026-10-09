# 订阅名称与图标

[返回首页](../README.md)

图标随前端一起部署到 `/brands/`，不调用在线图标 API，也不会把你的会员名称发送给第三方。名称匹配会忽略大小写、空格、点号、下划线、加号和短横线，并支持全角字符归一化；以以下别名开头即可识别，例如 `Open AI Plus`、`百度网盘超级会员`、`88VIP 年卡`。其他名称或图标加载失败时显示首字母。

| 服务 | 常用别名 | 图标来源 |
| --- | --- | --- |
| 百度网盘 | 百度网盘、百度云盘、百度云、BaiduNetdisk、BaiduPan | [百度网盘官网原始 88×88 图标](https://nd-static.bdstatic.com/m-static/wp-brand/img/logo-pan.6af52c5e.png) |
| OpenAI / ChatGPT | OpenAI、ChatGPT、GPT、GPT Plus、GPT Pro | [Homarr 绿色 ChatGPT SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/chatgpt.svg) |
| Claude | Claude、Anthropic | [LobeHub Claude SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/claude-color.svg) |
| DeepSeek | DeepSeek、深度求索 | [LobeHub DeepSeek SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/deepseek-color.svg) |
| Gemini | Gemini、Google Gemini | [LobeHub Gemini SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/gemini-color.svg) |
| 淘宝 / 88VIP | 淘宝、88VIP、Taobao | [Simple Icons Taobao SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/taobao.svg) |
| 网易云音乐 | 网易云音乐、网易云黑胶、网易云、NeteaseMusic、CloudMusic | [Simple Icons NetEase Cloud Music SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/neteasecloudmusic.svg) |
| 哔哩哔哩 | 哔哩哔哩、Bilibili、B站 | [Simple Icons Bilibili SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/bilibili.svg) |
| iCloud | iCloud、iCloud+、苹果云盘 | [Simple Icons iCloud SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/icloud.svg)，本地填色 #4f8ee8 |

## 扩展品牌（2026-10-07）

现共支持 61 类品牌（2026-10-09 更新）。匹配时优先选择最长别名，因此 `YouTube Music` 不会被较短的 `YouTube` 抢先匹配，`GitHub Copilot` 也不会匹配成 GitHub。仅识别名称前缀，不在浏览器中自动搜索图片。

| 服务 | 常用别名 | 固定版本来源 |
| --- | --- | --- |
| 醒图 | 醒图、Xingtu | [官网引用的原始 PNG](https://lf-cdn-tos.bytescm.com/obj/static/ies/retouch/website/public/favicon.ico)，原 URL 虽为 ico 后缀，内容实际为 450×450 PNG |
| DMIT | DMIT | [官方文档站 SVG](https://docs.dmit.io/dmit_logo_2022.svg)，仅移除 XML/DOCTYPE 声明；内部图片为内嵌 PNG，无外部请求 |
| Netflix | netflix、奈飞、网飞 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/netflix.svg) |
| Spotify | spotify、声田 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/spotify.svg) |
| YouTube | youtube、油管 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/youtube.svg) |
| YouTube Music | youtubemusic、油管音乐 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/youtubemusic.svg) |
| Apple Music | applemusic、苹果音乐 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/applemusic.svg) |
| Apple TV+ | appletv、苹果tv | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/appletv.svg) |
| Google Drive | googledrive、谷歌云盘、谷歌网盘 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/googledrive.svg) |
| Google One | googleone、谷歌one | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/google-one.svg) |
| Dropbox | dropbox | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/dropbox.svg) |
| OneDrive | onedrive、微软云盘、微软网盘、microsoftonedrive | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/microsoft-onedrive.svg) |
| Microsoft 365 | microsoft365、office365、m365、微软365、微软office | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/microsoft-365.svg) |
| Notion | notion | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/notion.svg) |
| Adobe | adobe、photoshop、lightroom、creativecloud | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/adobe-color.svg) |
| Figma | figma | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/figma-color.svg) |
| Duolingo | duolingo、多邻国 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/duolingo.svg) |
| Cursor | cursor | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/cursor.svg) |
| Perplexity | perplexity、pplx | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/perplexity-color.svg) |
| Kimi | kimi、月之暗面 | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/kimi-color.svg) |
| 千问 | qwen、通义千问、千问 | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/qwen-color.svg) |
| 豆包 | doubao、豆包 | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/doubao-color.svg) |
| Grok | grok、supergrok、xai | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/grok.svg) |
| Midjourney | midjourney | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/midjourney.svg) |
| MiniMax | minimax、海螺ai、海螺视频 | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/minimax-color.svg) |
| Trae | trae | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/trae-color.svg) |
| Manus | manus | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/manus.svg) |
| 阿里云 | 阿里云、aliyun、alibabacloud、alicloud | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/alibabacloud-color.svg) |
| 腾讯云 | 腾讯云、tencentcloud | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/tencentcloud-color.svg) |
| PlayStation Plus | playstation、psplus、psn、索尼会员 | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/playstation.svg) |
| Xbox Game Pass | xbox、xgp、xgpu、gamepass | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/xbox-game-pass.svg) |
| Nintendo Switch Online | nintendo、任天堂、switchonline、switch会员 | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/nintendo-switch.svg) |
| NordVPN | nordvpn | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/nordvpn.svg) |
| Surfshark | surfshark | [Simple Icons SVG](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/surfshark.svg) |

## 新增品牌（2026-10-09）

| 服务 | 常用别名 | 固定版本来源 |
| --- | --- | --- |
| YUNYOO | yunyoo、云悠 | [官网原始 120×120 ICO](https://yunyoo.cc/favicon.ico) |
| ISVORO | isvoro | [官网 SVG](https://isvoro.com/favicon.svg) |
| 京东 / PLUS | 京东、JD Plus、JD.com、Jingdong | [京东官网 manifest](https://www.jd.com/manifest.json) 引用的 [192×192 原始 PNG](https://img12.360buyimg.com/img/jfs/t1/401590/21/4038/26890/69aab4aeFa478e02e/02760c00c0a358ab.png) |
| 盒马 | 盒马、Hema、Freshippo | [盒马官网图标](https://www.freshippo.com/favicon.ico)，原 URL 为 ico 后缀，实际为 265×265 PNG |
| Steam | steam、蒸汽平台 | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/steam.svg) |
| Vultr | vultr | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/vultr.svg) |
| DigitalOcean | digitalocean | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/digital-ocean.svg) |
| Cloudflare | cloudflare | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/cloudflare.svg) |
| GitHub | github | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/github.svg) |
| GitHub Copilot | githubcopilot | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/github-copilot.svg) |
| Bitwarden | bitwarden | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/bitwarden.svg) |
| 1Password | 1password | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/1password.svg) |
| QQ 会员 | QQ会员、QQ超级会员、QQVIP、QQSVIP | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/qq.svg)，收紧 viewBox 去掉过多留白，保留路径与颜色；不把 QQ 音乐误识别成 QQ 会员 |
| Slack | slack | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/slack.svg) |
| Zoom | zoom | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/zoom.svg) |
| Linear | linear | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/linear.svg) |
| Tailscale | tailscale | [Homarr SVG](https://github.com/homarr-labs/dashboard-icons/blob/adca944175c9a3eb0471f78a4da87f237476d585/svg/tailscale.svg) |
| CapCut / 剪映 | capcut、剪映 | [LobeHub SVG](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/packages/static-svg/icons/capcut.svg) |

Simple Icons 图标按该库品牌色设置 SVG 根节点 fill，淘宝为 #E94F20、网易云音乐为 #D43C33、哔哩哔哩为 #00A1D6，修复未填色导致的默认黑色。OpenAI / ChatGPT 改用绿色 ChatGPT 图标。Cursor、Grok、Notion 等原本为单色的标志保留原配色，不随意染色。Kimi 的字形填色从白色改为 #161616 以适配浅色背景，保留原路径与蓝色圆点；除 QQ 上述视窗调整外，其余 LobeHub 与 Homarr SVG 图形未修改。Homarr 图标源自 `adca944175c9a3eb0471f78a4da87f237476d585`，Apache-2.0 许可证与原版权声明保留在 [HOMARR-ICONS-LICENSE.txt](../frontend/public/brands/HOMARR-ICONS-LICENSE.txt)。图标只是识别标记，不能据此确认订阅或付款状态。

资源核对日期：2026-10-09。百度网盘、醒图、京东、盒马保留官网原始 PNG，YUNYOO 使用官网 120×120 ICO，其他匹配品牌使用本地 SVG；不放大 32×32 favicon。统一 44px 图标区域与 36px 图像尺寸，不添加第二层边框或阴影，保留品牌图形原本比例。没有适配的名称继续显示首字，不会猜测或抓取不明来源图片。

## 增加其他图标

1. 核对来源与品牌使用要求，将可信静态 SVG/ICO/PNG 放入 `frontend/public/brands/`。SVG 不得包含脚本、事件处理器或外部资源引用。
2. 在 [shared/brands.ts](../shared/brands.ts) 的列表中添加唯一 key、显示名称、`/brands/文件名` 和名称别名；不要把用户输入当作网络地址请求。
3. 补充 [presentation.test.ts](../backend/tests/presentation.test.ts) 的别名测试；更新本页来源、第三方声明和需要保留的许可证。
4. 运行 `npm run check`，重建前端镜像后核对图标；无需更改数据库或原有记录。

## 使用边界

LobeHub SVG 的 MIT 代码许可证保存在 [LOBE-ICONS-LICENSE.txt](../frontend/public/brands/LOBE-ICONS-LICENSE.txt)；Simple Icons SVG 的 CC0 许可证保存在 [SIMPLE-ICONS-LICENSE.md](../frontend/public/brands/SIMPLE-ICONS-LICENSE.md)。所有品牌名称、商标的权利属于对应权利人，不由本项目重新授权；图标库的代码许可证不授予商标权。不表示合作或背书，再分发或商业使用前应核对适用品牌要求。项目没有开放任意图标地址或上传入口。
