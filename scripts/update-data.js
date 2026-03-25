const fs = require('fs');
const path = require('path');
const axios = require('axios');

const dataDir = path.join(__dirname, '..', 'public', 'data');
const storePath = path.join(dataDir, 'store.json');
const summaryPath = path.join(dataDir, 'summary.json');
const statusPath = path.join(dataDir, 'status.json');
const intradayPath = path.join(dataDir, 'intraday.json');
const monthlyPath = path.join(dataDir, 'monthly.json');
const dailyPath = path.join(dataDir, 'daily.json');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
  Accept: 'application/json,text/html'
};

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function floorToMinute(date) {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy;
}

function isoMinute(date) {
  return floorToMinute(date).toISOString();
}

function generateSeedSnapshots() {
  const snapshots = [];
  const now = Date.now();

  for (let day = 720; day >= 2; day -= 1) {
    for (const hour of [0, 6, 12, 18]) {
      const timestamp = new Date(now - ((day * 24) + (18 - hour)) * 60 * 60 * 1000);
      const monthlyWave = Math.sin(day / 28) * 48;
      const dailyWave = Math.cos((hour / 24) * Math.PI * 2) * 12;
      const drift = (720 - day) * 0.48;
      const price = Number((2080 + drift + monthlyWave + dailyWave).toFixed(2));
      snapshots.push({
        fetched_at: timestamp.toISOString(),
        price,
        source: 'seeded-history',
        source_mode: 'seed',
        currency: 'USD',
        unit: 'oz'
      });
    }
  }

  for (let minute = 1440; minute >= 1; minute -= 1) {
    const timestamp = new Date(now - minute * 60 * 1000);
    const offset = 1440 - minute;
    const minuteWave = Math.sin(offset / 37) * 4.8;
    const hourWave = Math.cos(offset / 180) * 8.5;
    const trend = offset * 0.012;
    const price = Number((2435 + minuteWave + hourWave + trend).toFixed(2));
    snapshots.push({
      fetched_at: floorToMinute(timestamp).toISOString(),
      price,
      source: 'seeded-history',
      source_mode: 'seed',
      currency: 'USD',
      unit: 'oz'
    });
  }

  snapshots.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));
  return snapshots;
}

async function fetchCurrentPrice() {
  const response = await axios.get('https://api.gold-api.com/price/XAU', {
    headers: DEFAULT_HEADERS,
    timeout: 15000
  });

  if (!response.data || !response.data.price) {
    throw new Error('Price API returned invalid data.');
  }

  return {
    fetched_at: isoMinute(response.data.updatedAt || new Date()),
    price: Number(response.data.price),
    source: 'api.gold-api.com',
    source_mode: 'api',
    currency: 'USD',
    unit: 'oz'
  };
}

function ensureMinuteContinuity(snapshots, latestPoint) {
  const result = [...snapshots];
  const last = result[result.length - 1];
  if (!last) {
    result.push(latestPoint);
    return result;
  }

  let cursor = new Date(last.fetched_at).getTime() + 60 * 1000;
  const target = new Date(latestPoint.fetched_at).getTime();
  const carryPrice = last.price;

  while (cursor < target) {
    result.push({
      ...last,
      fetched_at: new Date(cursor).toISOString(),
      price: carryPrice,
      source: 'carry-forward',
      source_mode: 'derived'
    });
    cursor += 60 * 1000;
  }

  if (result[result.length - 1].fetched_at === latestPoint.fetched_at) {
    result[result.length - 1] = latestPoint;
  } else {
    result.push(latestPoint);
  }

  return result;
}

function keepRecentSnapshots(snapshots) {
  const cutoff = Date.now() - 730 * 24 * 60 * 60 * 1000;
  return snapshots.filter((row) => new Date(row.fetched_at).getTime() >= cutoff);
}

function buildIntraday(snapshots) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return snapshots.filter((row) => new Date(row.fetched_at).getTime() >= cutoff);
}

function buildMonthly(snapshots) {
  const buckets = new Map();
  snapshots.forEach((row) => {
    const bucket = row.fetched_at.slice(0, 7);
    buckets.set(bucket, { bucket, fetched_at: row.fetched_at, price: row.price });
  });
  return Array.from(buckets.values()).sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));
}

function buildDaily(snapshots) {
  const grouped = new Map();
  snapshots.forEach((row) => {
    const key = row.fetched_at.slice(0, 10);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => new Date(b[0]) - new Date(a[0]))
    .slice(0, 60)
    .map(([date, rows]) => {
      const ordered = [...rows].sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));
      const prices = ordered.map((row) => row.price);
      const open = ordered[0].price;
      const close = ordered[ordered.length - 1].price;
      const low = Math.min(...prices);
      const high = Math.max(...prices);
      const average = Number((prices.reduce((sum, value) => sum + value, 0) / prices.length).toFixed(2));
      const delta = Number((close - open).toFixed(2));
      const deltaPercent = Number(((delta / open) * 100).toFixed(2));
      return { date, open, close, low, high, average, points: ordered.length, delta, deltaPercent };
    });
}

function buildSummary(snapshots) {
  const latest = snapshots[snapshots.length - 1] || null;
  if (!latest) {
    return {
      latest: null,
      change24h: null,
      dailyRange: null,
      nextRefreshMinutes: 5
    };
  }

  const latestTime = new Date(latest.fetched_at).getTime();
  const intraday = snapshots.filter((row) => latestTime - new Date(row.fetched_at).getTime() <= 24 * 60 * 60 * 1000);
  const prior = intraday[0] || latest;
  const changeAbsolute = Number((latest.price - prior.price).toFixed(2));
  const changePercent = Number((((latest.price - prior.price) / prior.price) * 100).toFixed(2));
  const rangePrices = intraday.map((row) => row.price);

  return {
    latest,
    change24h: {
      absolute: changeAbsolute,
      percent: changePercent
    },
    dailyRange: {
      low: Math.min(...rangePrices),
      high: Math.max(...rangePrices)
    },
    nextRefreshMinutes: 5
  };
}

function buildStatus(snapshots) {
  return {
    totalSnapshots: snapshots.length,
    firstSnapshotAt: snapshots[0] ? snapshots[0].fetched_at : null,
    latestSnapshotAt: snapshots[snapshots.length - 1] ? snapshots[snapshots.length - 1].fetched_at : null,
    refreshIntervalMinutes: 5,
    clientRefreshMinutes: 1,
    deploymentMode: 'static-vercel'
  };
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  const store = readJson(storePath, { snapshots: generateSeedSnapshots() });
  let snapshots = Array.isArray(store.snapshots) ? store.snapshots : generateSeedSnapshots();
  snapshots.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));

  try {
    const latestPoint = await fetchCurrentPrice();
    snapshots = ensureMinuteContinuity(snapshots, latestPoint);
  } catch (error) {
    console.warn(`Price fetch failed, keeping existing data: ${error.message}`);
  }

  snapshots = keepRecentSnapshots(snapshots);

  const intraday = buildIntraday(snapshots);
  const monthly = buildMonthly(snapshots);
  const daily = buildDaily(snapshots);
  const summary = buildSummary(snapshots);
  const status = buildStatus(snapshots);

  writeJson(storePath, { snapshots });
  writeJson(intradayPath, intraday);
  writeJson(monthlyPath, monthly);
  writeJson(dailyPath, daily);
  writeJson(summaryPath, summary);
  writeJson(statusPath, status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
