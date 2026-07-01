# biubiubiu_monitor 409 修复版

修复内容：

1. GitHub PUT 409 sha 冲突自动重新 GET 最新 sha 并重试。
2. 月汇总 `archive/summary/YYYY/YYYY-MM.json` 不再因为 sha 过期卡死。
3. 每轮 flush 默认最多写 20 个日期。
4. flush 优先写最新日期，避免历史补报压住当天数据。
5. 新增 `POST /api/flush-all?token=ADMIN_TOKEN`，用于一次性尽量写完 pending 日期。

部署：替换 Render 仓库中的 `server.js` 后重新部署即可。
