const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// 从环境变量读取数据库连接字符串
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 创建表（如果不存在）
async function initDB() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      user_uid TEXT,
      event_type TEXT NOT NULL,
      count INTEGER DEFAULT 1,
      event_timestamp BIGINT NOT NULL,
      extension_version TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_user_uid ON events(user_uid);
    CREATE INDEX IF NOT EXISTS idx_event_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON events(event_timestamp);
  `;
  try {
    await pool.query(createTableSQL);
    console.log('✅ 数据库表已就绪');
  } catch (err) {
    console.error('❌ 初始化数据库失败:', err);
  }
}

// 接收统计事件
app.post('/api/event', async (req, res) => {
  const { deviceId, userUid, eventType, count = 1, timestamp, extensionVersion } = req.body;

  // 参数校验
  if (!deviceId || !eventType || !timestamp) {
    return res.status(400).json({ error: '缺少必要参数 (deviceId, eventType, timestamp)' });
  }
  if (!['danmu_sent', 'comment_sent'].includes(eventType)) {
    return res.status(400).json({ error: 'eventType 必须是 danmu_sent 或 comment_sent' });
  }

  try {
    const insertSQL = `
      INSERT INTO events (device_id, user_uid, event_type, count, event_timestamp, extension_version)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    await pool.query(insertSQL, [deviceId, userUid || null, eventType, count, timestamp, extensionVersion || null]);
    res.json({ ok: true, message: '事件已记录' });
  } catch (err) {
    console.error('插入事件失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 按用户聚合统计（可选时间范围）
app.get('/api/stats', async (req, res) => {
  const { from, to, groupBy = 'user_uid' } = req.query;
  // groupBy 可选: 'user_uid' 或 'device_id'
  const groupField = groupBy === 'device_id' ? 'device_id' : 'user_uid';

  let whereClause = '';
  const params = [];
  if (from) {
    params.push(parseInt(from));
    whereClause += ` AND event_timestamp >= $${params.length}`;
  }
  if (to) {
    params.push(parseInt(to));
    whereClause += ` AND event_timestamp <= $${params.length}`;
  }

  const statsSQL = `
    SELECT 
      COALESCE(${groupField}, 'unknown') AS identifier,
      SUM(CASE WHEN event_type = 'danmu_sent' THEN count ELSE 0 END) AS danmu_total,
      SUM(CASE WHEN event_type = 'comment_sent' THEN count ELSE 0 END) AS comment_total
    FROM events
    WHERE 1=1 ${whereClause}
    GROUP BY ${groupField}
    ORDER BY danmu_total DESC, comment_total DESC
  `;

  try {
    const result = await pool.query(statsSQL, params);
    res.json(result.rows);
  } catch (err) {
    console.error('查询统计失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 获取原始事件记录（分页）
app.get('/api/events', async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const eventsSQL = `
    SELECT id, device_id, user_uid, event_type, count, event_timestamp, extension_version, created_at
    FROM events
    ORDER BY event_timestamp DESC
    LIMIT $1 OFFSET $2
  `;
  try {
    const result = await pool.query(eventsSQL, [parseInt(limit), parseInt(offset)]);
    res.json(result.rows);
  } catch (err) {
    console.error('查询事件失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`📊 统计服务已启动，端口 ${PORT}`);
});
