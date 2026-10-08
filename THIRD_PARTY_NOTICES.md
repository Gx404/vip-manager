# 第三方组件声明

本项目使用 React、Vite、TypeScript、Express、Zod、Radix UI、Lucide、Tailwind CSS、Sonner 等第三方组件。具体依赖和锁定版本以各工作区的 package.json 与根目录 package-lock.json 为准；各组件适用其自身许可证。

后端邮件传输使用 [Nodemailer](https://nodemailer.com/smtp)，锁定版本 10.0.16，MIT-0 许可；依赖包内保留原许可证。仅使用 SMTP，不依赖其商业服务。

随附的 shadcn Tailwind 样式位于 frontend/src/vendor/shadcn-tailwind-4.13.0.css，对应许可证保留在同目录许可文件。

页面参考通用监控看板的卡片布局，没有要求安装或连接 Komari 服务。用户录入的服务名称只用于识别和管理订阅，不表示与对应服务商有关联、获其授权或代表当前售价。

新增的 OpenAI、Claude、DeepSeek、Gemini SVG 来自 [LobeHub lobe-icons](https://github.com/lobehub/lobe-icons)，原 MIT 许可证保留在 [LOBE-ICONS-LICENSE.txt](frontend/public/brands/LOBE-ICONS-LICENSE.txt)。淘宝、网易云音乐、哔哩哔哩、iCloud SVG 来自 [Simple Icons](https://simpleicons.org/)，其 CC0 许可证保留在 [SIMPLE-ICONS-LICENSE.md](frontend/public/brands/SIMPLE-ICONS-LICENSE.md)。百度网盘 PNG 来自[其官网原始静态资源](https://nd-static.bdstatic.com/m-static/wp-brand/img/logo-pan.6af52c5e.png)。品牌素材及商标权不由本项目重新授权，也不因图标库的代码许可而获得商标授权。来源及品牌使用边界见 [图标说明](docs/ICONS.md)。

2026-10-07 扩展图标继续采用上述 LobeHub、Simple Icons 本地资源，固定来源版本及填色修改见 [图标说明](docs/ICONS.md)。Google One、Microsoft 365、OneDrive、Xbox Game Pass、Nintendo Switch 来自 [Homarr Dashboard Icons](https://github.com/homarr-labs/dashboard-icons/tree/adca944175c9a3eb0471f78a4da87f237476d585)，保留 [Apache-2.0 许可证及原版权声明](frontend/public/brands/HOMARR-ICONS-LICENSE.txt)，图形未修改。醒图 PNG 来自[官网引用资源](https://lf-cdn-tos.bytescm.com/obj/static/ies/retouch/website/public/favicon.ico)，DMIT SVG 来自[官方文档站](https://docs.dmit.io/dmit_logo_2022.svg)，后者仅移除 XML/DOCTYPE 声明。这些品牌素材仅用于标识用户自行录入的服务；商标、品牌使用权仍归原权利人，均不代表合作或背书。

本文不替代各依赖的许可证，也不为本项目自身指定开源许可证。再分发时应保留适用的第三方声明。
