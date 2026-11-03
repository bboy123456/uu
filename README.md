# 加载页访问统计

一个响应式的持续加载页面，以及带密码保护的本地访问数据后台。

## 启动

需要 Node.js 18 或更高版本。

PowerShell：

```powershell
$env:ADMIN_PASSWORD="请设置一个强密码"
npm run dev
```

Windows 命令提示符（cmd）：

```bat
set ADMIN_PASSWORD=请设置一个强密码
npm run dev
```

- 访问页：`http://127.0.0.1:3000/`
- 管理后台：`http://127.0.0.1:3000/admin`

如未设置 `ADMIN_PASSWORD`，服务器会在每次启动时生成临时密码并打印到终端。

## 部署

### Vercel

1. 将 GitHub 仓库导入 Vercel。
2. 在 Vercel 项目中通过 Marketplace 添加 Upstash Redis，或自行创建 Upstash Redis 数据库。
3. 配置以下环境变量并重新部署：

   - `ADMIN_PASSWORD`：后台登录密码。
   - `SESSION_SECRET`：固定的随机长字符串，用于签名后台登录 Cookie。
   - `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`：通常由 Upstash 集成自动添加。项目也兼容 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`。

如果没有配置 Redis，Vercel 函数无法可靠保存访问记录。本地开发不需要 Redis，数据继续保存在 `.data/visits.json`。

页面使用随机生成的匿名访客 ID 区分设备，并收集浏览器、系统、屏幕尺寸、语言、时区和停留时长。不采集 Canvas、字体、音频等强指纹信息，IP 地址只保存加盐哈希。
