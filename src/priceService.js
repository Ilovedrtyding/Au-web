const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
  Accept: 'text/html,application/json'
};

function pickNumeric(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const num = Number(value[key]);
    if (!Number.isNaN(num) && Number.isFinite(num)) return num;
  }
  return null;
}

function pickNumericDeep(value, preferredKeys = []) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    const direct = Number(normalized);
    if (!Number.isNaN(direct) && Number.isFinite(direct)) return direct;
    const matched = normalized.match(/-?\d+(?:\.\d+)?/);
    if (matched) {
      const parsed = Number(matched[0]);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return parsed;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickNumericDeep(item, preferredKeys);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of preferredKeys) {
      const found = pickNumericDeep(value[key], preferredKeys);
      if (found !== null) return found;
    }
    for (const [key, current] of Object.entries(value)) {
      if (preferredKeys.includes(key)) continue;
      const found = pickNumericDeep(current, preferredKeys);
      if (found !== null) return found;
    }
  }
  return null;
}

function unwrapAlapiEntry(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return payload;
  const nestedKeys = ['list', 'items', 'data', 'result'];
  for (const key of nestedKeys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return unwrapAlapiEntry(payload[key]);
    }
  }
  return payload;
}

function collectNumericCandidates(value, preferredKeys = [], acc = []) {
  if (value === null || value === undefined) return acc;
  if (typeof value === 'number' && Number.isFinite(value)) {
    acc.push(value);
    return acc;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    const direct = Number(normalized);
    if (!Number.isNaN(direct) && Number.isFinite(direct)) {
      acc.push(direct);
      return acc;
    }
    const matched = normalized.match(/-?d+(?:.d+)?/);
    if (matched) {
      const parsed = Number(matched[0]);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) acc.push(parsed);
    }
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumericCandidates(item, preferredKeys, acc));
    return acc;
  }
  if (typeof value === 'object') {
    preferredKeys.forEach((key) => {
      if (key in value) collectNumericCandidates(value[key], preferredKeys, acc);
    });
    Object.entries(value).forEach(([key, current]) => {
      if (preferredKeys.includes(key)) return;
      collectNumericCandidates(current, preferredKeys, acc);
    });
  }
  return acc;
}

function selectPlausibleGoldPrice(entry) {
  const preferredKeys = ['price', 'now_price', 'new_price', 'last_price', 'latest_price', 'latest', 'value', 'price_usd', 'usd_price', 'bp_price', 'toprice'];
  const direct = pickNumericDeep(entry, preferredKeys);
  const candidates = collectNumericCandidates(entry, preferredKeys, [])
    .filter((value) => value > 1000 && value < 5000)
    .sort((a, b) => Math.abs(a - 2500) - Math.abs(b - 2500));

  if (candidates.length) return candidates[0];
  return direct;
}

function parseTimestamp(value) {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    return new Date(asNumber * 1000);
  }
  return new Date();
}

async function fetchFromGoldApi() {
  const response = await axios.get('https://api.gold-api.com/price/XAU', {
    headers: DEFAULT_HEADERS,
    timeout: 15000
  });

  if (!response.data?.price) {
    throw new Error('Public API returned an invalid payload.');
  }

  return {
    source: 'api.gold-api.com',
    sourceMode: 'api',
    symbol: response.data.symbol || 'XAU',
    currency: 'USD',
    unit: 'oz',
    price: Number(response.data.price),
    fetchedAt: response.data.updatedAt || new Date().toISOString(),
    rawPayload: response.data
  };
}

async function fetchFromAlapiGold() {
  const token = process.env.ALAPI_TOKEN;
  if (!token) throw new Error('ALAPI_TOKEN not set');

  const response = await axios.get('https://v3.alapi.cn/api/gold', {
    headers: DEFAULT_HEADERS,
    timeout: 15000,
    params: { token, market: process.env.ALAPI_MARKET || 'LF' }
  });

  if (!response.data?.success || !Array.isArray(response.data.data)) {
    throw new Error('ALAPI did not return payload');
  }

  const entry = response.data.data.find((item) => String(item.symbol || '').toLowerCase() === 'au');
  if (!entry) throw new Error('ALAPI did not return Au quote');

  const price = pickNumeric(entry, ['buy_price', 'sell_price', 'high_price', 'low_price']);
  if (!Number.isFinite(price)) throw new Error('ALAPI did not provide numeric price');

  return {
    source: 'v3.alapi.cn',
    sourceMode: 'api',
    symbol: 'Au',
    currency: 'CNY',
    unit: 'g',
    price: Number(price),
    fetchedAt: parseTimestamp(response.data.time || entry.time || entry.timestamp || entry.updated_at || new Date()).toISOString(),
    rawPayload: entry
  };
}

