# 开发与验收

[返回首页](../README.md)

## 目录结构

    frontend/       React/Vite 看板、组件、静态 Nginx 镜像
    backend/        Express API、SQLite、迁移、备份、测试
    shared/         前后端共用类型和日期算法
    scripts/        本地启动、文档检查、代理验证和打包
    docs/           部署、使用、配置、维护和验收说明
    .github/        GitHub Actions、Issue/PR 模板
    compose.yaml    默认服务器编排

前后端使用 npm workspaces，共用根目录锁文件。不要把后端密码配置导入前端。

## Windows 本地开发

需要 Node.js 24.14.0 或更新的 24.x：

    Copy-Item .env.example .env
    # 编辑 .env 设置 ADMIN_PASSWORD
    npm ci
    npm run dev

访问 http://127.0.0.1:5173；后端是 http://127.0.0.1:3000。开发数据库独立于生产。

## 自动检查

    npm run check

它执行文档链接检查、前后端 TypeScript 检查、隔离 API 测试和前端生产构建。测试覆盖来源/请求头校验、Cookie 会话、密码哈希、输入校验、增删改、版本冲突、服务端续费、限流、数据隔离、数据库重开、备份和密码重置；日期覆盖月末与闰年。

生产依赖可另行运行 npm audit --omit=dev；结果会随公告变化，不代表永久安全。

## GitHub Actions

.github/workflows/ci.yml 在 push、PR 和手动运行时执行：Ubuntu/Windows 检查、Ubuntu Docker 构建、真实容器健康和 API 冒烟，并保存无敏感数据的源码 ZIP。工作流只申请 contents: read，不使用服务器密钥、不推送镜像、不自动部署。

CI 通过不代表你的域名、证书、服务器网络或手机日历已经验证；必须看实际 Actions 结果并完成服务器验收。

## 打包

    npm run build
    npm run package

打包结果在 outputs/，白名单收集源码和文档，排除 .env、数据库、备份、日志、密钥和依赖目录。

## 服务器验收

- [ ] 两个容器 healthy，/api/health 返回 ok。
- [ ] HTTPS、域名、登录、退出、错误密码提示正常。
- [ ] 未登录不能读取私人记录；新增、编辑、续费、删除符合预期。
- [ ] 刷新和重启后正式记录与管理员密码仍存在。
- [ ] 月末、闰年、到期当天显示正确。
- [ ] 手机布局、键盘操作和日历导入提醒已实测。
- [ ] 备份已存到卷外，并在另一套实例演练恢复。
- [ ] 公网无法直连后端 3000，.env 和数据库不会被静态服务提供。
- [ ] Git 历史中没有初始化密码、令牌或真实用户数据。

## 修改原则

数据库变更必须增加版本化迁移和备份/回退说明；修改续费逻辑必须补充日期测试；新增依赖要说明用途并保留许可证。不要提交占位实现、生产密码或真实数据。
