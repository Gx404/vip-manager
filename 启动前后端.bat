@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24.14 或更新的 24.x 版本。
  pause
  exit /b 1
)
if not exist node_modules\vite\package.json (
  echo 请先在此目录执行 npm ci 安装依赖，具体见 README.md。
  pause
  exit /b 1
)
node scripts/dev.mjs
pause
