const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl ? window.APP_CONFIG.apiBaseUrl : '').replace(/\/$/, '');
const SVG_NS = 'http://www.w3.org/2000/svg';

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '--';
  }

  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
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
  const response = await fetch(apiUrl(path), options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function createSvgNode(tag, attrs = {}, text = '') {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) {
    node.textContent = text;
  }
  return node;
}

function renderLineChart(svgId, rows, options) {
  const svg = document.getElementById(svgId);
  if (!svg) return;

  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  const width = 960;
  const height = 360;
  const margin = { top: 22, right: 18, bottom: 44, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  if (!rows || rows.length < 2) {
    svg.appendChild(createSvgNode('text', { x: width / 2, y: height / 2, class: 'chart-empty' }, '暂无足够数据绘制趋势图'));
    return;
  }

  const values = rows.map((row) => Number(row.price));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const xAt = (index) => margin.left + (index / (rows.length - 1)) * plotWidth;
  const yAt = (value) => margin.top + plotHeight - ((value - min) / span) * plotHeight;

  [0, 0.25, 0.5, 0.75, 1].forEach((fraction) => {
    const y = margin.top + plotHeight * fraction;
    svg.appendChild(createSvgNode('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: 'chart-grid'
    }));
  });

  svg.appendChild(createSvgNode('line', {
    x1: margin.left,
    y1: margin.top,
    x2: margin.left,
    y2: height - margin.bottom,
    class: 'chart-axis'
  }));
  svg.appendChild(createSvgNode('line', {
    x1: margin.left,
    y1: height - margin.bottom,
    x2: width - margin.right,
    y2: height - margin.bottom,
    class: 'chart-axis'
  }));

  const linePoints = rows.map((row, index) => `${xAt(index)},${yAt(Number(row.price))}`).join(' ');
  const areaPoints = `${margin.left},${height - margin.bottom} ${linePoints} ${width - margin.right},${height - margin.bottom}`;

  svg.appendChild(createSvgNode('polygon', {
    points: areaPoints,
    class: options.areaClass
  }));
  svg.appendChild(createSvgNode('polyline', {
    points: linePoints,
    class: options.lineClass
  }));

  const markerIndexes = options.markerIndexes(rows.length);
  markerIndexes.forEach((index) => {
    const row = rows[index];
    svg.appendChild(createSvgNode('circle', {
      cx: xAt(index),
      cy: yAt(Number(row.price)),
      r: 3.5,
      fill: options.pointColor,
      class: 'chart-point'
    }));

    svg.appendChild(createSvgNode('text', {
      x: xAt(index),
      y: height - 12,
      'text-anchor': 'middle',
      class: 'chart-label'
    }, options.labelFormatter(row, index)));
  });

  [min, min + span / 2, max].forEach((value) => {
    svg.appendChild(createSvgNode('text', {
      x: 10,
      y: yAt(value) + 4,
      class: 'chart-label'
    }, formatPrice(value)));
  });
}

async function loadSummary() {
  const [summary, status] = await Promise.all([
    fetchJson('/api/summary'),
    fetchJson('/api/status')
  ]);

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
}

async function loadIntradayChart() {
  const rows = await fetchJson('/api/chart/intraday');
  renderLineChart('intradayChart', rows, {
    areaClass: 'chart-area-gold',
    lineClass: 'chart-line-gold',
    pointColor: '#f6c65b',
    markerIndexes(length) {
      const desired = 6;
      return Array.from({ length: desired }, (_, i) => Math.min(length - 1, Math.round((i * (length - 1)) / (desired - 1))));
    },
    labelFormatter(row) {
      return new Date(row.fetched_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  });
}

async function loadMonthlyChart() {
  const rows = await fetchJson('/api/chart/monthly?months=120');
  renderLineChart('monthlyChart', rows, {
    areaClass: 'chart-area-teal',
    lineClass: 'chart-line-teal',
    pointColor: '#7ad3c8',
    markerIndexes(length) {
      const step = Math.max(1, Math.floor(length / 6));
      const indexes = [];
      for (let index = 0; index < length; index += step) {
        indexes.push(index);
      }
      if (indexes[indexes.length - 1] !== length - 1) {
        indexes.push(length - 1);
      }
      return indexes;
    },
    labelFormatter(row) {
      return row.bucket;
    }
  });
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
  await Promise.all([
    loadSummary(),
    loadIntradayChart(),
    loadMonthlyChart(),
    loadHistoryTable()
  ]);
}

async function manualRefresh() {
  const button = document.getElementById('manualRefresh');
  button.disabled = true;
  button.textContent = '刷新中...';
  try {
    await fetchJson('/api/refresh', { method: 'POST' });
    await refreshAll();
  } catch (error) {
    alert(`刷新失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '立即刷新数据';
  }
}

document.getElementById('manualRefresh').addEventListener('click', manualRefresh);
refreshAll().catch((error) => console.error('Dashboard refresh failed:', error));
setInterval(() => {
  refreshAll().catch((error) => console.error('Scheduled dashboard refresh failed:', error));
}, 60 * 1000);
