# 备份、更新与维护

[返回首页](../README.md)

## 数据位置

Docker 数据在命名卷 membership_data 的 /app/backend/data；本地开发数据在 backend/data/development.sqlite；独立 Node 生产默认在 backend/data/memberships.sqlite。不同 Compose 项目名对应不同卷。

正常 docker compose down 不删除卷。不要执行 docker compose down -v。SQLite 开启 WAL，不要只复制正在使用的单个 .sqlite 文件。

## 备份

    mkdir -p backups
    chmod 700 backups
    docker compose exec -T backend node backend/scripts/backup.ts

命令输出容器内备份路径后复制到宿主机。将输出的容器路径替换到下面的 backend:路径位置：

    docker compose cp backend:输出的容器备份路径 ./backups/
    chmod 600 backups/*.sqlite

脚本使用 SQLite 在线备份 API，不覆盖已有备份。另存到卷外或其他机器；备份包含会员资料、密码哈希和会话信息，不能上传到公开位置。

独立 Node 模式可运行 node --env-file=.env backend/scripts/backup.ts。开发库备份前先明确设置 DATABASE_PATH，不要误操作生产库。

## 更新

先备份，再快进更新并重建：

    git status --short
    git rev-parse HEAD
    git pull --ff-only
    docker compose up -d --build --wait --wait-timeout 180
    docker compose ps
    curl --fail http://127.0.0.1:8080/api/health

有本地修改时不要强制覆盖。更新后实际登录、读取旧数据、新增测试记录；仅镜像构建成功不代表应用健康。生产回退应使用旧版本源码和升级前备份在新实例验证，不要用 git reset --hard 或删除数据卷解决。

## 忘记管理员密码

修改 .env 不会重置已有数据库。用 Bash 隐藏输入并通过标准输入重置：

    read -r -s -p 'New password (16+ characters): ' vip_new_password
    printf '\n'
    printf '%s' "$vip_new_password" | docker compose exec -T backend node backend/scripts/reset-password.ts
    unset vip_new_password

成功后所有旧会话失效。恢复实例或非默认项目名请在命令中保留相同的 -p。脚本不修改用户名；当前项目只有一个管理员。

## 日志与重启

    docker compose logs --tail=100 backend frontend
    docker compose restart backend frontend
    docker compose ps

改环境配置请用 docker compose up -d 重建受影响服务。分享日志前先脱敏，不要贴 .env、Cookie、密码或完整数据库。

## 恢复演练

优先恢复到新的 Compose 项目和新端口，不覆盖正在运行的正式卷。以下示例使用项目名 vip-restore、端口 8081；执行前确认这个项目名尚未使用。备份请来自本应用，并先复制为 backups/restore.sqlite。

    HTTP_PORT=8081 docker compose -p vip-restore create backend
    docker compose -p vip-restore cp ./backups/restore.sqlite backend:/app/backend/data/memberships.sqlite
    docker compose -p vip-restore run --rm --no-deps --user root backend chown -R node:node /app/backend/data
    PUBLIC_ORIGIN=http://127.0.0.1:8081 COOKIE_SECURE=false HTTP_PORT=8081 docker compose -p vip-restore up -d --build --wait --wait-timeout 180
    curl --fail http://127.0.0.1:8081/api/health

远程服务器可通过 SSH 本地端口转发访问回环地址。恢复后使用备份内原账号密码，不是新 .env 的初始化密码。检查记录、金额和日期；按本页重置密码流程撤销备份内旧会话（命令加 -p vip-restore）。

确认恢复正常后才配置正式域名/HTTPS 来源，并切换外层反向代理到对应端口。后续操作始终保持项目名、端口和来源配置一致。保留原卷与原备份以便回退。任何命令失败都应停止检查日志，不要继续覆盖或删除原卷。
