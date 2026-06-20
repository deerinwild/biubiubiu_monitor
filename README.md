# biubiubiu Monitor

Render 设置：

- Root Directory: 留空（如果 package.json 和 server.js 在仓库根目录）
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables:
  - Name: `ADMIN_TOKEN`
  - Value: 自己设置的后台密码

接口：

- 健康检查：`/health`
- APK 上报：`POST /api/ping`
- JSON 统计：`/api/stats?token=你的ADMIN_TOKEN`
- 可视化面板：`/dashboard?token=你的ADMIN_TOKEN`

注意：当前版本使用 Render 进程内存保存统计。Render 免费服务重启、休眠唤醒或重新部署后，历史统计可能清空。要长期留存，需要接入数据库。
