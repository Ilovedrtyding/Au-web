const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl ? window.APP_CONFIG.apiBaseUrl : '').replace(/\/$/, '');
const SVG_NS = 'http://www.w3.org/2000/svg';
let staticMode = false;

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function staticPathFor(path) {
  const mapping = {
    '/api/summary': './data/summary.json',
    '/api/status': './data/status.json',
    '/api/chart/intraday': './data/intraday.json',
    '/api/chart/monthly?months=120': './data/monthly.json',
    '/api/history/daily?days=45': './data/daily.json'
  };
  return mapping[path] || null;
}

function formatPrice(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '--';
  }
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';
}

function setText(id, value, className = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className = className;
}

async function fetchJson(path, options) {
  try {
    const response = await fetch(apiUrl(path), options);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    staticMode = false;
    return response.json();
  } catch (error) {
    const fallbackPath = staticPathFor(path);
    if (!fallbackPath) throw error;
    const fallback = await fetch(fallbackPath, { cache: 'no-store' });
    if (!fallback.ok) throw error;
    staticMode = true;
    return fallback.json();
  }
}

function createSvgNode(tag, attrs = {}, text = '') {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}

function createTicks(min, max, count) {
  const span = max - min || 1;
  return Array.from({ length: count }, (_, index) => min + (span * index) / (count - 1));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function renderLineChart(svgId, rows, options) {
  const svg = document.getElementById(svgId);
  if (!svg) return null;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const width = 960;
  const height = 360;
  const margin = { top: 22, right: 18, bottom: 54, left: 78 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  if (!rows || rows.length < 2) {
    svg.appendChild(createSvgNode('text', { x: width / 2, y: height / 2, class: 'chart-empty' }, '暂无足够数据绘制趋势图'));
    return null;
  }

  const values = rows.map((row) => Number(row.price));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.08, maxValue * 0.0025, 1);
  const min = minValue - padding;
  const max = maxValue + padding;
  const span = max - min || 1;

  const xAt = (index) => margin.left + (index / (rows.length - 1)) * plotWidth;
  const yAt = (value) => margin.top + plotHeight - ((value - min) / span) * plotHeight;

  const yTicks = createTicks(min, max, options.yTickCount || 6);
  const xTickIndexes = uniqueSorted(options.xTickIndexes(rows));

  yTicks.forEach((tick, index) => {
    const y = yAt(tick);
    svg.appendChild(createSvgNode('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: index === yTicks.length - 1 ? 'chart-grid-strong' : 'chart-grid'
    }));
    svg.appendChild(createSvgNode('text', {
      x: margin.left - 10,
      y: y + 4,
      'text-anchor': 'end',
      class: 'chart-label'
    }, options.yLabelFormatter(tick)));
  });

  xTickIndexes.forEach((index) => {
    const x = xAt(index);
    svg.appendChild(createSvgNode('line', {
      x1: x,
      y1: margin.top,
      x2: x,
      y2: height - margin.bottom,
      class: 'chart-grid'
    }));
    svg.appendChild(createSvgNode('text', {
      x,
      y: height - 16,
      'text-anchor': 'middle',
      class: 'chart-label'
    }, options.xLabelFormatter(rows[index], index)));
  });

  svg.appendChild(createSvgNode('line', { x1: margin.left, y1: margin.top, x2: margin.left, y2: height - margin.bottom, class: 'chart-axis' }));
  svg.appendChild(createSvgNode('line', { x1: margin.left, y1: height - margin.bottom, x2: width - margin.right, y2: height - margin.bottom, class: 'chart-axis' }));

  const linePoints = rows.map((row, index) => `${xAt(index)},${yAt(Number(row.price))}`).join(' ');
  const areaPoints = `${margin.left},${height - margin.bottom} ${linePoints} ${width - margin.right},${height - margin.bottom}`;
  svg.appendChild(createSvgNode('polygon', { points: areaPoints, class: options.areaClass }));
  svg.appendChild(createSvgNode('polyline', { points: linePoints, class: options.lineClass }));

  const pointIndexes = uniqueSorted(options.pointIndexes(rows));
  pointIndexes.forEach((index) => {
    const row = rows[index];
    const circle = createSvgNode('circle', {
      cx: xAt(index),
      cy: yAt(Number(row.price)),
      r: options.pointRadius || 1.4,
      fill: options.pointColor,
      class: 'chart-point'
    });
    circle.appendChild(createSvgNode('title', {}, `${options.tooltipTitle(row)}\n${formatPrice(row.price)}\n${formatDateTime(row.fetched_at)}`));
    svg.appendChild(circle);
  });

  return {
    minValue,
    maxValue,
    points: rows.length,
    firstLabel: options.tooltipTitle(rows[0]),
    lastLabel: options.tooltipTitle(rows[rows.length - 1])
  };
}

