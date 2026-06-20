# biubiubiu Monitor / Render 部署

用途：统计 APK 使用人数和基础事件。它不收集手机号、账号、视频平台 Cookie、弹幕内容；设备 ID 在服务端只保存 SHA-256 截断哈希。

## 部署到 Render

1. 把本目录内容上传到 `https://github.com/deerinwild/biubiubiu_monitor`。
2. Render 新建 Web Service，连接该 GitHub 仓库。
3. Runtime 选择 Node。
4. Build Command 留空或填：`npm install`。
5. Start Command 填：`npm start`。
6. Environment Variables 建议设置：
   - `ADMIN_TOKEN`：自己生成一串管理密码，例如 `bibu_2026_xxx`。
   - `DATA_DIR`：`/data`。
7. 如果 Render 套餐支持持久化磁盘，添加 Disk，Mount Path 填 `/data`。如果没有持久化磁盘，服务重启或重新部署后本地统计可能丢失。

## 查看统计

假设服务地址是：

`https://biubiubiu-monitor.onrender.com`

查看统计：

`https://biubiubiu-monitor.onrender.com/api/stats?token=你的ADMIN_TOKEN`

## APK 如何上报

把 Render 地址填入后台任务仓库的 `tasks.json`：

```json
{
  "monitorEndpoint": "https://biubiubiu-monitor.onrender.com/api/ping"
}
```

APK 成功读取 `tasks.json` 后，会自动保存这个监控地址，并上报：

- `app_launch`：打开 APK。
- `remote_links_loaded`：成功读取后台任务链接。
- `open_remote_link`：打开管理员发布的视频链接。
- `webview_open`：进入内置网页。
