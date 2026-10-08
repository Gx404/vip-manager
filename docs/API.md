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
| GET | /api/notifications/status | 主管理员查看启用状态、脱敏邮箱、时区/时间、测试冷却和最近 5 条结果；不返回授权码 |
| POST | /api/notifications/test | 空 JSON `{}`；只向配置地址发送，返回 `accepted:true` 表示 SMTP 接受；限流每分钟一次（429 + Retry-After），未配置 503，失败或结果不明 502 |
| GET | /api/subscriptions | 返回 items、initialized |
| POST | /api/subscriptions | 以下 action 操作 |
| GET | /api/subscriptions/history | 私人流水；可选 subscriptionId、offset（默认 0）、limit（默认 50，最大 100）；返回 logs、total |
| POST | /api/subscriptions/history/delete | JSON：{ id }；仅删除当前用户已撤销（undoneAt 非空）的流水，返回 { id }；未撤销返回 409 / RENEWAL_NOT_UNDONE，不存在或不属于当前用户返回 404 |
| GET | /api/exchange-rate | 需登录；currency 与 date 查询购买日到人民币历史汇率，不写入订阅 |
| GET | /api/backup | 当前用户全量业务 JSON，带下载响应头，不含密码或会话 |
| POST | /api/backup/preview | { backup }，完整校验并返回计数及 revision，不写入数据 |
| POST | /api/backup/import | { backup, mode, expectedRevision, confirmReplace? }，事务导入 |

`/api/dashboard` 登录后返回完整当前用户记录；未登录且 `PUBLIC_DASHBOARD=true` 时仅返回单管理员的展示字段，`note` 固定为空字符串、`version` 为 0、`canManage=false`，不返回其他用户记录。未开启公开展示时返回 401。所有响应不缓存。`/api/subscriptions` 的读写、`/api/auth/session` 始终需要真实登录态；公开看板不授予写入权限。

订阅操作：

- initialize：将当前用户清单设为已初始化，不删除任何记录。
- create：item 为完整会员记录；id 可留空由服务端生成 UUID。
- update：id、version、完整 item。item.id 必须匹配 id。
- renew：id、version、可选 requestId（UUID，用于重试幂等）。返回 item、renewal、undoUntil；新日期由后端计算，不信任浏览器传来的续费日期。
- undoRenew：id、version、logId。仅在手动续费后 30 秒且当前版本仍等于该流水结果版本时允许；返回恢复后的 item，流水标记 undoneAt 而不是删除。
- delete：id、version。

会员记录字段：id、name、plan、category、amount、currency、purchaseDate、fxRateToCny、fxRateDate、fxRateSource、cycle、customDays、startDate、endDate、reminderDays、autoRenew、note、color、version。

**v5 及以后的 amount 是原币金额，不再是旧 v4 的人民币折算值**，最多两位小数，范围 0–10,000,000。currency 使用 [币种清单](../shared/currency.ts) 中的 30 个代码；fxRateToCny 为每单位原币对应的人民币数（大于 0、不超过 100,000）。外币必须提供完整的购买日期、报价日期、汇率与来源；fxRateDate 不得晚于 purchaseDate。fxRateSource 为 manual 或 frankfurter。省略币种的旧记录按 CNY 处理，人民币汇率只能为 1。日期为 YYYY-MM-DD，1900–2200 年，endDate 必须大于 startDate。006 迁移增加邮件提醒发送去重与失败重试记录，不改变会员账期数据。

兼容旧 v4 请求/备份的 billingAmount、billingCurrency、exchangeRate、exchangeRateDate：以 billingAmount 恢复原币数值，不再次换算旧 amount。混用两套币种字段会拒绝。数据库 original_amount_cents 保存原币整数分，amount_cents 保留旧人民币折算整数分；业务读取使用原币与快照。旧版客户端应随服务端一同更新，不应将新版 amount 当作人民币。

