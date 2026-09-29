# 常见问题

[返回首页](../README.md)

## 页面能开但登录失败

先访问 /api/health，预期为 {"status":"ok"}，再检查地址栏与 PUBLIC_ORIGIN 的协议、域名和端口是否完全一致。

| 现象 | 处理 |
| --- | --- |
| 401 | 使用空数据库首次创建的账号密码；需要时走密码重置 |
| HTTP 登录后又掉线 | 临时 HTTP 必须 COOKIE_SECURE=false；正式环境请用 HTTPS |
| 403 ORIGIN_DENIED | 实际访问来源与 PUBLIC_ORIGIN 不一致 |
| 403 CSRF_REJECTED | 前端/代理丢了 X-Requested-With，不能关闭校验 |
| 409 VERSION_CONFLICT | 另一个页面已修改，刷新后再保存 |
| 429 | 失败次数过多，等待至少 15 分钟 |
| 502 | /api/ 未代理到后端或后端未启动 |

页面不再展示示例。默认未登录需要登录查看；希望免登录展示自己的真实会员时，设置 PUBLIC_DASHBOARD=true 并执行 docker compose up -d 重新创建后端。公开展示包含名称、套餐、金额和日期，备注仍需登录。空清单时先检查是否添加过记录、是否连对数据卷，不要删除数据库。

## Docker 不健康或构建失败

    docker compose config --quiet
    docker compose logs --tail=100 backend frontend
    docker compose ps

检查 .env 的密码长度、来源格式、时区、磁盘空间、卷权限和镜像/npm 网络。不要删数据卷重试。Node 原生 SQLite 的 experimental 提示本身不是失败，继续看后续错误。

## 反向代理连不上 127.0.0.1:8080

代理在 Docker 容器时，回环地址指向代理容器。按部署说明接入受控网络或宿主机地址，不要直接公开后端端口。

## Windows npm 被执行策略拦截

    npm.cmd ci
    npm.cmd run dev

如 npm 包装器异常且 Node 为官方默认路径：

    node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" ci
    node scripts/dev.mjs

请使用 Node 24.14+ 的 24.x，不要用 Node 18/20 运行原生 TypeScript 和 SQLite 后端。

## 改密码后仍只能用旧密码

这是初始化保护机制。按维护文档执行密码重置。

## 日历没有更新

.ics 是一次性文件，不会自动同步。更新到期日后删除/更新旧事件，再重新导出；通知是否弹出取决于日历应用和系统权限。

## 重建后看似数据不见

先确认登录状态、Compose 项目名、数据卷和是否误打开了本地开发库。不要继续向空库添加大量数据，也不要删除原卷；优先从正确卷或备份恢复。

反馈时提供提交号、部署方式、版本、复现步骤和脱敏日志，不要上传数据库、真实会员清单、密码、.env、Token 或 Cookie。
