# 配置说明

[返回首页](../README.md)

根目录 .env.example 是模板。复制为 .env 后编辑；.env 已被 Git 忽略，不要上传。

| 变量 | 默认值 / 示例 | 说明 |
| --- | --- | --- |
| PUBLIC_ORIGIN | https://members.example.com | Compose 必填；实际前端来源，无路径和尾部斜杠 |
| PUBLIC_DASHBOARD | false | true 时匿名展示真实会员名称、套餐、金额、日期等；备注仍需登录，所有写操作仍需登录 |
| ADMIN_USERNAME | admin | 空数据库首次创建的账号；3–60 位字母、数字或 _.- |
| ADMIN_PASSWORD | 无 | Compose 必填；首次建库密码，8–256 字符；建议使用较长且不重复的密码 |
| COOKIE_SECURE | true | 正式 HTTPS 保持 true；仅可信 HTTP 测试设 false |
| APP_TIMEZONE | Asia/Shanghai | 手动续费和自动续期的 IANA 时区；自动记录在到期日 00:00 后首次检查时进入下一期 |
| BIND_ADDRESS | 127.0.0.1 | Compose 宿主机端口绑定地址 |
| HTTP_PORT | 8080 | Compose 前端宿主机端口 |
| HOST | 独立运行 127.0.0.1；容器 0.0.0.0 | API 监听地址 |
| PORT | 3000 | API 内部端口 |
| DATABASE_PATH | backend/data/memberships.sqlite | 独立 Node 模式的 SQLite 路径 |
| TRUST_PROXY | 独立运行 false；Compose true | 是否按可信地址解析完整反代链；不再使用固定跳数 |
| TRUSTED_PROXY_RANGES | loopback,linklocal,uniquelocal | 逗号分隔的可信代理 IP/CIDR，默认适配回环与 Docker 私网；可收紧为实际代理地址/子网，拒绝 /0 |
| EMAIL_NOTIFICATIONS | 留空，默认关闭 | true 开启；false 显式暂停；留空时允许配置向导启用 |
| EMAIL_CONFIG_FILE | Compose: /app/backend/data/email-settings.json | 可选私有 JSON 配置，权限 600；非空环境变量优先；缺失时不启用邮件 |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE | smtp.qq.com / 465 / true | QQ 邮箱使用这组值；强制 TLS，避免授权码明文传输 |
| SMTP_USER | 空 | 完整 QQ 邮箱地址 |
| SMTP_PASSWORD | 空 | QQ SMTP 授权码，不是 QQ 登录密码；推荐通过交互向导写入私有文件，避免进入容器环境 |
| EMAIL_FROM / EMAIL_TO | 跟随 SMTP_USER | 发件和收件地址；个人使用可填同一个 QQ 邮箱 |
| EMAIL_REMINDER_HOUR / EMAIL_REMINDER_MINUTE | 9 / 0 | 按 APP_TIMEZONE，达到这个时间后发送到期窗口内尚未发送的汇总邮件 |

Compose 仅使用 compose.yaml 中列出的变量。容器的 API 端口和数据库路径由 Dockerfile 设置；高级修改需要同步健康检查、代理和数据卷。

默认链路是公网客户端 → Caddy/受控入口 → 回环端口上的 Nginx → Docker 后端。入口必须清理客户端伪造的转发头，Nginx 用 `$proxy_add_x_forwarded_for` 保留入口传来的真实客户端并追加自己的直接来源。Express 从右向左检查，只越过可信代理。不要把所有公网网段加入信任，也不要把后端端口暴露公网。独立运行设置了公网来源却未开启 TRUST_PROXY 时会打印配置告警；识别到回环来源则警告并使用 30 秒短限流窗口，不会自行信任请求头。

初次建库后，修改 .env 的管理员账号/密码不会覆盖已有账号。密码重置见维护文档。环境变量变化后运行 docker compose up -d 重新创建服务，单独 restart 不会应用新的容器环境。

启用步骤见 [使用说明](USAGE.md#到期提醒与日历)。后台每分钟扫描一次，在配置时间之后发送窗口内尚未发送的订阅；同一订阅同一到期日只提交一次，修改提前天数不重复发信。自动或手动更改到期日期后，新的账期可再次提醒。

临时失败按 5、30、120、360 分钟间隔重试，合计最多 5 次，仅在有效提醒窗口内重试。永久验证/拒收错误不重试；进程中断或已知提交结果不明标为“待核实”。SMTP 不是幂等服务，极端网络确认丢失仍可能重复或漏信，不能保证恰好一次送达。登录提醒中心查看状态；“已提交”只代表 SMTP 接受，不等于收件箱已收到。测试邮件每分钟最多一封，冷却写入 SQLite，重启仍有效。

配置向导保存的文件在数据卷中，重建不丢失；修改文件后 `docker compose restart backend` 即可重新读取。若修改 `.env` 则必须 `docker compose up -d` 重建。显式环境值会覆盖私有文件，向导会拒绝有冲突的值；先清空冲突变量再重建。不要运行会打印全部环境配置的命令来排查授权码。

## 前端构建变量

VITE_API_BASE_URL 默认为 /api，在构建时写入浏览器的 API 基址。分域 API 时设置为 https://api.example.com/api，并同步调整 CSP、Cookie 和 HTTPS 入口。

所有 VITE_ 变量都会进入浏览器代码，不能放密码、数据库路径、GitHub Token 或服务器密钥。默认同源 /api 不需要设置前端变量。

## 本地开发覆盖

npm run dev 固定使用前端 127.0.0.1:5173、后端 127.0.0.1:3000、COOKIE_SECURE=false、TRUST_PROXY=false 和 backend/data/development.sqlite。它仍读取 .env 的初始化账号密码和时区，但前端进程不会接收管理员密码。
