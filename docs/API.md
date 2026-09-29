# 后端 API

所有数据接口均在 `/api` 下，使用 JSON。前端默认走同源反向代理；独立分域部署时前端设置 `VITE_API_BASE_URL`，后端 `PUBLIC_ORIGIN` 设为前端来源。

登录态使用后端设置的 HttpOnly Cookie，前端必须 `credentials: "include"`。浏览器不能读取会话 token。所有 POST 同时需要 `Content-Type: application/json` 和 `X-Requested-With: membership-dashboard`；请求 Origin 必须匹配唯一配置来源。没有任何接口会信任旧平台身份请求头。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/health | 健康状态，不返回配置或私人数据 |
| GET | /api/dashboard | 首页快照：items、canManage、publicDashboard；公开模式支持匿名只读 |
| POST | /api/auth/login | JSON：username、password |
| GET | /api/auth/session | 当前用户 |
| POST | /api/auth/logout | JSON：{}，销毁会话 |
| GET | /api/subscriptions | 返回 items、initialized |
| POST | /api/subscriptions | 以下 action 操作 |

`/api/dashboard` 登录后返回完整当前用户记录；未登录且 `PUBLIC_DASHBOARD=true` 时仅返回单管理员的展示字段，`note` 固定为空字符串、`version` 为 0、`canManage=false`，不返回其他用户记录。未开启公开展示时返回 401。所有响应不缓存。`/api/subscriptions` 的读写、`/api/auth/session` 始终需要真实登录态；公开看板不授予写入权限。

订阅操作：

- initialize：将当前用户清单设为已初始化，不删除任何记录。
- create：item 为完整会员记录；id 可留空由服务端生成 UUID。
- update：id、version、完整 item。item.id 必须匹配 id。
- renew：id、version。新日期由后端按照已保存的周期和 APP_TIMEZONE 计算，不信任浏览器传来的续费日期。
- delete：id、version。

会员记录字段：id、name、plan、category、amount、cycle、customDays、startDate、endDate、reminderDays、autoRenew、note、color、version。金额单位为人民币元（最多两位小数），数据库内部保存整数分。日期为 YYYY-MM-DD，1900–2200 年，endDate 必须大于 startDate。

category：影音娱乐、购物会员、AI 工具、云盘存储、效率办公、生活服务、游戏会员、学习教育、网络服务、其他服务。cycle：monthly、quarterly、yearly、custom。

startDate/endDate 是本期账期边界，不是最早开通时间。autoRenew 只是平台续费方式记录，不触发扣款或自动日期滚动；只有显式 renew/update 操作修改日期。

成功返回 item 或 id；错误返回 error、code。状态码：400 输入错误、401 未登录/凭据错误、403 来源或防跨站校验失败、404 记录不存在、409 版本冲突、413 请求过大、429 登录尝试过多、500 服务异常。

登录失败限制：每个后端识别的客户端地址 15 分钟最多 10 次。限制保存在数据库中，重启后仍有效。默认 Compose 下如果外层还有反向代理，地址可能聚合为同一代理地址；这会更保守地限流，不影响数据隔离。