购买日期/汇率与本期账期分离，renew、undoRenew 与自动续期均不改写这些字段。记录续期时把当时的快照复制到流水，以后修改订阅不会改写旧流水。

category：影音娱乐、购物会员、AI 工具、云盘存储、效率办公、生活服务、游戏会员、学习教育、网络服务、其他服务。cycle：monthly、quarterly、yearly、custom。

startDate/endDate 是本期账期边界，不是最早开通时间。autoRenew=true 时，独立后台任务在 APP_TIMEZONE 的 endDate 当天进入下一账期，启动时和每分钟检查一次；停机后直接补齐到包含当天的一期。不依赖 GET 请求，不会实际扣款或确认支付。自动更新原子地递增 version 并写入内部续期审计表；旧表单保存可能返回 409。改 startDate/endDate/cycle/customDays 会重设续费日锚点；只改备注或开关不会丢失原续费日。续费锚点、审计记录仅保存在后端，不通过公开 API 返回。

成功返回 item 或 id；错误返回 error、code。状态码：400 输入错误、401 未登录/凭据错误、403 来源或防跨站校验失败、404 记录不存在、409 版本冲突、413 请求过大、429 登录尝试或并行汇率查询过多、500 服务异常、502 历史汇率服务不可用。

登录限制：SHA-256(IP + ':' + username) 复合桶，每 15 分钟最多 10 次失败/进行中的校验；回环地址窗口降为 30 秒并告警，成功登录清除对应桶。429 携带真实剩余 Retry-After；最多同时执行 2 次密码校验，最多保留 10,000 个活动桶，防止换用户名无限消耗内存/数据库。IP 必须来自受控反代链，不能直接采用客户端伪造的头。正确代理配置仍是必要条件，不能宣称单靠用户名分桶就解决所有 DoS。

## 历史汇率查询

例如 `GET /api/exchange-rate?currency=USD&date=2024-05-03` 返回 currency、requestedDate、rateDate、rate、source。只查询传入的历史日期；遇休市可能返回此前最近报价（最多相差 14 天），拒绝未来报价、无效数值或币对不匹配。未来请求日期返回 400。CNY 返回固定 1，不访问外部服务。

外币请求只向 Frankfurter 发送币种与日期，不发送会员名称、金额、备注或账号。超时为 8 秒，同一键合并并发请求，最多 4 个不同查询在途、256 个缓存条目、缓存 24 小时。失败返回 502 / FX_UNAVAILABLE，不改用实时汇率，不缓存失败；忙碌返回 429 / FX_BUSY 和 Retry-After。获取成功也不写入数据，需显式保存订阅。参考报价不是银行卡实际结算金额。

## JSON 格式与并发恢复

格式：application 为 vip-manager、formatVersion 导出为 2（导入接受 1 和 2）、顶层 currency 为 CNY（报表本位币），另有 exportedAt、subscriptions、renewalLogs。每项保存自身原币金额及完整汇率快照；订阅增加 renewalAnchorDate；流水字段见 [shared/renewals.ts](../shared/renewals.ts)。历史未知金额为 null，不能伪造为 0；删除订阅不删除新流水。旧人民币备份自动补齐 CNY/1，旧 v4 币种字段按上述规则升级。私人接口始终鉴权，公开看板不返回流水/锚点。

preview 返回 revision、subscriptions、logs、existing、newSubscriptions、skippedSubscriptions、newLogs。import 必须提交原 revision 作为 expectedRevision，预览后任何业务变化会返回 409。mode=merge 只插入新 ID；mode=replace 还必须 confirmReplace=true，替换当前用户业务数据，不改变账号。成功返回 importedSubscriptions、importedLogs、skippedSubscriptions。导入后的版本递增，旧表单失效，导入流水不可快捷撤销。

所有文件在写入前完成日期、金额、ID 唯一性、账期锚点、格式版本校验，写入过程事务化。普通请求体 20 KB；仅已鉴权的两个导入端点允许 20 MB，最多 2,000 条订阅和 10,000 条流水。
