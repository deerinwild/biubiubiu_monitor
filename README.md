# biubiubiu_monitor Render 服务

## Render 设置

仓库结构如果是：

```text
biubiubiu_monitor/
├── package.json
├── server.js
└── README.md
```

Render 新建 Web Service 时填写：

```text
Root Directory：留空
Build Command：npm install
Start Command：npm start
```

## 必填环境变量

```text
ADMIN_TOKEN=你自己设置的后台查看密码
```

## GitHub 长期归档环境变量

为了让 Render 每次收到 APK 上报后立即写入 GitHub，需要再添加：

```text
GITHUB_TOKEN=你的 GitHub fine-grained token 或 classic token
GITHUB_OWNER=deerinwild
GITHUB_REPO=biubiubiu_monitor
GITHUB_BRANCH=main
```

Token 需要对 `deerinwild/biubiubiu_monitor` 仓库具有 Contents 读写权限。

## 数据归档结构

服务会按“APK 上报数据里的日期”写入 GitHub：

```text
archive/counters/YYYY/MM/YYYY-MM-DD.json
archive/summary/YYYY/YYYY-MM.json
```

`counters` 保存当天每个微博UID、每台设备的累计值；`summary` 保存每月按天聚合结果，Dashboard 优先读取 summary。

## 测试

健康检查：

```text
https://你的-render域名/health
```

测试上报：

```bash
curl -X POST https://你的-render域名/api/ping \
  -H "Content-Type: application/json" \
  -d '{"event":"daily_counter_batch","deviceId":"test-device","weiboUid":"1234567890","counters":[{"date":"2026-06-20","danmuSentToday":20,"discussionSentToday":3}]}'
```

查看 JSON：

```text
https://你的-render域名/api/stats?token=你的ADMIN_TOKEN
```

查看可视化面板：

```text
https://你的-render域名/dashboard?token=你的ADMIN_TOKEN
```
