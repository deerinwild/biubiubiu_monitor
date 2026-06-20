const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const events = [];
const devices = new Set();

function hashDeviceId(deviceId) {
  return crypto.createHash("sha256").update(String(deviceId || "unknown")).digest("hex");
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "biubiubiu_monitor",
    routes: ["/health", "POST /api/ping", "/api/stats?token=ADMIN_TOKEN"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "biubiubiu_monitor",
    time: new Date().toISOString()
  });
});

app.post("/api/ping", (req, res) => {
  const body = req.body || {};
  const event = body.event || "unknown";
  const deviceHash = hashDeviceId(body.deviceId);

  devices.add(deviceHash);

  events.push({
    event,
    deviceHash,
    taskId: body.taskId || null,
    platform: body.platform || null,
    appVersion: body.appVersion || null,
    createdAt: new Date().toISOString(),
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null
  });

  if (events.length > 5000) {
    events.splice(0, events.length - 5000);
  }

  res.json({ ok: true });
});

app.get("/api/stats", (req, res) => {
  if (!ADMIN_TOKEN || req.query.token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const byEvent = {};
  const byPlatform = {};
  const byTask = {};

  for (const item of events) {
    byEvent[item.event] = (byEvent[item.event] || 0) + 1;

    if (item.platform) {
      byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    }

    if (item.taskId) {
      byTask[item.taskId] = (byTask[item.taskId] || 0) + 1;
    }
  }

  res.json({
    ok: true,
    totalEvents: events.length,
    uniqueDevices: devices.size,
    byEvent,
    byPlatform,
    byTask,
    recentEvents: events.slice(-50).reverse()
  });
});

app.listen(PORT, () => {
  console.log(`biubiubiu monitor running on port ${PORT}`);
});
