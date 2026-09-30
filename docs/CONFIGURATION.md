# 配置说明

[返回首页](../README.md)

根目录 .env.example 是模板。复制为 .env 后编辑；.env 已被 Git 忽略，不要上传。

| 变量 | 默认值 / 示例 | 说明 |
| --- | --- | --- |
| PUBLIC_ORIGIN | https://members.example.com | Compose 必填；实际前端来源，无路径和尾部斜杠 |
| PUBLIC_DASHBOARD | false | true 时匿名展示真实会员名称、套餐、金额、日期等；备注仍需登录，所有写操作仍需登录 |
| ADMIN_USERNAME | admin | 空数据库首次创建的账号；3–60 位字母、数字或 _.- |
| ADMIN_PASSWORD | 无 | Compose 必填；首次建库密码，16–256 字符 |
| COOKIE_SECURE | true | 正式 HTTPS 保持 true；仅可信 HTTP 测试设 false |
| APP_TIMEZONE | Asia/Shanghai | 手动续费和自动续期的 IANA 时区；自动记录在到期日 00:00 后首次检查时进入下一期 |
| BIND_ADDRESS | 127.0.0.1 | Compose 宿主机端口绑定地址 |
| HTTP_PORT | 8080 | Compose 前端宿主机端口 |
| HOST | 独立运行 127.0.0.1；容器 0.0.0.0 | API 监听地址 |
| PORT | 3000 | API 内部端口 |
| DATABASE_PATH | backend/data/memberships.sqlite | 独立 Node 模式的 SQLite 路径 |
| TRUST_PROXY | 独立运行 false；Compose true | 是否信任一层受控反向代理 |

Compose 仅使用 compose.yaml 中列出的变量。容器的 API 端口和数据库路径由 Dockerfile 设置；高级修改需要同步健康检查、代理和数据卷。

初次建库后，修改 .env 的管理员账号/密码不会覆盖已有账号。密码重置见维护文档。环境变量变化后运行 docker compose up -d 重新创建服务，单独 restart 不会应用新的容器环境。

## 前端构建变量

VITE_API_BASE_URL 默认为 /api，在构建时写入浏览器的 API 基址。分域 API 时设置为 https://api.example.com/api，并同步调整 CSP、Cookie 和 HTTPS 入口。

所有 VITE_ 变量都会进入浏览器代码，不能放密码、数据库路径、GitHub Token 或服务器密钥。默认同源 /api 不需要设置前端变量。

## 本地开发覆盖

npm run dev 固定使用前端 127.0.0.1:5173、后端 127.0.0.1:3000、COOKIE_SECURE=false、TRUST_PROXY=false 和 backend/data/development.sqlite。它仍读取 .env 的初始化账号密码和时区，但前端进程不会接收管理员密码。
