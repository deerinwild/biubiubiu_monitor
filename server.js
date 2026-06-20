const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 5000);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'deerinwild';
const GITHUB_REPO = process.env.GITHUB_REPO || 'biubiubiu_monitor';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_API = 'https://api.github.com';

const events = [];
let writeQueue = Promise.resolve();

function githubEnabled() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO && GITHUB_BRANCH);
}

function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(String(deviceId || 'unknown')).digest('hex');
}

function shortHash(value) {
  return String(value || '').slice(0, 12);
}

function normalizeDate(raw) {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return beijingDayKey(new Date());
}

function beijingDayKey(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return beijingDayKey(new Date());
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function nowBeijingIso() {
  return new Date().toISOString();
}

function monthPathFromDate(date) {
  const [year, month] = date.split('-');
  return { year, month, monthKey: `${year}-${month}` };
}

function normalizePlatform(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['tx', 'tencent', 'qq', 'vqq'].includes(v)) return 'tx';
  if (['iqy', 'iqiyi', 'qiyi'].includes(v)) return 'iqy';
  return v;
}

function normalizeWeiboUid(value) {
  const v = String(value || '').trim();
  if (!v) return '未绑定UID';
  return v.replace(/\s+/g, '').slice(0, 64);
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

function normalizeCount(value, fallback = 0) {
  const n = Number(value == null ? fallback : value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function requireAdmin(req, res, next) {
  const token = String(req.query.token || req.headers['x-admin-token'] || '');
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'biubiubiu-monitor',
  };
}

function b64EncodeUtf8(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function b64DecodeUtf8(text) {
  return Buffer.from(text || '', 'base64').toString('utf8');
}

async function ghGetJson(path) {
  if (!githubEnabled()) return { data: null, sha: null, exists: false };
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return { data: null, sha: null, exists: false };
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status} ${await safeText(res)}`);
  const info = await res.json();
  const content = b64DecodeUtf8(info.content || '');
  try {
    return { data: JSON.parse(content), sha: info.sha, exists: true };
  } catch (err) {
    throw new Error(`GitHub JSON parse failed for ${path}: ${err.message}`);
  }
}

async function ghPutJson(path, data, sha, message) {
  if (!githubEnabled()) return null;
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponentPath(path)}`;
  const body = {
    message,
    content: b64EncodeUtf8(`${JSON.stringify(data, null, 2)}\n`),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status} ${await safeText(res)}`);
  return res.json();
}

function encodeURIComponentPath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function enqueueWrite(fn) {
  writeQueue = writeQueue.then(fn, fn).catch((err) => {
    console.error('[github-write]', err);
  });
  return writeQueue;
}

function emptyCounterFile(date) {
  return {
    date,
    updatedAt: '',
    users: {},
  };
}

function summarizeCounter(counter) {
  const users = counter.users || {};
  let activeDevices = 0;
  let danmuSent = 0;
  let discussionSent = 0;
  let lastSeenAt = '';

  for (const user of Object.values(users)) {
    activeDevices += Number(user.activeDevices || 0);
    danmuSent += Number(user.danmuSent || 0);
    discussionSent += Number(user.discussionSent || 0);
    if (user.lastSeenAt && user.lastSeenAt > lastSeenAt) lastSeenAt = user.lastSeenAt;
  }

  return {
    date: counter.date,
    activeUsers: Object.keys(users).length,
    activeDevices,
    danmuSent,
    discussionSent,
    lastSeenAt,
    updatedAt: counter.updatedAt || nowBeijingIso(),
  };
}

function computeUserTotals(user) {
  const devices = user.devices || {};
  let danmuSent = 0;
  let discussionSent = 0;
  let lastSeenAt = '';
  for (const item of Object.values(devices)) {
    danmuSent += Number(item.danmuSent || 0);
    discussionSent += Number(item.discussionSent || 0);
    if (item.lastSeenAt && item.lastSeenAt > lastSeenAt) lastSeenAt = item.lastSeenAt;
  }
  user.activeDevices = Object.keys(devices).length;
  user.danmuSent = danmuSent;
  user.discussionSent = discussionSent;
  user.lastSeenAt = lastSeenAt;
}

async function updateGithubCounter(date, weiboUid, deviceHash, counter) {
  if (!githubEnabled()) return;
  const { year, month, monthKey } = monthPathFromDate(date);
  const counterPath = `archive/counters/${year}/${month}/${date}.json`;
  const summaryPath = `archive/summary/${year}/${monthKey}.json`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const current = await ghGetJson(counterPath);
      const data = current.data || emptyCounterFile(date);
      data.date = date;
      data.users = data.users || {};

      // 如果同一设备当天更换了微博UID，以最近一次UID为准，避免同一设备重复计数。
      for (const [uid, user] of Object.entries(data.users)) {
        if (uid !== weiboUid && user && user.devices && user.devices[deviceHash]) {
          delete user.devices[deviceHash];
          computeUserTotals(user);
          if (!Object.keys(user.devices).length) delete data.users[uid];
        }
      }

      const user = data.users[weiboUid] || { weiboUid, devices: {} };
      user.weiboUid = weiboUid;
      user.devices = user.devices || {};
      const oldDevice = user.devices[deviceHash] || {};
      user.devices[deviceHash] = {
        deviceHash: shortHash(deviceHash),
        danmuSent: Math.max(Number(oldDevice.danmuSent || 0), Number(counter.danmuSentToday || 0)),
        discussionSent: Math.max(Number(oldDevice.discussionSent || 0), Number(counter.discussionSentToday || 0)),
        lastSeenAt: counter.lastEventAt || nowBeijingIso(),
        appVersion: counter.appVersion || '',
      };
      computeUserTotals(user);
      data.users[weiboUid] = user;
      data.updatedAt = nowBeijingIso();

      await ghPutJson(counterPath, data, current.sha, `biubiubiu counter ${date}`);

      const summaryCurrent = await ghGetJson(summaryPath);
      const summary = summaryCurrent.data || { month: monthKey, days: {} };
      summary.month = monthKey;
      summary.days = summary.days || {};
      summary.days[date] = summarizeCounter(data);
      summary.updatedAt = nowBeijingIso();
      await ghPutJson(summaryPath, summary, summaryCurrent.sha, `biubiubiu summary ${monthKey}`);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(500 * attempt);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistDailyCounters(body) {
  if (!githubEnabled()) return;
  const deviceHash = hashDeviceId(body.deviceId);
  const weiboUid = normalizeWeiboUid(body.weiboUid || getProp(body, 'weiboUid', ''));
  const counters = Array.isArray(body.counters)
    ? body.counters
    : [{
        date: body.date,
        danmuSentToday: body.danmuSentToday,
        discussionSentToday: body.discussionSentToday,
        lastEventAt: body.lastEventAt,
      }];

  await enqueueWrite(async () => {
    for (const raw of counters) {
      const date = normalizeDate(raw.date);
      await updateGithubCounter(date, weiboUid, deviceHash, {
        danmuSentToday: normalizeCount(raw.danmuSentToday, 0),
        discussionSentToday: normalizeCount(raw.discussionSentToday, 0),
        lastEventAt: raw.lastEventAt || body.timestamp || nowBeijingIso(),
        appVersion: body.version || body.appVersion || '',
      });
    }
  });
}

function pushMemoryEvent(body) {
  const event = normalizeEvent(body.event);
  const deviceHash = hashDeviceId(body.deviceId);
  const count = normalizeCount(getProp(body, 'count', 1), 1);
  events.push({
    event,
    count,
    deviceHash: shortHash(deviceHash),
    weiboUid: normalizeWeiboUid(body.weiboUid || getProp(body, 'weiboUid', '')),
    taskId: String(getProp(body, 'taskId', '') || ''),
    platform: normalizePlatform(getProp(body, 'platform', '') || ''),
    appVersion: String(body.version || body.appVersion || ''),
    properties: body.properties || {},
    day: normalizeDate(body.date || body.timestamp),
    createdAt: nowBeijingIso(),
    ip: reqIpSafe(body),
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function reqIpSafe() { return null; }

async function buildStatsFromGithub() {
  if (!githubEnabled()) return null;
  const today = beijingDayKey(new Date());
  const { year, month, monthKey } = monthPathFromDate(today);
  const summaryPath = `archive/summary/${year}/${monthKey}.json`;
  const counterPath = `archive/counters/${year}/${month}/${today}.json`;

  const summaryFile = await ghGetJson(summaryPath).catch(() => ({ data: null }));
  const counterFile = await ghGetJson(counterPath).catch(() => ({ data: null }));
  const summary = summaryFile.data || { month: monthKey, days: {} };
  const counter = counterFile.data || emptyCounterFile(today);

  const daily = Object.values(summary.days || {}).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const users = Object.values(counter.users || {})
    .map((u) => ({
      weiboUid: u.weiboUid || '未绑定UID',
      activeDevices: Number(u.activeDevices || 0),
      danmuSent: Number(u.danmuSent || 0),
      discussionSent: Number(u.discussionSent || 0),
      lastSeenAt: u.lastSeenAt || '',
    }))
    .sort((a, b) => (b.danmuSent + b.discussionSent) - (a.danmuSent + a.discussionSent));

  const latest = daily.find((d) => d.date === today) || summarizeCounter(counter);
  return {
    ok: true,
    source: 'github',
    githubEnabled: true,
    today,
    totalEvents: events.length,
    uniqueUsersToday: users.length,
    uniqueDevicesToday: latest.activeDevices || 0,
    todayDanmuSent: latest.danmuSent || 0,
    todayDiscussionSent: latest.discussionSent || 0,
    daily,
    usersToday: users,
    recentEvents: events.slice(-80).reverse(),
  };
}

function buildMemoryStats() {
  const byDay = {};
  const usersToday = {};
  const today = beijingDayKey(new Date());
  for (const item of events) {
    const key = item.day;
    if (!byDay[key]) byDay[key] = { date: key, activeDevices: new Set(), danmuSent: 0, discussionSent: 0 };
    byDay[key].activeDevices.add(item.deviceHash);
    if (item.event === 'danmu_sent') byDay[key].danmuSent += item.count;
    if (item.event === 'discussion_sent') byDay[key].discussionSent += item.count;
    if (key === today) {
      const uid = item.weiboUid || '未绑定UID';
      usersToday[uid] = usersToday[uid] || { weiboUid: uid, activeDevicesSet: new Set(), danmuSent: 0, discussionSent: 0, lastSeenAt: '' };
      usersToday[uid].activeDevicesSet.add(item.deviceHash);
      if (item.event === 'danmu_sent') usersToday[uid].danmuSent += item.count;
      if (item.event === 'discussion_sent') usersToday[uid].discussionSent += item.count;
      usersToday[uid].lastSeenAt = item.createdAt;
    }
  }
  const daily = Object.values(byDay).map((d) => ({ ...d, activeDevices: d.activeDevices.size })).sort((a, b) => a.date.localeCompare(b.date));
  const users = Object.values(usersToday).map((u) => ({ ...u, activeDevices: u.activeDevicesSet.size, activeDevicesSet: undefined }));
  const latest = daily.find((d) => d.date === today) || { activeDevices: 0, danmuSent: 0, discussionSent: 0 };
  return {
    ok: true,
    source: 'memory',
    githubEnabled: false,
    today,
    totalEvents: events.length,
    uniqueUsersToday: users.length,
    uniqueDevicesToday: latest.activeDevices || 0,
    todayDanmuSent: latest.danmuSent || 0,
    todayDiscussionSent: latest.discussionSent || 0,
    daily,
    usersToday: users,
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
  const dailyRows = (stats.daily || []).slice(-45).reverse().map((d) => `
    <tr><td>${escapeHtml(d.date)}</td><td>${d.activeUsers ?? '-'}</td><td>${d.activeDevices ?? 0}</td><td>${d.danmuSent ?? 0}</td><td>${d.discussionSent ?? 0}</td><td>${escapeHtml(d.lastSeenAt || '')}</td></tr>
  `).join('');

  const userRows = (stats.usersToday || []).map((u) => `
    <tr><td><span class="uid">${escapeHtml(u.weiboUid)}</span></td><td>${u.activeDevices || 0}</td><td>${u.danmuSent || 0}</td><td>${u.discussionSent || 0}</td><td>${escapeHtml(u.lastSeenAt || '')}</td></tr>
  `).join('');

  const recentRows = (stats.recentEvents || []).slice(0, 50).map((e) => `
    <tr><td>${escapeHtml(e.createdAt)}</td><td>${escapeHtml(e.weiboUid || '-')}</td><td><span class="pill">${escapeHtml(e.event)}</span></td><td>${escapeHtml(e.platform || '-')}</td><td>${escapeHtml(e.taskId || '-')}</td><td>${escapeHtml(e.count)}</td></tr>
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
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; color:var(--text); background:linear-gradient(180deg,#fbf8ff,#f7f3ff 55%,#fff); }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 18px 56px; }
    .hero { border-radius: 28px; padding: 28px; background:linear-gradient(135deg,#e7dcff,#fff0df); box-shadow:0 18px 50px rgba(72,47,140,.12); }
    h1 { margin:0; font-size:32px; }
    .sub { margin-top:8px; color:var(--muted); }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:18px 0 22px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:22px; padding:18px; box-shadow:0 10px 28px rgba(97,73,170,.08); }
    .k { color:var(--muted); font-size:14px; }
    .v { margin-top:8px; font-size:28px; font-weight:900; }
    .section { margin-top:22px; }
    .title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 10px; }
    .title h2 { margin:0; font-size:20px; }
    table { width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid var(--line); border-radius:18px; background:white; }
    th,td { padding:12px 14px; border-bottom:1px solid var(--line); text-align:left; font-size:14px; vertical-align:top; }
    th { background:#f3edff; color:#4a3b7c; font-weight:800; }
    tr:last-child td { border-bottom:0; }
    .pill,.uid { display:inline-block; padding:4px 9px; border-radius:999px; background:var(--p2); color:#4b35b0; font-weight:700; font-size:12px; }
    .tips { color:var(--muted); font-size:13px; }
    .grid2 { display:grid; grid-template-columns:1fr; gap:16px; }
    @media (max-width:900px) { .cards { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:520px) { h1{font-size:26px;} .cards{grid-template-columns:1fr;} th,td{padding:10px 8px;font-size:12px;} }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero"><h1>biubiubiu 任务面板</h1><div class="sub">按微博UID查看用户完成情况；历史数据来自 GitHub 归档，统计时间按上报数据日期汇总。</div></div>
    <div class="cards">
      <div class="card"><div class="k">今日活跃用户</div><div class="v">${stats.uniqueUsersToday || 0}</div></div>
      <div class="card"><div class="k">今日活跃设备</div><div class="v">${stats.uniqueDevicesToday || 0}</div></div>
      <div class="card"><div class="k">今日弹幕发送</div><div class="v">${stats.todayDanmuSent || 0}</div></div>
      <div class="card"><div class="k">今日讨论发送</div><div class="v">${stats.todayDiscussionSent || 0}</div></div>
    </div>
    <div class="section card"><div class="title"><h2>今日用户完成情况</h2><span class="tips">显示微博UID，不展示设备ID</span></div><table><thead><tr><th>微博UID</th><th>设备数</th><th>弹幕发送</th><th>讨论发送</th><th>最后上报</th></tr></thead><tbody>${userRows || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody></table></div>
    <div class="section card"><div class="title"><h2>每日汇总</h2><span class="tips">最近 45 天 / 当前归档月</span></div><table><thead><tr><th>日期</th><th>活跃用户</th><th>活跃设备</th><th>弹幕</th><th>讨论</th><th>最后上报</th></tr></thead><tbody>${dailyRows || '<tr><td colspan="6">暂无数据</td></tr>'}</tbody></table></div>
    <div class="section card"><div class="title"><h2>最近事件</h2><span class="tips">仅为在线调试辅助，长期数据以 GitHub 归档为准</span></div><table><thead><tr><th>时间</th><th>微博UID</th><th>事件</th><th>平台</th><th>任务</th><th>数量</th></tr></thead><tbody>${recentRows || '<tr><td colspan="6">暂无数据</td></tr>'}</tbody></table></div>
  </div>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'biubiubiu_monitor',
    githubEnabled: githubEnabled(),
    routes: ['/health', 'POST /api/ping', '/api/stats?token=ADMIN_TOKEN', '/dashboard?token=ADMIN_TOKEN'],
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'biubiubiu_monitor', githubEnabled: githubEnabled(), time: new Date().toISOString() });
});

app.post('/api/ping', async (req, res) => {
  const body = req.body || {};
  pushMemoryEvent(body);
  const event = normalizeEvent(body.event);
  if (event === 'daily_counter_batch' || event === 'daily_counter') {
    try {
      await persistDailyCounters(body);
    } catch (err) {
      console.error('[persistDailyCounters]', err);
      return res.status(202).json({ ok: false, persisted: false, error: err.message });
    }
  }
  res.json({ ok: true, persisted: event.startsWith('daily_counter') ? githubEnabled() : undefined });
});

app.get('/api/stats', requireAdmin, async (req, res) => {
  const stats = (await buildStatsFromGithub().catch((err) => ({ ok: false, error: err.message }))) || buildMemoryStats();
  if (stats.ok === false) return res.status(500).json(stats);
  res.json(stats);
});

app.get('/dashboard', async (req, res) => {
  const token = String(req.query.token || '');
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).send('<h1>401 Unauthorized</h1><p>请在地址后添加 ?token=你的 ADMIN_TOKEN。</p>');
  }
  const stats = (await buildStatsFromGithub().catch(() => null)) || buildMemoryStats();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDashboard(stats));
});

app.listen(PORT, () => {
  console.log(`biubiubiu monitor running on port ${PORT}, github=${githubEnabled() ? 'on' : 'off'}`);
});
