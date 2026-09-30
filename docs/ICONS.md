# 订阅名称与图标

[返回首页](../README.md)

图标随前端一起部署到 `/brands/`，不调用在线图标 API，也不会把你的会员名称发送给第三方。名称匹配会忽略大小写、空格、点号、下划线、加号和短横线，并支持全角字符归一化；以以下别名开头即可识别，例如 `Open AI Plus`、`百度网盘超级会员`、`88VIP 年卡`。其他名称或图标加载失败时显示首字母。

| 服务 | 常用别名 | 图标来源 |
| --- | --- | --- |
| 百度网盘 | 百度网盘、百度云盘、百度云、BaiduNetdisk、BaiduPan | [百度网盘官网原始 88×88 图标](https://nd-static.bdstatic.com/m-static/wp-brand/img/logo-pan.6af52c5e.png) |
| OpenAI / ChatGPT | OpenAI、ChatGPT、GPT、GPT Plus、GPT Pro | [LobeHub OpenAI SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/openai.svg) |
| Claude | Claude、Anthropic | [LobeHub Claude SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/claude-color.svg) |
| DeepSeek | DeepSeek、深度求索 | [LobeHub DeepSeek SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/deepseek-color.svg) |
| Gemini | Gemini、Google Gemini | [LobeHub Gemini SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/gemini-color.svg) |
| 淘宝 / 88VIP | 淘宝、88VIP、Taobao | [Simple Icons Taobao SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/taobao.svg) |
| 网易云音乐 | 网易云音乐、网易云黑胶、网易云、NeteaseMusic、CloudMusic | [Simple Icons NetEase Cloud Music SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/neteasecloudmusic.svg) |
| 哔哩哔哩 | 哔哩哔哩、Bilibili、B站 | [Simple Icons Bilibili SVG](https://github.com/simple-icons/simple-icons/blob/develop/icons/bilibili.svg) |

资源核对日期：2026-09-30。百度网盘使用其官网引用的原始 PNG，其他匹配品牌使用 SVG；不再放大 32×32 favicon，也不把通用百度标志当成网盘标志。统一 44px 图标区域与 36px 图像尺寸，不添加第二层边框或阴影，保留品牌图形原本比例。只根据名称展示品牌标识，不验证服务商账户、订阅真伪或付款状态，也不自动读取第三方网站数据。

## 增加其他图标

1. 核对来源与品牌使用要求，将可信静态 SVG/ICO/PNG 放入 `frontend/public/brands/`。SVG 不得包含脚本、事件处理器或外部资源引用。
2. 在 [shared/brands.ts](../shared/brands.ts) 的列表中添加唯一 key、显示名称、`/brands/文件名` 和名称别名；不要把用户输入当作网络地址请求。
3. 补充 [presentation.test.ts](../backend/tests/presentation.test.ts) 的别名测试；更新本页来源、第三方声明和需要保留的许可证。
4. 运行 `npm run check`，重建前端镜像后核对图标；无需更改数据库或原有记录。

## 使用边界

LobeHub SVG 的 MIT 代码许可证保存在 [LOBE-ICONS-LICENSE.txt](../frontend/public/brands/LOBE-ICONS-LICENSE.txt)；Simple Icons SVG 的 CC0 许可证保存在 [SIMPLE-ICONS-LICENSE.md](../frontend/public/brands/SIMPLE-ICONS-LICENSE.md)。所有品牌名称、商标的权利属于对应权利人，不由本项目重新授权；图标库的代码许可证不授予商标权。不表示合作或背书，再分发或商业使用前应核对适用品牌要求。项目没有开放任意图标地址或上传入口。
