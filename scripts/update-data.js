const fs = require('fs');
const path = require('path');
const axios = require('axios');

const dataDir = path.join(__dirname, '..', 'public', 'data');

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

function getConfig(metal) {
  if (metal === 'silver') {
    return {
      metal,
      symbol: 'XAG',
      prefix: 'silver_',
      baseLong: 23,
      baseIntraday: 31,
      monthlyWave: 1.6,
      dailyWave: 0.5,
      minuteWave: 0.35,
      hourWave: 0.55,
      drift: 0.004,
      unit: 'oz',
      currency: 'USD'
    };
  }

  return {
    metal: 'gold',
    symbol: 'XAU',
    prefix: '',
    baseLong: 2080,
    baseIntraday: 2435,
    monthlyWave: 48,
    dailyWave: 12,
    minuteWave: 4.8,
    hourWave: 8.5,
    drift: 0.012,
    unit: 'oz',
    currency: 'USD'
  };
}

function pathsFor(prefix) {
  return {
    store: path.join(dataDir, `${prefix}store.json`),
    summary: path.join(dataDir, `${prefix}summary.json`),
    status: path.join(dataDir, `${prefix}status.json`),
    intraday: path.join(dataDir, `${prefix}intraday.json`),
    monthly: path.join(dataDir, `${prefix}monthly.json`),
    daily: path.join(dataDir, `${prefix}daily.json`)
  };
}

function generateSeedSnapshots(config) {
  const snapshots = [];
  const now = Date.now();

  for (let day = 720; day >= 2; day -= 1) {
    for (const hour of [0, 6, 12, 18]) {
      const timestamp = new Date(now - ((day * 24) + (18 - hour)) * 60 * 60 * 1000);
      const monthlyWave = Math.sin(day / 28) * config.monthlyWave;
      const dailyWave = Math.cos((hour / 24) * Math.PI * 2) * config.dailyWave;
      const drift = (720 - day) * (config.baseLong * 0.00023);
      const price = Number((config.baseLong + drift + monthlyWave + dailyWave).toFixed(4));
      snapshots.push({
        fetched_at: timestamp.toISOString(),
        price,
        source: 'seeded-history',
        source_mode: 'seed',
        currency: config.currency,
        unit: config.unit,
        metal: config.metal
      });
    }
  }

  for (let minute = 1440; minute >= 1; minute -= 1) {
    const timestamp = new Date(now - minute * 60 * 1000);
    const offset = 1440 - minute;
    const minuteWave = Math.sin(offset / 37) * config.minuteWave;
    const hourWave = Math.cos(offset / 180) * config.hourWave;
    const trend = offset * config.drift;
    const price = Number((config.baseIntraday + minuteWave + hourWave + trend).toFixed(4));
    snapshots.push({
      fetched_at: floorToMinute(timestamp).toISOString(),
      price,
      source: 'seeded-history',
      source_mode: 'seed',
      currency: config.currency,
      unit: config.unit,
      metal: config.metal
    });
  }

  snapshots.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));
  return snapshots;
}