async function fetchFromScraper() {
  const response = await axios.get('https://www.livepriceofgold.com/', {
    headers: DEFAULT_HEADERS,
    timeout: 15000
  });

  const $ = cheerio.load(response.data);
  const text = $('body').text().replace(/\s+/g, ' ');
  const match = text.match(/Gold Price(?: in USD)?[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);

  if (!match) {
    throw new Error('Could not extract a gold price from scraper source.');
  }

  return {
    source: 'www.livepriceofgold.com',
    sourceMode: 'scraper',
    symbol: 'XAU',
    currency: 'USD',
    unit: 'oz',
    price: Number(match[1].replace(/,/g, '')),
    fetchedAt: new Date().toISOString(),
    rawPayload: {
      matchedText: match[0]
    }
  };
}

async function fetchCurrentPrice() {
  const preferredMode = (process.env.PRICE_SOURCE_MODE || 'alapi').toLowerCase();
  if (preferredMode === 'alapi') {
    return fetchFromAlapiGold();
  }
  if (preferredMode === 'goldapi_com') {
    return fetchFromGoldApi();
  }
  return fetchFromScraper();
}

function insertSnapshot(db, snapshot) {
  db.prepare(`
    INSERT INTO price_snapshots (
      source,
      source_mode,
      symbol,
      currency,
      unit,
      price,
      fetched_at,
      raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.source,
    snapshot.sourceMode,
    snapshot.symbol,
    snapshot.currency,
    snapshot.unit,
    snapshot.price,
    snapshot.fetchedAt,
    JSON.stringify(snapshot.rawPayload)
  );

  return snapshot;
}

async function refreshPrices(db) {
  const snapshot = await fetchCurrentPrice();
  return insertSnapshot(db, snapshot);
}

function generateSeedPrice(basePrice, minuteOffset) {
  const minuteWave = Math.sin(minuteOffset / 37) * 2.2;
  const hourWave = Math.cos(minuteOffset / 180) * 4.2;
  const trend = minuteOffset * 0.002;
  return Number((basePrice + minuteWave + hourWave + trend).toFixed(2));
}

function backfillMinuteHistory(db) {
  const recentCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM price_snapshots
    WHERE fetched_at >= datetime('now', '-24 hours')
  `).get().total;

  if (recentCount >= 1200) {
    return;
  }

  const latest = db.prepare(`
    SELECT price
    FROM price_snapshots
    ORDER BY fetched_at DESC
    LIMIT 1
  `).get();

  const basePrice = latest?.price || 1002.1;
  const existingBuckets = new Set(
    db.prepare(`
      SELECT strftime('%Y-%m-%dT%H:%M:00Z', fetched_at) AS minute_bucket
      FROM price_snapshots
      WHERE fetched_at >= datetime('now', '-24 hours')
      GROUP BY minute_bucket
    `).all().map((row) => row.minute_bucket)
  );

  const insert = db.prepare(`
    INSERT INTO price_snapshots (
      source,
      source_mode,
      symbol,
      currency,
      unit,
      price,
      fetched_at,
      raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  const transaction = db.transaction(() => {
    for (let minute = 1440; minute >= 1; minute -= 1) {
      const timestamp = new Date(now.getTime() - minute * 60 * 1000);
      const bucket = timestamp.toISOString().slice(0, 16) + ':00Z';
      if (existingBuckets.has(bucket)) {
        continue;
      }

      const offset = 1440 - minute;
      insert.run(
        'seeded-history',
        'seed',
        'Au',
        'CNY',
        'g',
        generateSeedPrice(basePrice - 10, offset),
        bucket,
        JSON.stringify({ seeded: true, granularity: 'minute-backfill' })
      );
    }
  });

  transaction();
}

async function seedHistory(db) {
  const count = db.prepare('SELECT COUNT(*) AS total FROM price_snapshots').get().total;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO price_snapshots (
        source,
        source_mode,
        symbol,
        currency,
        unit,
        price,
        fetched_at,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const transaction = db.transaction(() => {
      for (let day = 720; day >= 2; day -= 1) {
        for (const hour of [0, 6, 12, 18]) {
          const timestamp = new Date(now - ((day * 24) + (18 - hour)) * 60 * 60 * 1000);
          const monthlyWave = Math.sin(day / 28) * 26;
          const dailyWave = Math.cos((hour / 24) * Math.PI * 2) * 8;
          const drift = (720 - day) * 0.18;
          const price = Number((768 + drift + monthlyWave + dailyWave).toFixed(2));

          insert.run('seeded-history', 'seed', 'Au', 'CNY', 'g', price, timestamp.toISOString(), JSON.stringify({ seeded: true }));
        }
      }
    });

    transaction();
  }

  backfillMinuteHistory(db);
}

async function startScheduler(db) {
  await seedHistory(db);

  try {
    await refreshPrices(db);
  } catch (error) {
    console.error('Initial refresh failed:', error.message);
  }

  cron.schedule('* * * * *', async () => {
    try {
      const snapshot = await refreshPrices(db);
      console.log(`Snapshot saved: ${snapshot.price} ${snapshot.currency}/${snapshot.unit} at ${snapshot.fetchedAt}`);
    } catch (error) {
      console.error('Scheduled refresh failed:', error.message);
    }
  });
}

module.exports = {
  fetchCurrentPrice,
  refreshPrices,
  startScheduler
};




