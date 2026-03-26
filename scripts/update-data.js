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
  const configs = {
    gold: {
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
      maxApiDeviation: 0.22,
      unit: 'oz',
      currency: 'USD'
    },
    silver: {
      metal: 'silver',
      symbol: 'XAG',
      prefix: 'silver_',
      baseLong: 23,
      baseIntraday: 31,
      monthlyWave: 1.6,
      dailyWave: 0.5,
      minuteWave: 0.35,
      hourWave: 0.55,
      drift: 0.004,
      maxApiDeviation: 0.3,
      unit: 'oz',
      currency: 'USD'
    },
    platinum: {
      metal: 'platinum',
      symbol: 'XPT',
      prefix: 'platinum_',
      baseLong: 980,
      baseIntraday: 1085,
      monthlyWave: 22,
      dailyWave: 7,
      minuteWave: 2.6,
      hourWave: 4.8,
      drift: 0.006,
      maxApiDeviation: 0.32,
      unit: 'oz',
      currency: 'USD'
    },
    palladium: {
      metal: 'palladium',
      symbol: 'XPD',
      prefix: 'palladium_',
      baseLong: 1180,
      baseIntraday: 1265,
      monthlyWave: 36,
      dailyWave: 10,
      minuteWave: 3.8,
      hourWave: 7.2,
      drift: 0.008,
      maxApiDeviation: 0.35,
      unit: 'oz',
      currency: 'USD'
    }
  };

  return configs[metal];
}

function pathsFor(prefix) {
  return {
    store: path.join(dataDir, `${prefix}store.json`),
    summary: path.join(dataDir, `${prefix}summary.json`),
    status: path.join(dataDir, `${prefix}status.json`),
    intraday: path.join(dataDir, `${prefix}intraday.json`),
    monthly: path.join(dataDir, `${prefix}monthly.json`),
    daily: path.join(dataDir, `${prefix}daily.json`),
    opinions: path.join(dataDir, `${prefix}opinions.json`)
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

function pickNumeric(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const num = Number(value[key]);
    if (!Number.isNaN(num) && Number.isFinite(num)) return num;
  }
  return null;
}

async function fetchFromAlapiGold(config) {
  if (config.metal !== 'gold') throw new Error('ALAPI gold endpoint only supports gold');
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
    throw new Error(`ALAPI currency not USD: ${currency}`);
  }
  if (unit && !(unit.includes('oz') || unit.includes('ounce'))) {
    throw new Error(`ALAPI unit not oz: ${unit}`);
  }

  return {
    fetched_at: isoMinute(parseTimestamp(entry.time || entry.timestamp || entry.updated_at || new Date())),
    price: Number(price),
    source: 'v3.alapi.cn',
    source_mode: 'api',
    currency: 'USD',
    unit: 'oz',
    metal: config.metal
  };
}