async function fetchCurrentPrice(config) {
  const response = await axios.get(`https://api.gold-api.com/price/${config.symbol}`, {
    headers: DEFAULT_HEADERS,
    timeout: 15000
  });

  if (!response.data || !response.data.price) {
    throw new Error(`Price API returned invalid data for ${config.symbol}`);
  }

  return {
    fetched_at: isoMinute(response.data.updatedAt || new Date()),
    price: Number(response.data.price),
    source: 'api.gold-api.com',
    source_mode: 'api',
    currency: config.currency,
    unit: config.unit,
    metal: config.metal
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

  while (cursor < target) {
    result.push({
      ...last,
      fetched_at: new Date(cursor).toISOString(),
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
    if (!grouped.has(key)) grouped.set(key, []);
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
      const average = Number((prices.reduce((sum, value) => sum + value, 0) / prices.length).toFixed(4));
      const delta = Number((close - open).toFixed(4));
      const deltaPercent = Number(((delta / open) * 100).toFixed(2));
      return { date, open, close, low, high, average, points: ordered.length, delta, deltaPercent };
    });
}

function buildSummary(snapshots) {
  const latest = snapshots[snapshots.length - 1] || null;
  if (!latest) {
    return { latest: null, change24h: null, dailyRange: null, nextRefreshMinutes: 5 };
  }

  const latestTime = new Date(latest.fetched_at).getTime();
  const intraday = snapshots.filter((row) => latestTime - new Date(row.fetched_at).getTime() <= 24 * 60 * 60 * 1000);
  const prior = intraday[0] || latest;
  const changeAbsolute = Number((latest.price - prior.price).toFixed(4));
  const changePercent = Number((((latest.price - prior.price) / prior.price) * 100).toFixed(2));
  const rangePrices = intraday.map((row) => row.price);

  return {
    latest,
    change24h: { absolute: changeAbsolute, percent: changePercent },
    dailyRange: { low: Math.min(...rangePrices), high: Math.max(...rangePrices) },
    nextRefreshMinutes: 5
  };
}

function buildStatus(snapshots, metalLabel) {
  return {
    metal: metalLabel,
    totalSnapshots: snapshots.length,
    firstSnapshotAt: snapshots[0] ? snapshots[0].fetched_at : null,
    latestSnapshotAt: snapshots[snapshots.length - 1] ? snapshots[snapshots.length - 1].fetched_at : null,
    refreshIntervalMinutes: 5,
    clientRefreshMinutes: 1,
    deploymentMode: 'static-vercel'
  };
}

function writeCommodityData(config, snapshots) {
  const paths = pathsFor(config.prefix);
  const intraday = buildIntraday(snapshots);
  const monthly = buildMonthly(snapshots);
  const daily = buildDaily(snapshots);
  const summary = buildSummary(snapshots);
  const status = buildStatus(snapshots, config.metal);

  writeJson(paths.store, { snapshots });
  writeJson(paths.intraday, intraday);
  writeJson(paths.monthly, monthly);
  writeJson(paths.daily, daily);
  writeJson(paths.summary, summary);
  writeJson(paths.status, status);
}

async function processCommodity(metal) {
  const config = getConfig(metal);
  const paths = pathsFor(config.prefix);

  const store = readJson(paths.store, { snapshots: generateSeedSnapshots(config) });
  let snapshots = Array.isArray(store.snapshots) ? store.snapshots : generateSeedSnapshots(config);
  snapshots.sort((a, b) => new Date(a.fetched_at) - new Date(b.fetched_at));

  try {
    const latestPoint = await fetchCurrentPrice(config);
    snapshots = ensureMinuteContinuity(snapshots, latestPoint);
  } catch (error) {
    console.warn(`[${config.symbol}] fetch failed, keeping existing data: ${error.message}`);
  }

  snapshots = keepRecentSnapshots(snapshots);
  writeCommodityData(config, snapshots);
}

function ensureSilverOpinions() {
  const pathSilverOpinions = path.join(dataDir, 'silver_opinions.json');
  if (fs.existsSync(pathSilverOpinions)) return;

  const seed = [
    {
      date: '2026-03-10',
      institution: 'Bullion Research Desk',
      expert: '市场策略组',
      view: '白银波动通常高于黄金，若工业需求回升与避险情绪并存，价格弹性可能更明显。',
      bias: '中性偏多',
      link: 'https://www.lbma.org.uk/'
    },
    {
      date: '2026-02-21',
      institution: 'Commodities Macro Watch',
      expert: '跨资产研究员',
      view: '白银对美元与利率预期较敏感，短线应关注宏观数据落地节奏。',
      bias: '高位震荡',
      link: 'https://www.cmegroup.com/markets/metals/precious/silver.html'
    },
    {
      date: '2026-01-30',
      institution: 'Precious Metals Insight',
      expert: '贵金属组合团队',
      view: '若金银比持续回落，白银相对黄金可能阶段性占优。',
      bias: '偏多',
      link: 'https://www.kitco.com/silver-price-today-usa/'
    }
  ];

  writeJson(pathSilverOpinions, seed);
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  await processCommodity('gold');
  await processCommodity('silver');
  ensureSilverOpinions();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
