# 部署说明

[返回首页](../README.md)

## Docker Compose（推荐）

服务器需要 Docker Engine、Docker Compose v2、Git，以及自己的域名和 HTTPS 证书。宿主机不需要安装 Node.js、MySQL 或 Redis。

    docker version
    docker compose version
    git clone https://github.com/Gx404/vip-manager.git
    cd vip-manager
    cp .env.example .env
    chmod 600 .env

编辑 .env：

- PUBLIC_ORIGIN：实际访问来源，例如 https://members.example.com，不要带末尾斜杠。
- ADMIN_USERNAME：3–60 位字母、数字或 _.-。
- ADMIN_PASSWORD：8–256 字符；公网使用建议选择更长且不重复的密码。
- 正式 HTTPS 部署保持 COOKIE_SECURE=true。

不要把 .env、密码、数据库、TLS 私钥或 GitHub Token 上传到仓库。私有仓库下载时使用自己的 SSH 或 Git 凭据，不要把令牌拼在 URL 中。

启动并检查：

    docker compose config --quiet
    docker compose up -d --build --wait --wait-timeout 180
    docker compose ps
    curl --fail http://127.0.0.1:8080/api/health
    docker compose logs --tail=100 backend frontend

健康接口应返回 {"status":"ok"}，两个服务应为 healthy。前端会等待后端健康检查通过再启动，行为参考 Compose 官方说明：https://docs.docker.com/compose/how-tos/startup-order/。慢速服务器可增加等待时间；不要通过删除数据卷解决启动错误。

## 接入域名

在宝塔、1Panel、Nginx 或 Caddy 中，把 HTTPS 域名反向代理到 http://127.0.0.1:8080，代理整个站点（包括 /api/），不要缓存 /api/。实际访问的协议、域名、端口必须和 PUBLIC_ORIGIN 完全一致。

宿主机 Nginx 核心配置：

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 30s;
    }

不要把项目根目录作为静态站点根目录；前端容器已经只提供构建后的静态页面。如果面板代理也在 Docker 容器中，它的 127.0.0.1 指向面板容器而不是宿主机，请使用受控 Docker 网络或面板支持的宿主机地址，不要直接开放后端 3000 端口。

## 没有域名的临时测试

仅用于可信局域网或防火墙限制的访问：

    PUBLIC_ORIGIN=http://192.168.1.10:8080
    COOKIE_SECURE=false
    BIND_ADDRESS=0.0.0.0
    HTTP_PORT=8080

将 IP 换成服务器地址，然后运行 docker compose up -d。HTTP 不加密密码和会员资料，正式运行必须恢复 HTTPS 与 COOKIE_SECURE=true。

## 前后端单独部署

前端构建：

    npm ci
    npm run build

把 frontend/dist/ 部署到静态 Web 服务，未匹配路径回退到 index.html，并将 /api/ 代理到后端。GitHub Pages 只能放静态文件，不能运行 Node.js API 和 SQLite。

后端 Docker 构建：

    docker build -f backend/Dockerfile -t vip-manager-api .

也可在完整源码根目录用 Node.js 24.14+：

    npm ci
    npm run start --workspace @gx404/backend

独立 Node 模式读取根目录 .env，默认 API 为 127.0.0.1:3000，数据库默认在 backend/data/memberships.sqlite。不同域名部署时，前端构建设置 VITE_API_BASE_URL，后端仍将 PUBLIC_ORIGIN 设为前端来源；两边使用 HTTPS，并同步调整 CSP 与 Cookie 策略。

## 多套实例和验收

同一服务器部署测试实例时使用不同 Compose 项目名和端口，例如 docker compose -p vip-test up -d --build；后续命令保持相同 -p，避免误操作正式数据卷。按 [开发与验收清单](DEVELOPMENT.md#服务器验收) 实测登录、持久化、日历和备份。
