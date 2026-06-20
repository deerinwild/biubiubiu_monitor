const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 20000);

const events = [];
const devices = new Set();

function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(String(deviceId || 'unknown')).digest('hex');
}

function dayKey(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return dayKey(new Date());
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function getProp(body, key, fallback = null) {
  if (body && body[key] != null) return body[key];
  if (body && body.properties && body.properties[key] != null) return body.properties[key];
  return fallback;
}

function normalizeEvent(raw) {
  const value = String(raw || 'unknown').trim();
  return value || 'unknown';
}

function normalizeCount(body) {
  const value = getProp(body, 'count', 1);
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function requireAdmin(req, res, next) {
  const token = String(req.query.token || req.headers['x-admin-token'] || '');
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

function buildStats() {
  const byEvent = {};
  const byPlatform = {};
  const byTask = {};
  const byDay = {};

  for (const item of events) {
    byEvent[item.event] = (byEvent[item.event] || 0) + item.count;
    if (item.platform) byPlatform[item.platform] = (byPlatform[item.platform] || 0) + item.count;
    if (item.taskId) byTask[item.taskId] = (byTask[item.taskId] || 0) + item.count;

    const key = item.day;
    if (!byDay[key]) {
      byDay[key] = {
        date: key,
        activeDeviceHashes: new Set(),
        totalEvents: 0,
        appLaunch: 0,
        taskFetch: 0,
        taskOpen: 0,
        webviewOpen: 0,
        taskStart: 0,
        danmuSent: 0,
        discussionSent: 0,
        sendFailed: 0,
      };
    }
    const day = byDay[key];
    day.totalEvents += item.count;
    day.activeDeviceHashes.add(item.deviceHash);

    switch (item.event) {
      case 'app_launch':
        day.appLaunch += item.count;
        break;
      case 'remote_links_loaded':
        day.taskFetch += item.count;
        break;
      case 'open_remote_link':
        day.taskOpen += item.count;
        break;
      case 'webview_open':
        day.webviewOpen += item.count;
        break;
      case 'task_start':
        day.taskStart += item.count;
        break;
      case 'danmu_sent':
        day.danmuSent += item.count;
        break;
      case 'discussion_sent':
        day.discussionSent += item.count;
        break;
      case 'danmu_failed':
      case 'discussion_failed':
        day.sendFailed += item.count;
        break;
    }
  }

  const daily = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      activeDevices: d.activeDeviceHashes.size,
      totalEvents: d.totalEvents,
      appLaunch: d.appLaunch,
      taskFetch: d.taskFetch,
      taskOpen: d.taskOpen,
      webviewOpen: d.webviewOpen,
      taskStart: d.taskStart,
      danmuSent: d.danmuSent,
      discussionSent: d.discussionSent,
      sendFailed: d.sendFailed,
    }));

  return {
    ok: true,
    totalEvents: events.length,
    totalWeightedEvents: events.reduce((sum, e) => sum + e.count, 0),
    uniqueDevices: devices.size,
    byEvent,
    byPlatform,
    byTask,
    daily,
    recentEvents: events.slice(-80).reverse(),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderDashboard(stats) {
  const latest = stats.daily[stats.daily.length - 1] || {};
  const rows = stats.daily.slice(-30).reverse().map((d) => `
    <tr>
      <td>${escapeHtml(d.date)}</td>
      <td>${d.activeDevices}</td>
      <td>${d.danmuSent}</td>
      <td>${d.discussionSent}</td>
      <td>${d.sendFailed}</td>
      <td>${d.taskOpen}</td>
      <td>${d.taskStart}</td>
      <td>${d.webviewOpen}</td>
    </tr>
  `).join('');

  const recent = stats.recentEvents.slice(0, 50).map((e) => `
    <tr>
      <td>${escapeHtml(e.createdAt)}</td>
      <td><span class="pill">${escapeHtml(e.event)}</span></td>
      <td>${escapeHtml(e.platform || '-')}</td>
      <td>${escapeHtml(e.taskId || '-')}</td>
      <td>${escapeHtml(e.count)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>biubiubiu 任务面板</title>
  <style>
    :root { color-scheme: light; --p:#6b4fd7; --p2:#eadfff; --bg:#f8f5ff; --card:#ffffff; --text:#201b2d; --muted:#6f6780; --line:#ece5f8; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color:var(--text); background:linear-gradient(180deg,#fbf8ff,#f7f3ff 55%,#ffffff); }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 18px 56px; }
    .hero { border-radius: 28px; padding: 28px; background: linear-gradient(135deg,#e7dcff,#fff0df); box-shadow: 0 18px 50px rgba(72,47,140,.12); }
    h1 { margin:0; font-size: 32px; letter-spacing:.2px; }
    .sub { margin-top:8px; color:var(--muted); }
    .cards { display:grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap:14px; margin:18px 0 22px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:22px; padding:18px; box-shadow: 0 10px 28px rgba(97,73,170,.08); }
    .k { color:var(--muted); font-size:14px; }
    .v { margin-top:8px; font-size:28px; font-weight:900; }
    .section { margin-top: 22px; }
    .title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 10px; }
    .title h2 { margin:0; font-size:20px; }
    table { width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid var(--line); border-radius:18px; background:white; }
    th,td { padding:12px 14px; border-bottom:1px solid var(--line); text-align:left; font-size:14px; }
    th { background:#f3edff; color:#4a3b7c; font-weight:800; }
    tr:last-child td { border-bottom:0; }
    .pill { display:inline-block; padding:4px 9px; border-radius:999px; background:var(--p2); color:#4b35b0; font-weight:700; font-size:12px; }
    .tips { color:var(--muted); font-size:13px; }
    .grid2 { display:grid; grid-template-columns: 1.2fr .8fr; gap:16px; }
    @media (max-width: 900px) { .cards { grid-template-columns: repeat(2,minmax(0,1fr)); } .grid2 { grid-template-columns:1fr; } }
    @media (max-width: 520px) { h1 { font-size:26px; } .cards { grid-template-columns:1fr; } th,td { padding:10px 8px; font-size:12px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>biubiubiu 任务面板</h1>
      <div class="sub">按天查看活跃设备、弹幕发送量、讨论发送量与任务打开情况。统计时间按北京时间汇总。</div>
    </div>

    <div class="cards">
      <div class="card"><div class="k">累计活跃设备</div><div class="v">${stats.uniqueDevices}</div></div>
      <div class="card"><div class="k">今日活跃设备</div><div class="v">${latest.activeDevices || 0}</div></div>
      <div class="card"><div class="k">今日弹幕发送</div><div class="v">${latest.danmuSent || 0}</div></div>
      <div class="card"><div class="k">今日讨论发送</div><div class="v">${latest.discussionSent || 0}</div></div>
    </div>

    <div class="grid2">
      <div class="section card">
        <div class="title"><h2>每日汇总</h2><span class="tips">最近 30 天</span></div>
        <table>
          <thead><tr><th>日期</th><th>活跃</th><th>弹幕</th><th>讨论</th><th>失败</th><th>打开链接</th><th>启动任务</th><th>进入网页</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">暂无数据</td></tr>'}</tbody>
        </table>
      </div>
      <div class="section card">
        <div class="title"><h2>总体事件</h2></div>
        <table>
          <thead><tr><th>事件</th><th>数量</th></tr></thead>
          <tbody>${Object.entries(stats.byEvent).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join('') || '<tr><td colspan="2">暂无数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="section card">
      <div class="title"><h2>最近事件</h2><span class="tips">最近 50 条</span></div>
      <table>
        <thead><tr><th>时间</th><th>事件</th><th>平台</th><th>任务</th><th>数量</th></tr></thead>
        <tbody>${recent || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'biubiubiu_monitor',
    routes: ['/health', 'POST /api/ping', '/api/stats?token=ADMIN_TOKEN', '/dashboard?token=ADMIN_TOKEN'],
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'biubiubiu_monitor', time: new Date().toISOString() });
});

app.post('/api/ping', (req, res) => {
  const body = req.body || {};
  const event = normalizeEvent(body.event);
  const deviceHash = hashDeviceId(body.deviceId);
  const count = normalizeCount(body);

  devices.add(deviceHash);

  events.push({
    event,
    count,
    deviceHash,
    taskId: String(getProp(body, 'taskId', '') || ''),
    platform: String(getProp(body, 'platform', '') || ''),
    appVersion: String(body.version || body.appVersion || ''),
    properties: body.properties || {},
    day: dayKey(body.timestamp),
    createdAt: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null,
  });

  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  res.json({ ok: true });
});

app.get('/api/stats', requireAdmin, (req, res) => {
  res.json(buildStats());
});

app.get('/dashboard', (req, res) => {
  const token = String(req.query.token || '');
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).send('<h1>401 Unauthorized</h1><p>请在地址后添加 ?token=你的 ADMIN_TOKEN。</p>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDashboard(buildStats()));
});

app.listen(PORT, () => {
  console.log(`biubiubiu monitor running on port ${PORT}`);
});
