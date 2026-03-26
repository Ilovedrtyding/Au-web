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
    params: { token, market: 'LF' }
  });

  if (!response.data) {
    throw new Error('ALAPI did not return payload');
  }

  const payload = response.data.data ?? response.data;
  let entry = payload;
  if (Array.isArray(payload)) {
    const prefer = process.env.ALAPI_GOLD_TYPE;
    if (prefer) {
      entry = payload.find((item) => [item.name, item.type, item.title, item.brand, item.symbol].includes(prefer)) || payload[0];
    } else {
      entry = payload.find((item) => {
        const unit = (item.unit || item.units || '').toString().toLowerCase();
        const currency = (item.currency || item.money || item.currency_code || '').toString().toUpperCase();
        return (currency === 'USD' || currency === '$') && (unit.includes('oz') || unit.includes('ounce'));
      }) || payload[0];
    }
  }

  const price = pickNumeric(entry, ['price', 'now_price', 'new_price', 'last_price', 'latest_price', 'latest', 'value', 'price_usd', 'usd_price']);
  if (!Number.isFinite(price)) {
    throw new Error('ALAPI did not provide numeric price');
  }

  const unit = (entry.unit || entry.units || '').toString().toLowerCase();
  const currency = (entry.currency || entry.money || entry.currency_code || 'USD').toString().toUpperCase();
  if (currency !== 'USD' && currency !== '$') {
    throw new Error('ALAPI currency not USD: ' + currency);
  }
  if (unit && !(unit.includes('oz') || unit.includes('ounce'))) {
    throw new Error('ALAPI unit not oz: ' + unit);
  }

  return {
    source: 'v3.alapi.cn',
    sourceMode: 'api',
    symbol: 'XAU',
    currency: 'USD',
    unit: 'oz',
    price: Number(price),
    fetchedAt: parseTimestamp(entry.time || entry.timestamp || entry.updated_at || new Date()).toISOString(),
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
  const attempts = preferredMode === 'goldapi_com'
    ? [fetchFromGoldApi, fetchFromAlapiGold, fetchFromScraper]
    : [fetchFromAlapiGold, fetchFromGoldApi, fetchFromScraper];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No price source available.');
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
  const minuteWave = Math.sin(minuteOffset / 37) * 4.8;
  const hourWave = Math.cos(minuteOffset / 180) * 8.5;
  const trend = minuteOffset * 0.012;
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

  const basePrice = latest?.price || 2435;
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
        'XAU',
        'USD',
        'oz',
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
          const monthlyWave = Math.sin(day / 28) * 48;
          const dailyWave = Math.cos((hour / 24) * Math.PI * 2) * 12;
          const drift = (720 - day) * 0.48;
          const price = Number((2080 + drift + monthlyWave + dailyWave).toFixed(2));

          insert.run('seeded-history', 'seed', 'XAU', 'USD', 'oz', price, timestamp.toISOString(), JSON.stringify({ seeded: true }));
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
