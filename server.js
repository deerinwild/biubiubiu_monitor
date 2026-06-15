const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// 简单内存存储（重启丢失，仅演示）
let events = [];

app.post('/api/event', (req, res) => {
  const data = req.body;
  console.log('收到统计:', data);
  events.push(data);
  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  // 按 userUid 聚合
  const agg = {};
  for (const e of events) {
    const key = e.userUid || e.deviceId;
    if (!agg[key]) agg[key] = { danmu: 0, comment: 0 };
    if (e.eventType === 'danmu_sent') agg[key].danmu += e.count;
    if (e.eventType === 'comment_sent') agg[key].comment += e.count;
  }
  res.json(agg);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
