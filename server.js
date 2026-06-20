const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || '/data';
const FALLBACK_DIR = path.join(__dirname, 'data');

app.use(express.json({ limit: '64kb' }));

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch (_) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    return FALLBACK_DIR;
  }
}

const dataDir = ensureDir(DATA_DIR);
const eventsFile = path.join(dataDir, 'events.jsonl');

function dayString(ts = new Date()) {
  return ts.toISOString().slice(0, 10);
}

function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(String(deviceId)).digest('hex').slice(0, 24);
}

function auth(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.query.token || req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'biubiubiu-monitor' });
});

app.post('/api/ping', (req, res) => {
  const body = req.body || {};
  const event = String(body.event || 'unknown').slice(0, 80);
  const deviceId = String(body.deviceId || '').slice(0, 200);
  const properties = body.properties && typeof body.properties === 'object' ? body.properties : {};

  const record = {
    ts: new Date().toISOString(),
    day: dayString(),
    app: String(body.app || 'biubiubiu').slice(0, 60),
    version: String(body.version || '').slice(0, 40),
    event,
    deviceHash: deviceId ? hashDeviceId(deviceId) : 'unknown',
    properties,
    ipHash: hashDeviceId(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
    ua: String(req.headers['user-agent'] || '').slice(0, 300)
  };

  fs.appendFile(eventsFile, JSON.stringify(record) + '\n', () => {});
  res.json({ ok: true });
});

app.get('/api/stats', auth, (req, res) => {
  if (!fs.existsSync(eventsFile)) {
    return res.json({ ok: true, totalEvents: 0, uniqueDevices: 0, events: {}, days: {} });
  }

  const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
  const devices = new Set();
  const events = {};
  const days = {};
  const latest = [];

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      devices.add(item.deviceHash);
      events[item.event] = (events[item.event] || 0) + 1;
      if (!days[item.day]) days[item.day] = { total: 0, uniqueDevices: {} };
      days[item.day].total += 1;
      days[item.day].uniqueDevices[item.deviceHash] = true;
      latest.push(item);
    } catch (_) {}
  }

  for (const day of Object.keys(days)) {
    days[day].uniqueDevices = Object.keys(days[day].uniqueDevices).length;
  }

  res.json({
    ok: true,
    totalEvents: lines.length,
    uniqueDevices: devices.size,
    events,
    days,
    latest: latest.slice(-50).reverse()
  });
});

app.listen(PORT, () => {
  console.log(`biubiubiu monitor running on port ${PORT}, data dir: ${dataDir}`);
});