async function loadSummary() {
  const [summary, status] = await Promise.all([fetchJson('/api/summary'), fetchJson('/api/status')]);

  if (summary.latest) {
    setText('latestPrice', `${formatPrice(summary.latest.price)} / ${summary.latest.unit}`);
    setText('lastUpdated', `最近更新：${formatDateTime(summary.latest.fetched_at)} · 来源：${summary.latest.source_mode}`);
  } else {
    setText('latestPrice', '--');
    setText('lastUpdated', '暂无数据');
  }

  if (summary.change24h) {
    const className = summary.change24h.absolute >= 0 ? 'positive' : 'negative';
    setText('change24h', `${summary.change24h.absolute >= 0 ? '+' : ''}${formatPrice(summary.change24h.absolute)}`, className);
    setText('change24hPercent', `${summary.change24h.percent >= 0 ? '+' : ''}${summary.change24h.percent}%`, className);
  } else {
    setText('change24h', '--');
    setText('change24hPercent', '--');
  }

  const hasRange = summary.dailyRange && summary.dailyRange.low !== null && summary.dailyRange.high !== null;
  setText('dailyRange', hasRange ? `${formatPrice(summary.dailyRange.low)} - ${formatPrice(summary.dailyRange.high)}` : '--');
  setText('totalSnapshots', String(status.totalSnapshots ?? '--'));
  setText('firstSnapshotAt', formatDateTime(status.firstSnapshotAt));
  setText('latestSnapshotAt', formatDateTime(status.latestSnapshotAt));
  setText('modeHint', staticMode ? '当前为 Vercel 静态模式，数据由 GitHub Actions 定时更新。' : '当前为本地/API 模式。');
}

async function loadIntradayChart() {
  const rows = await fetchJson('/api/chart/intraday');
  const info = renderLineChart('intradayChart', rows, {
    areaClass: 'chart-area-gold',
    lineClass: 'chart-line-gold',
    pointColor: '#f6c65b',
    pointRadius: 1.1,
    yTickCount: 7,
    yLabelFormatter(value) {
      return formatPrice(value, 0);
    },
    xTickIndexes(data) {
      const desired = 12;
      return Array.from({ length: desired }, (_, i) => Math.min(data.length - 1, Math.round((i * (data.length - 1)) / (desired - 1))));
    },
    pointIndexes(data) {
      const step = Math.max(1, Math.floor(data.length / 240));
      return data.map((_, index) => index).filter((index) => index % step === 0 || index === data.length - 1);
    },
    xLabelFormatter(row) {
      return new Date(row.fetched_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    },
    tooltipTitle(row) {
      return new Date(row.fetched_at).toLocaleString('zh-CN', { hour12: false });
    }
  });

  if (info) {
    setText('intradayMeta', `共 ${info.points} 个分钟点，完整绘制最近 24 小时走势；价格区间 ${formatPrice(info.minValue)} 到 ${formatPrice(info.maxValue)}。`);
  }
}

async function loadMonthlyChart() {
  const rows = await fetchJson('/api/chart/monthly?months=120');
  const info = renderLineChart('monthlyChart', rows, {
    areaClass: 'chart-area-teal',
    lineClass: 'chart-line-teal',
    pointColor: '#7ad3c8',
    pointRadius: 2.1,
    yTickCount: 7,
    yLabelFormatter(value) {
      return formatPrice(value, 0);
    },
    xTickIndexes(data) {
      return data.map((_, index) => index).filter((index) => index % Math.max(1, Math.ceil(data.length / 18)) === 0 || index === data.length - 1);
    },
    pointIndexes(data) {
      return data.map((_, index) => index);
    },
    xLabelFormatter(row) {
      return row.bucket;
    },
    tooltipTitle(row) {
      return `${row.bucket} 月度点`;
    }
  });

  if (info) {
    setText('monthlyMeta', `共 ${info.points} 个月度点，完整显示全部月份；价格区间 ${formatPrice(info.minValue)} 到 ${formatPrice(info.maxValue)}。`);
  }
}

async function loadHistoryTable() {
  const rows = await fetchJson('/api/history/daily?days=45');
  const tbody = document.getElementById('historyTable');
  tbody.innerHTML = rows.map((row) => {
    const className = Number(row.delta) >= 0 ? 'positive' : 'negative';
    const deltaText = `${row.delta >= 0 ? '+' : ''}${formatPrice(row.delta)} / ${row.deltaPercent >= 0 ? '+' : ''}${row.deltaPercent}%`;
    return `
      <tr>
        <td>${row.date}</td>
        <td>${formatPrice(row.open)}</td>
        <td>${formatPrice(row.close)}</td>
        <td>${formatPrice(row.high)}</td>
        <td>${formatPrice(row.low)}</td>
        <td>${formatPrice(row.average)}</td>
        <td class="${className}">${deltaText}</td>
        <td>${row.points}</td>
      </tr>
    `;
  }).join('');
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadIntradayChart(), loadMonthlyChart(), loadHistoryTable()]);
}

async function manualRefresh() {
  const button = document.getElementById('manualRefresh');
  button.disabled = true;
  button.textContent = '刷新中...';
  try {
    if (!staticMode) {
      await fetchJson('/api/refresh', { method: 'POST' });
    }
    await refreshAll();
  } catch (error) {
    await refreshAll();
  } finally {
    button.disabled = false;
    button.textContent = staticMode ? '重新读取页面数据' : '立即刷新数据';
  }
}

document.getElementById('manualRefresh').addEventListener('click', manualRefresh);
refreshAll().catch((error) => console.error('Dashboard refresh failed:', error));
setInterval(() => {
  refreshAll().catch((error) => console.error('Scheduled dashboard refresh failed:', error));
}, 60 * 1000);