async function fetchFromGoldApiDotCom(config) {
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

async function fetchCurrentPrice(config) {
  const preferred = (process.env.PRICE_SOURCE_MODE || 'alapi').toLowerCase();
  const order = preferred === 'goldapi_com'
    ? [fetchFromGoldApiDotCom, fetchFromAlapiGold]
    : [fetchFromAlapiGold, fetchFromGoldApiDotCom];

  let lastError = null;
  for (const attempt of order) {
    try {
      return await attempt(config);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No price source available.');
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
    return { latest: null, change24h: null, dailyRange: null, nextRefreshMinutes: 1 };
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
    nextRefreshMinutes: 1
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function isAnomalousAgainstBaseline(price, baseline, maxDeviation) {
  if (!baseline || baseline <= 0) return false;
  const deviation = Math.abs(price - baseline) / baseline;
  return deviation > maxDeviation;
}

function validateIncomingPoint(config, snapshots, latestPoint) {
  const recentWindow = snapshots.slice(-360).map((row) => Number(row.price)).filter(Number.isFinite);
  const baseline = median(recentWindow);
  if (isAnomalousAgainstBaseline(latestPoint.price, baseline, config.maxApiDeviation)) {
    console.warn(
      `[${config.symbol}] incoming point rejected as anomaly: price=${latestPoint.price}, baseline=${baseline?.toFixed(4)}`
    );
    return null;
  }
  return latestPoint;
}

function pruneTailAnomalies(config, snapshots) {
  const rows = [...snapshots];
  let removed = 0;

  while (rows.length > 500) {
    const last = rows[rows.length - 1];
    if (!last || last.source_mode !== 'api') break;
    const baselineWindow = rows.slice(-241, -1).map((row) => Number(row.price)).filter(Number.isFinite);
    const baseline = median(baselineWindow);
    if (!isAnomalousAgainstBaseline(last.price, baseline, config.maxApiDeviation)) break;
    rows.pop();
    removed += 1;
  }

  if (removed > 0) {
    console.warn(`[${config.symbol}] pruned ${removed} anomalous tail point(s) from store`);
  }
  return rows;
}

function buildStatus(snapshots, metalLabel) {
  return {
    metal: metalLabel,
    totalSnapshots: snapshots.length,
    firstSnapshotAt: snapshots[0] ? snapshots[0].fetched_at : null,
    latestSnapshotAt: snapshots[snapshots.length - 1] ? snapshots[snapshots.length - 1].fetched_at : null,
    refreshIntervalMinutes: 1,
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
  snapshots = pruneTailAnomalies(config, snapshots);

  try {
    const latestPoint = await fetchCurrentPrice(config);
    const acceptedPoint = validateIncomingPoint(config, snapshots, latestPoint);
    if (acceptedPoint) {
      snapshots = ensureMinuteContinuity(snapshots, acceptedPoint);
    }
  } catch (error) {
    console.warn(`[${config.symbol}] fetch failed, keeping existing data: ${error.message}`);
  }

  snapshots = keepRecentSnapshots(snapshots);
  writeCommodityData(config, snapshots);
}

function seedMarketAdvice() {
  return [
    { date: '2026-03-24', region: '国际', metal: 'gold', institution: 'World Gold Council', expert: 'WGC Research Team', view: '全球央行购金需求仍具韧性，若实际利率回落，黄金配置需求有望继续提高。', bias: '偏多', link: 'https://www.gold.org/' },
    { date: '2026-03-22', region: '国际', metal: 'gold', institution: 'Citi Commodities', expert: 'Kenny Hu 团队', view: '金价短期处于高波动区间，地缘事件驱动仍可能触发快速上冲。', bias: '高位震荡', link: 'https://www.citigroup.com/' },
    { date: '2026-03-20', region: '国内', metal: 'gold', institution: '中信期货研究所', expert: '贵金属组', view: '人民币金价在汇率扰动下弹性更大，建议关注内外盘价差修复机会。', bias: '中性偏多', link: 'https://www.citicsf.com/' },
    { date: '2026-03-17', region: '国内', metal: 'gold', institution: '国泰君安期货', expert: '有色贵金属团队', view: '黄金中期上行逻辑未坏，但高位追涨性价比下降，建议分批布局。', bias: '中性', link: 'https://www.gtjaqh.com/' },
    { date: '2026-03-15', region: '国际', metal: 'gold', institution: 'UBS Global Research', expert: 'Macro Strategy Desk', view: '若美国经济动能放缓，黄金作为组合稳定器的配置比例可能继续抬升。', bias: '偏多', link: 'https://www.ubs.com/' },
    { date: '2026-03-12', region: '国际', metal: 'gold', institution: 'Reuters Poll', expert: 'Analysts Panel', view: '调查显示多数机构维持 2026 年黄金均价上修预期，但上行斜率趋缓。', bias: '情景分化', link: 'https://www.reuters.com/' },

    { date: '2026-03-25', region: '国际', metal: 'silver', institution: 'CME Metals', expert: 'Derivatives Analytics', view: '白银受工业链与货币属性双重驱动，短线波动率明显高于黄金。', bias: '高位震荡', link: 'https://www.cmegroup.com/' },
    { date: '2026-03-23', region: '国内', metal: 'silver', institution: '南华期货研究院', expert: '有色研究员', view: '光伏与电子需求韧性对白银形成中期支撑，但需警惕美元走强冲击。', bias: '中性偏多', link: 'https://www.nanhua.net/' },
    { date: '2026-03-21', region: '国际', metal: 'silver', institution: 'LBMA', expert: 'Market Intelligence', view: '白银投资需求边际回升，若宏观风险上行，金银比或进一步回落。', bias: '偏多', link: 'https://www.lbma.org.uk/' },
    { date: '2026-03-19', region: '国内', metal: 'silver', institution: '华泰期货', expert: '贵金属组', view: '白银短期走势偏交易拥挤，建议以回调买入替代追高。', bias: '中性', link: 'https://www.htfc.com/' },
    { date: '2026-03-14', region: '国际', metal: 'silver', institution: 'Kitco', expert: 'Market Commentators', view: '投机仓位继续抬升，若通胀预期回升，白银弹性可能优于黄金。', bias: '偏多', link: 'https://www.kitco.com/' },
    { date: '2026-03-10', region: '国内', metal: 'silver', institution: '银河期货', expert: '金属产业组', view: '工业需求恢复节奏决定白银持续性，建议关注库存去化确认信号。', bias: '情景分化', link: 'https://www.yhqh.com.cn/' },

    { date: '2026-03-24', region: '国际', metal: 'platinum', institution: 'WPIC', expert: 'Platinum Quarterly Team', view: '汽车催化与氢能链条需求对铂金形成中长期支撑，供给端扰动仍需关注。', bias: '偏多', link: 'https://platinuminvestment.com/' },
    { date: '2026-03-22', region: '国内', metal: 'platinum', institution: '金瑞期货', expert: '贵金属团队', view: '铂金估值修复仍在进行，但短期受美元波动影响较大。', bias: '中性偏多', link: 'https://www.jrqh.com.cn/' },
    { date: '2026-03-18', region: '国际', metal: 'platinum', institution: 'Bloomberg Intelligence', expert: 'Metals Strategist', view: '若欧洲车市复苏，铂金实物需求恢复将提升价格中枢。', bias: '偏多', link: 'https://www.bloomberg.com/' },
    { date: '2026-03-16', region: '国内', metal: 'platinum', institution: '中粮期货', expert: '有色组', view: '铂金波动相对可控，适合与黄金组合做跨品种对冲。', bias: '中性', link: 'https://www.cofcofutures.com/' },
    { date: '2026-03-13', region: '国际', metal: 'platinum', institution: 'Mitsubishi Research', expert: 'Precious Metals Desk', view: '矿端成本上移使铂金下方支撑增强，但上方仍受宏观利率压制。', bias: '高位震荡', link: 'https://www.mitsubishi.com/' },
    { date: '2026-03-09', region: '国内', metal: 'platinum', institution: '申银万国期货', expert: '贵金属策略组', view: '中期看铂金仍有补涨机会，建议通过分层仓位降低回撤。', bias: '中性偏多', link: 'https://www.sywgqh.com/' },

    { date: '2026-03-25', region: '国际', metal: 'palladium', institution: 'Johnson Matthey', expert: 'PGM Market Team', view: '钯金供需缺口较前期收敛，但地缘与矿山扰动仍可能放大波动。', bias: '高位震荡', link: 'https://matthey.com/' },
    { date: '2026-03-23', region: '国内', metal: 'palladium', institution: '广发期货', expert: '有色研究员', view: '钯金弹性较高，适合事件驱动交易，趋势仓位需严格风控。', bias: '中性', link: 'https://www.gfqh.com.cn/' },
    { date: '2026-03-21', region: '国际', metal: 'palladium', institution: 'Saxo Bank', expert: 'Commodity Strategy', view: '若汽车行业补库启动，钯金可能出现阶段性脉冲行情。', bias: '偏多', link: 'https://www.home.saxo/' },
    { date: '2026-03-19', region: '国内', metal: 'palladium', institution: '东证期货', expert: '贵金属组', view: '钯金当前交易结构偏短线，建议以区间思路应对。', bias: '高位震荡', link: 'https://www.orientfutures.com/' },
    { date: '2026-03-15', region: '国际', metal: 'palladium', institution: 'Fastmarkets', expert: 'PGM Analysts', view: '在替代效应持续下，钯金中期需求增速受限，价格上行更依赖供应端。', bias: '中性', link: 'https://www.fastmarkets.com/' },
    { date: '2026-03-11', region: '国内', metal: 'palladium', institution: '方正中期期货', expert: '产业研究组', view: '钯金走势受汽车链条预期牵引明显，建议关注产销数据节奏。', bias: '情景分化', link: 'https://www.founderfu.com/' },

    { date: '2026-03-08', region: '国际', metal: 'gold', institution: 'ING Research', expert: 'Commodity Economists', view: '美元若进入震荡偏弱阶段，将继续为黄金提供配置窗口。', bias: '偏多', link: 'https://think.ing.com/' },
    { date: '2026-03-07', region: '国内', metal: 'gold', institution: '永安期货', expert: '宏观与贵金属组', view: '黄金仍是组合防守资产，建议与利率债策略联动观察。', bias: '中性偏多', link: 'https://www.yafco.com/' },
    { date: '2026-02-28', region: '国内', metal: 'gold', institution: '中金公司研究部', expert: '大类资产团队', view: '黄金在全球不确定性提升阶段具备组合稳定作用，建议作为中长期配置底仓。', bias: '偏多', link: 'https://www.cicc.com/' },
    { date: '2026-02-24', region: '国内', metal: 'gold', institution: '中信建投期货', expert: '贵金属策略组', view: '若美债实际利率下行延续，黄金价格中枢仍有抬升空间。', bias: '中性偏多', link: 'https://www.cfc108.com/' },
    { date: '2026-02-19', region: '国内', metal: 'gold', institution: '光大期货', expert: '有色与贵金属组', view: '短线黄金可能维持高位震荡，建议逢回调分批布局而非追高。', bias: '高位震荡', link: 'https://www.ebfcn.com/' },
    { date: '2026-02-15', region: '国内', metal: 'gold', institution: '广发期货研究中心', expert: '宏观商品组', view: '黄金仍受避险需求支撑，关注人民币汇率对内盘金价弹性的放大效应。', bias: '偏多', link: 'https://www.gfqh.cn/' },
    { date: '2026-02-10', region: '国内', metal: 'gold', institution: '一德期货', expert: '贵金属分析师', view: '黄金中期逻辑偏多不变，但建议通过仓位管理应对事件驱动波动。', bias: '中性偏多', link: 'https://www.ydfut.com/' },
    { date: '2026-02-06', region: '国内', metal: 'gold', institution: '华安期货', expert: '金属研究中心', view: '在外部风险抬头背景下，黄金仍有防御价值，节奏上关注政策预期变化。', bias: '中性', link: 'https://www.hafco.com/' },
    { date: '2026-02-02', region: '国内', metal: 'gold', institution: '浙商期货', expert: '贵金属团队', view: '黄金波动率抬升阶段更适合分段交易，趋势单需设置动态止盈。', bias: '高位震荡', link: 'https://www.cnzsqh.com/' },
    { date: '2026-01-29', region: '国内', metal: 'gold', institution: '国信期货', expert: '有色与贵金属组', view: '金价对美元和实际利率敏感度仍高，建议联动宏观数据做方向确认。', bias: '中性', link: 'https://www.guosenqh.com.cn/' },
    { date: '2026-01-23', region: '国内', metal: 'gold', institution: '东吴期货', expert: '商品研究部', view: '黄金回撤幅度可控时，配置性资金大概率继续入场，支撑中期趋势。', bias: '中性偏多', link: 'https://www.dwfutures.com/' },
    { date: '2026-01-18', region: '国内', metal: 'gold', institution: '新湖期货', expert: '贵金属研究员', view: '黄金在地缘与流动性双因素扰动下，短期或反复但中期重心仍偏上。', bias: '偏多', link: 'https://www.xinhu.cn/' },
    { date: '2026-03-06', region: '国际', metal: 'silver', institution: 'Morgan Stanley', expert: 'Global Metals Team', view: '白银需等待工业需求确认后再打开新一轮趋势空间。', bias: '中性', link: 'https://www.morganstanley.com/' },
    { date: '2026-03-05', region: '国内', metal: 'silver', institution: '国投安信期货', expert: '商品研究部', view: '若制造业景气回升，白银回调后的配置价值会更明显。', bias: '中性偏多', link: 'https://www.sdicessence.com.cn/' },
    { date: '2026-03-04', region: '国际', metal: 'platinum', institution: 'Reuters Commodities', expert: 'Market Desk', view: '铂金在贵金属中估值相对不高，具备中期修复潜力。', bias: '偏多', link: 'https://www.reuters.com/' },
    { date: '2026-03-03', region: '国内', metal: 'platinum', institution: '中辉期货', expert: '贵金属研究员', view: '铂金交易活跃度提升，但应避免在突发消息后盲目追涨。', bias: '高位震荡', link: 'https://www.zhqh.com/' },
    { date: '2026-03-02', region: '国际', metal: 'palladium', institution: 'TD Securities', expert: 'Commodity Strategy', view: '钯金中期方向仍偏震荡，供给侧风险是核心变量。', bias: '中性', link: 'https://www.tdsecurities.com/' },
    { date: '2026-03-01', region: '国内', metal: 'palladium', institution: '海通期货', expert: '产业策略团队', view: '钯金短期反弹节奏快，建议通过分批止盈管理波动风险。', bias: '高位震荡', link: 'https://www.htfutures.com/' }
  ];
}

function writeMarketAdviceData() {
  const marketFile = path.join(dataDir, 'market_advice.json');
  const rows = seedMarketAdvice().sort((a, b) => new Date(b.date) - new Date(a.date));
  writeJson(marketFile, rows);

  const prefixes = {
    gold: '',
    silver: 'silver_',
    platinum: 'platinum_',
    palladium: 'palladium_'
  };

  Object.entries(prefixes).forEach(([metal, prefix]) => {
    const opinions = rows.filter((item) => item.metal === metal);
    const target = path.join(dataDir, `${prefix}opinions.json`);
    writeJson(target, opinions);
  });
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  await processCommodity('gold');
  await processCommodity('silver');
  await processCommodity('platinum');
  await processCommodity('palladium');

  writeMarketAdviceData();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
