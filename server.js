const express = require('express');
const path = require('path');
const { initializeDatabase } = require('./src/db');
const { startScheduler, refreshPrices } = require('./src/priceService');

const app = express();
const PORT = process.env.PORT || 3000;

const db = initializeDatabase();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/summary', (req, res) => {
  try {
    const latest = db.prepare(`
      SELECT price, currency, unit, fetched_at, source, source_mode
      FROM price_snapshots
      ORDER BY fetched_at DESC
      LIMIT 1
    `).get();

    if (!latest) {
      return res.json({
        latest: null,
        change24h: null,
        dailyRange: null,
        nextRefreshMinutes: 1
      });
    }

    const previous24h = db.prepare(`
      SELECT price, fetched_at
      FROM price_snapshots
      WHERE fetched_at <= datetime(?, '-24 hours')
      ORDER BY fetched_at DESC
      LIMIT 1
    `).get(latest.fetched_at);

    const range24h = db.prepare(`
      SELECT MIN(price) AS low, MAX(price) AS high
      FROM price_snapshots
      WHERE fetched_at >= datetime(?, '-24 hours')
    `).get(latest.fetched_at);

    const change24h = previous24h
      ? {
          absolute: Number((latest.price - previous24h.price).toFixed(2)),
          percent: Number((((latest.price - previous24h.price) / previous24h.price) * 100).toFixed(2))
        }
      : null;

    res.json({
      latest,
      change24h,
      dailyRange: range24h,
      nextRefreshMinutes: 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chart/intraday', (req, res) => {
  try {
    const rows = db.prepare(`
      WITH minute_points AS (
        SELECT
          strftime('%Y-%m-%dT%H:%M:00Z', fetched_at) AS minute_bucket,
          fetched_at,
          price,
          ROW_NUMBER() OVER (
            PARTITION BY strftime('%Y-%m-%dT%H:%M:00Z', fetched_at)
            ORDER BY fetched_at DESC
          ) AS row_num
        FROM price_snapshots
        WHERE fetched_at >= datetime('now', '-24 hours')
      )
      SELECT minute_bucket AS fetched_at, price
      FROM minute_points
      WHERE row_num = 1
      ORDER BY fetched_at ASC
    `).all();

    const fallbackRows = rows.length >= 2
      ? rows
      : db.prepare(`
          SELECT fetched_at, price
          FROM price_snapshots
          ORDER BY fetched_at DESC
          LIMIT 1440
        `).all().reverse();

    res.json(fallbackRows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chart/monthly', (req, res) => {
  try {
    const months = Number(req.query.months || 120);
    const rows = db.prepare(`
      WITH ranked AS (
        SELECT
          strftime('%Y-%m', fetched_at) AS bucket,
          fetched_at,
          price,
          ROW_NUMBER() OVER (
            PARTITION BY strftime('%Y-%m', fetched_at)
            ORDER BY fetched_at DESC
          ) AS row_num
        FROM price_snapshots
        WHERE fetched_at >= datetime('now', ?)
      )
      SELECT bucket, fetched_at, price
      FROM ranked
      WHERE row_num = 1
      ORDER BY fetched_at ASC
    `).all(`-${months} months`);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history/daily', (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const rows = db.prepare(`
      SELECT
        date(fetched_at) AS date,
        MIN(price) AS low,
        MAX(price) AS high,
        ROUND(AVG(price), 2) AS average,
        (
          SELECT ps_open.price
          FROM price_snapshots ps_open
          WHERE date(ps_open.fetched_at) = date(ps.fetched_at)
          ORDER BY ps_open.fetched_at ASC
          LIMIT 1
        ) AS open,
        (
          SELECT ps_close.price
          FROM price_snapshots ps_close
          WHERE date(ps_close.fetched_at) = date(ps.fetched_at)
          ORDER BY ps_close.fetched_at DESC
          LIMIT 1
        ) AS close,
        COUNT(*) AS points
      FROM price_snapshots ps
      WHERE fetched_at >= datetime('now', ?)
      GROUP BY date(fetched_at)
      ORDER BY date(fetched_at) DESC
    `).all(`-${days} days`).map((row) => ({
      ...row,
      delta: Number((row.close - row.open).toFixed(2)),
      deltaPercent: row.open ? Number((((row.close - row.open) / row.open) * 100).toFixed(2)) : null
    }));

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const snapshot = await refreshPrices(db);
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS total FROM price_snapshots').get();
  const first = db.prepare('SELECT fetched_at FROM price_snapshots ORDER BY fetched_at ASC LIMIT 1').get();
  const latest = db.prepare('SELECT fetched_at FROM price_snapshots ORDER BY fetched_at DESC LIMIT 1').get();

  res.json({
    totalSnapshots: total.total,
    firstSnapshotAt: first?.fetched_at || null,
    latestSnapshotAt: latest?.fetched_at || null,
    refreshIntervalMinutes: 1
  });
});

startScheduler(db).catch((error) => {
  console.error('Scheduler startup failed:', error);
});

app.listen(PORT, () => {
  console.log(`Gold dashboard running at http://localhost:${PORT}`);
});
