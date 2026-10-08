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

## 数据库 v6 升级与回退

当前数据库版本是 6。v1 先通过 002 增加续费锚点和 automatic_renewal_events；v2 再通过 003 增加 subscription_renewal_logs。004 保留早期已部署的 billing_amount_cents 等多币种字段布局；005 增加原币金额、独立购买日期与汇率快照，并为新流水增加快照字段；006 增加邮件提醒去重与失败记录。各迁移只执行一次，原订阅、账号和密码哈希保留。

从 v4 升级会保留已存原币金额与汇率，不用当天报价重算；旧 amount_cents 仍是人民币整数分，新 original_amount_cents 为原币整数分。没有独立购买日期的旧记录暂用开始日/旧报价日中较晚者，升级后可按实际账单修正。旧流水原本只有人民币金额的继续按人民币保存；更早自动审计无历史金额的标记未知，不猜测原币或制造历史账单。升级前备份应包含当前 v4 数据，而不是更早版本的旧备份。

**升级后，原先已开启自动续费且已到期的记录会在启动检查中补齐到当前账期**；不代表平台扣款成功。已停订或扣款失败的会员，请先关闭自动续费，再升级。先用在线备份保存升级前数据库，并保留旧镜像，不要仅备份最新 JSON 作为旧版本回退依据。

任务在后端启动时及每分钟执行一次；按 APP_TIMEZONE 的到期日判断，不会在本期尚未结束时提前覆盖日期。订阅更新和流水写入在同一事务，失败一起回滚。新流水保存前后账期、当时配置金额、补齐期数和时间；删除订阅仍保留新流水，但旧 automatic_renewal_events 表继续保持原有级联删除规则。可撤销的手动续费仅限 30 秒内且没有后续修改，撤销会留下标记。

回退到旧版必须使用**升级前的数据库备份和旧版镜像**在新实例恢复、核对后切换代理；v5 及更早程序不能直接读取版本 6 数据库。只回退源码不能还原已经顺延的日期或数据结构。恢复到新版实例时，符合自动续期条件的记录也会立即补齐，验收应按此规则核对。

## 邮件配置与发送记录

运行 `docker compose exec backend node backend/scripts/configure-email.ts` 私密输入 QQ 邮箱和新授权码，测试提交成功才保存，之后重启后端。详细规则见 [使用说明](USAGE.md#到期提醒与日历)。

SQLite 在线备份包含发送去重、失败记录和测试冷却；不包含独立的 `email-settings.json`。完整迁移时应另行安全保存该文件及可选的 `.previous` 备份，文件权限 600，不上传 GitHub。网页 JSON 备份不包含邮件设置与发送记录；在同一库导入保留已有发送记录，在新库导入可能重新提醒。恢复演练始终设置 `EMAIL_NOTIFICATIONS=false`，防止测试实例向真实邮箱发信。停止使用的旧实例同样应关闭邮件，不能让两个独立数据库同时扫描。

查看提醒中心的最近发送记录；失败可见脱敏原因，不能用日志回显授权码。重置为“待发送”前必须人工核实未收到邮件；程序不自动重发“待核实”记录。暂停时在 `.env` 设置 `EMAIL_NOTIFICATIONS=false` 并执行 `docker compose up -d backend`。重启、暂停及退出登录都不会清空已提交记录。

备份目录设为 700、备份文件设为 600；不要在执行 git pull 或构建源码时一直使用 umask 077，否则容器内非 root 用户可能无法读取源码。

## 忘记管理员密码

网页业务迁移也可使用“备份”中的 JSON 导出/导入，流程见 [使用说明](USAGE.md)。它不包含密码、会话或配置，不能替代包含账号状态的 SQLite 备份；覆盖恢复前务必另存现有文件。

修改 .env 不会重置已有数据库。新密码支持 8–256 字符，建议使用较长且不重复的密码；密码哈希、登录限流和会话保护不变。用 Bash 隐藏输入并通过标准输入重置：

    read -r -s -p 'New password (8-256 characters): ' vip_new_password
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
