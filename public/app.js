const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl ? window.APP_CONFIG.apiBaseUrl : '').replace(/\/$/, '');
const SVG_NS = 'http://www.w3.org/2000/svg';
let staticMode = false;
let toastTimer = null;
const monthlyRange = { value: '1y' };
const chartState = {
  intraday: { rows: [], zoomStart: 0, zoomEnd: 0, minVisible: 30 },
  monthly: { rows: [], zoomStart: 0, zoomEnd: 0, minVisible: 6 }
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function staticPathFor(path) {
  const mapping = {
    '/api/summary': './data/summary.json',
    '/api/status': './data/status.json',
    '/api/chart/intraday': './data/intraday.json',
    '/api/chart/monthly?months=120': './data/monthly.json',
    '/api/history/daily?days=45': './data/daily.json',
    '/api/opinions': './data/opinions.json'
  };
  return mapping[path] || null;
}

function formatPrice(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
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

function showToast(message) {
  const toast = document.getElementById('appToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

function updateFreshnessBadge(timestamp) {
  const badge = document.getElementById('freshnessBadge');
  if (!badge) return;
  if (!timestamp) {
    badge.textContent = '数据新鲜度：--';
    badge.className = 'freshness-badge';
    return;
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000));
  let level = 'fresh';
  let text = `数据新鲜度：${diffMinutes} 分钟前`;
  if (diffMinutes > 20) {
    level = 'stale';
  } else if (diffMinutes > 8) {
    level = 'warn';
  }
  badge.textContent = text;
  badge.className = `freshness-badge ${level}`;
}

async function fetchJson(path, options) {
  try {
    const response = await fetch(apiUrl(path), options);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function createTicks(min, max, count) {
  const span = max - min || 1;
  return Array.from({ length: count }, (_, index) => min + (span * index) / (count - 1));
}

function getVisibleRows(key) {
  const state = chartState[key];
  if (!state.rows.length) return [];
  return state.rows.slice(state.zoomStart, state.zoomEnd + 1);
}

function setZoomRange(key, start, end) {
  const state = chartState[key];
  const maxIndex = state.rows.length - 1;
  if (maxIndex <= 0) return;
  let nextStart = clamp(start, 0, maxIndex);
  let nextEnd = clamp(end, 0, maxIndex);
  if (nextEnd - nextStart + 1 < state.minVisible) {
    nextEnd = clamp(nextStart + state.minVisible - 1, 0, maxIndex);
    nextStart = clamp(nextEnd - state.minVisible + 1, 0, maxIndex);
  }
  state.zoomStart = nextStart;
  state.zoomEnd = nextEnd;
}

function zoomChart(key, factor, centerIndex) {
  const state = chartState[key];
  const total = state.rows.length;
  const currentSize = state.zoomEnd - state.zoomStart + 1;
  const targetSize = clamp(Math.round(currentSize * factor), state.minVisible, total);
  if (targetSize === currentSize) return;

  const ratio = currentSize <= 1 ? 0.5 : (centerIndex - state.zoomStart) / (currentSize - 1);
  let nextStart = Math.round(centerIndex - ratio * (targetSize - 1));
  let nextEnd = nextStart + targetSize - 1;

  if (nextStart < 0) {
    nextEnd -= nextStart;
    nextStart = 0;
  }
  if (nextEnd > total - 1) {
    nextStart -= nextEnd - (total - 1);
    nextEnd = total - 1;
  }
  setZoomRange(key, nextStart, nextEnd);
}

function panChart(key, delta) {
  const state = chartState[key];
  const total = state.rows.length;
  const size = state.zoomEnd - state.zoomStart + 1;
  const nextStart = clamp(state.zoomStart + delta, 0, Math.max(0, total - size));
  setZoomRange(key, nextStart, nextStart + size - 1);
}

function resolveMonthlyRows(allRows) {
  if (monthlyRange.value === 'all') return allRows;
  const months = monthlyRange.value === '1y' ? 12 : 36;
  return allRows.slice(Math.max(0, allRows.length - months));
}

function buildChartMeta(info) {
  return `当前窗口 ${info.visiblePoints} 个点，共 ${info.totalPoints} 个点；价格区间 ${formatPrice(info.minValue)} 到 ${formatPrice(info.maxValue)}。`;
}

function renderInteractiveChart(svgId, key, options) {
  const svg = document.getElementById(svgId);
  if (!svg) return null;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const rows = getVisibleRows(key);
  const totalRows = chartState[key].rows;
  const width = 960;
  const height = 360;
  const margin = { top: 22, right: 18, bottom: 54, left: 78 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  if (rows.length < 2) {
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

  const yTicks = createTicks(min, max, options.yTickCount || 7);
  const xTickIndexes = uniqueSorted(options.xTickIndexes(rows));

  yTicks.forEach((tick, index) => {
    const y = yAt(tick);
    svg.appendChild(createSvgNode('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: index === yTicks.length - 1 ? 'chart-grid-strong' : 'chart-grid' }));
    svg.appendChild(createSvgNode('text', { x: margin.left - 10, y: y + 4, 'text-anchor': 'end', class: 'chart-label' }, options.yLabelFormatter(tick)));
  });

  xTickIndexes.forEach((index) => {
    const x = xAt(index);
    svg.appendChild(createSvgNode('line', { x1: x, y1: margin.top, x2: x, y2: height - margin.bottom, class: 'chart-grid' }));
    svg.appendChild(createSvgNode('text', { x, y: height - 16, 'text-anchor': 'middle', class: 'chart-label' }, options.xLabelFormatter(rows[index], index)));
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
    svg.appendChild(createSvgNode('circle', {
      cx: xAt(index),
      cy: yAt(Number(row.price)),
      r: options.pointRadius || 1.5,
      fill: options.pointColor,
      class: 'chart-point'
    }));
  });

  const overlay = createSvgNode('g', { visibility: 'hidden' });
  const vertical = createSvgNode('line', { class: 'chart-crosshair' });
  const horizontal = createSvgNode('line', { class: 'chart-crosshair' });
  const focusDot = createSvgNode('circle', { r: 4.5, fill: options.pointColor, class: 'chart-focus-dot' });
  const tooltipBg = createSvgNode('rect', { rx: 10, ry: 10, width: 150, height: 58, class: 'chart-tooltip-bg' });
  const tooltipLine1 = createSvgNode('text', { class: 'chart-tooltip-text', x: 12, y: 22 });
  const tooltipLine2 = createSvgNode('text', { class: 'chart-tooltip-text', x: 12, y: 40 });
  const tooltip = createSvgNode('g');
  tooltip.appendChild(tooltipBg);
  tooltip.appendChild(tooltipLine1);
  tooltip.appendChild(tooltipLine2);
  overlay.appendChild(vertical);
  overlay.appendChild(horizontal);
  overlay.appendChild(focusDot);
  overlay.appendChild(tooltip);
  svg.appendChild(overlay);

  function pointerToIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const relativeX = ((clientX - rect.left) / rect.width) * width;
    const clampedX = clamp(relativeX, margin.left, width - margin.right);
    const ratio = (clampedX - margin.left) / plotWidth;
    return clamp(Math.round(ratio * (rows.length - 1)), 0, rows.length - 1);
  }

  function updateCrosshair(clientX) {
    const index = pointerToIndex(clientX);
    const row = rows[index];
    const cx = xAt(index);
    const cy = yAt(Number(row.price));
    vertical.setAttribute('x1', cx);
    vertical.setAttribute('y1', margin.top);
    vertical.setAttribute('x2', cx);
    vertical.setAttribute('y2', height - margin.bottom);
    horizontal.setAttribute('x1', margin.left);
    horizontal.setAttribute('y1', cy);
    horizontal.setAttribute('x2', width - margin.right);
    horizontal.setAttribute('y2', cy);
    focusDot.setAttribute('cx', cx);
    focusDot.setAttribute('cy', cy);

    const tooltipWidth = 180;
    const tooltipHeight = 58;
    const tooltipX = cx > width - margin.right - tooltipWidth - 12 ? cx - tooltipWidth - 12 : cx + 12;
    const tooltipY = cy < margin.top + tooltipHeight ? cy + 12 : cy - tooltipHeight - 8;
    tooltip.setAttribute('transform', `translate(${tooltipX},${tooltipY})`);
    tooltipBg.setAttribute('width', tooltipWidth);
    tooltipBg.setAttribute('height', tooltipHeight);
    tooltipLine1.textContent = options.tooltipTitle(row);
    tooltipLine2.textContent = `${formatPrice(row.price)} · ${options.tooltipSubtitle(row)}`;
    overlay.setAttribute('visibility', 'visible');
    return chartState[key].zoomStart + index;
  }

  function hideCrosshair() {
    overlay.setAttribute('visibility', 'hidden');
  }

  let dragging = false;
  let lastClientX = 0;

  svg.onpointermove = (event) => {
    if (dragging) {
      const rect = svg.getBoundingClientRect();
      const pointsPerPixel = rows.length / rect.width;
      const deltaPoints = Math.round((lastClientX - event.clientX) * pointsPerPixel);
      lastClientX = event.clientX;
      if (deltaPoints !== 0) {
        panChart(key, deltaPoints);
        options.rerender();
      }
      return;
    }
    updateCrosshair(event.clientX);
  };

  svg.onpointerleave = () => {
    if (!dragging) hideCrosshair();
  };

  svg.onpointerdown = (event) => {
    dragging = true;
    lastClientX = event.clientX;
    svg.classList.add('is-panning');
    svg.setPointerCapture(event.pointerId);
  };

  svg.onpointerup = (event) => {
    dragging = false;
    svg.classList.remove('is-panning');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    updateCrosshair(event.clientX);
  };

  svg.onwheel = (event) => {
    event.preventDefault();
    const centerGlobalIndex = updateCrosshair(event.clientX);
    zoomChart(key, event.deltaY > 0 ? 1.2 : 0.8, centerGlobalIndex);
    options.rerender();
  };

  svg.ondblclick = () => {
    setZoomRange(key, 0, chartState[key].rows.length - 1);
    options.rerender();
  };

  return {
    minValue,
    maxValue,
    visiblePoints: rows.length,
    totalPoints: totalRows.length
  };
}

async function loadSummary() {
  const [summary, status] = await Promise.all([fetchJson('/api/summary'), fetchJson('/api/status')]);

  if (summary.latest) {
    setText('latestPrice', `${formatPrice(summary.latest.price)} / ${summary.latest.unit}`);
    setText('lastUpdated', `最近更新：${formatDateTime(summary.latest.fetched_at)} · 来源：钉子`);
    updateFreshnessBadge(summary.latest.fetched_at);
  } else {
    setText('latestPrice', '--');
    setText('lastUpdated', '暂无数据');
    updateFreshnessBadge(null);
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
  setText('modeHint', staticMode ? '当前为 Vercel 静态模式，数据由 GitHub Actions 定时更新。快捷键：R刷新，I/M重置图表，1/3/0切换月度区间。' : '当前为本地/API 模式。快捷键：R刷新，I/M重置图表，1/3/0切换月度区间。');
}

function renderIntradayChart() {
  const info = renderInteractiveChart('intradayChart', 'intraday', {
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
    },
    tooltipSubtitle() {
      return '分钟点';
    },
    rerender() {
      renderIntradayChart();
    }
  });

  if (info) {
    setText('intradayMeta', `${buildChartMeta(info)} 滚轮缩放，双击重置，按住拖拽可查看局部波动。`);
  }
}

function resetIntradayZoom() {
  if (!chartState.intraday.rows.length) return;
  setZoomRange('intraday', Math.max(0, chartState.intraday.rows.length - 360), chartState.intraday.rows.length - 1);
  renderIntradayChart();
}

async function loadIntradayChart() {
  const rows = await fetchJson('/api/chart/intraday');
  const hadRows = chartState.intraday.rows.length > 0;
  const prevVisible = Math.max(chartState.intraday.minVisible, chartState.intraday.zoomEnd - chartState.intraday.zoomStart + 1);

  chartState.intraday.rows = rows;

  if (!hadRows) {
    setZoomRange('intraday', Math.max(0, rows.length - 360), rows.length - 1);
  } else {
    setZoomRange('intraday', Math.max(0, rows.length - prevVisible), rows.length - 1);
  }
  renderIntradayChart();
}

function renderMonthlyChart() {
  const info = renderInteractiveChart('monthlyChart', 'monthly', {
    areaClass: 'chart-area-teal',
    lineClass: 'chart-line-teal',
    pointColor: '#7ad3c8',
    pointRadius: 2.2,
    yTickCount: 7,
    yLabelFormatter(value) {
      return formatPrice(value, 0);
    },
    xTickIndexes(data) {
      const desired = Math.min(12, data.length);
      return Array.from({ length: desired }, (_, i) => Math.min(data.length - 1, Math.round((i * (data.length - 1)) / Math.max(1, desired - 1))));
    },
    pointIndexes(data) {
      return data.map((_, index) => index);
    },
    xLabelFormatter(row) {
      return row.bucket;
    },
    tooltipTitle(row) {
      return `${row.bucket}`;
    },
    tooltipSubtitle() {
      return '月度点';
    },
    rerender() {
      renderMonthlyChart();
    }
  });

  if (info) {
    setText('monthlyMeta', `${buildChartMeta(info)} 当前显示 ${monthlyRange.value === 'all' ? '全部' : monthlyRange.value === '1y' ? '1 年' : '3 年'} 视图。`);
  }
}

function resetMonthlyZoom() {
  if (!chartState.monthly.rows.length) return;
  setZoomRange('monthly', 0, chartState.monthly.rows.length - 1);
  renderMonthlyChart();
}

async function loadMonthlyChart() {
  const allRows = await fetchJson('/api/chart/monthly?months=120');
  const rows = resolveMonthlyRows(allRows);
  chartState.monthly.rows = rows;
  setZoomRange('monthly', 0, rows.length - 1);
  renderMonthlyChart();
}

function setMonthlyRange(nextRange) {
  monthlyRange.value = nextRange;
  document.querySelectorAll('#monthlyRangeSwitcher .segmented-btn').forEach((item) => {
    item.classList.toggle('active', item.dataset.range === nextRange);
  });
  loadMonthlyChart().catch((error) => {
    showToast('月度图更新失败，请稍后重试');
    console.error('Monthly chart reload failed:', error);
  });
}

function initializeMonthlyRangeSwitcher() {
  document.querySelectorAll('#monthlyRangeSwitcher .segmented-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setMonthlyRange(button.dataset.range);
    });
  });
}

function initializeKeyboardShortcuts() {
  window.addEventListener('keydown', (event) => {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      manualRefresh();
    }
    if (key === 'i') {
      event.preventDefault();
      resetIntradayZoom();
    }
    if (key === 'm') {
      event.preventDefault();
      resetMonthlyZoom();
    }
    if (key === '1') {
      event.preventDefault();
      setMonthlyRange('1y');
    }
    if (key === '3') {
      event.preventDefault();
      setMonthlyRange('3y');
    }
    if (key === '0') {
      event.preventDefault();
      setMonthlyRange('all');
    }
  });
}


async function loadOpinions() {
  const opinions = await fetchJson('/api/opinions');
  const container = document.getElementById('opinionsList');
  if (!container) return;

  container.innerHTML = opinions.map((item) => {
    const safeLink = item.link ? `<a class="opinion-link" href="${item.link}" target="_blank" rel="noopener noreferrer">来源链接</a>` : '';
    return `
      <article class="opinion-card">
        <div class="opinion-top">
          <span class="opinion-source">${item.institution || '机构观点'}</span>
          <span class="opinion-date">${item.date || '--'}</span>
        </div>
        <div class="opinion-name">${item.expert || '市场研究员'}</div>
        <p class="opinion-text">${item.view || ''}</p>
        <div>
          <span class="opinion-tag">${item.bias || '中性'}</span>${safeLink}
        </div>
      </article>
    `;
  }).join('');
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
  await Promise.all([loadSummary(), loadIntradayChart(), loadMonthlyChart(), loadHistoryTable(), loadOpinions()]);
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
    showToast('数据已更新');
  } catch (error) {
    showToast('刷新失败，已保留当前数据');
    await refreshAll();
  } finally {
    button.disabled = false;
    button.textContent = staticMode ? '重新读取页面数据' : '立即刷新数据';
  }
}

document.getElementById('manualRefresh').addEventListener('click', manualRefresh);
document.getElementById('resetIntraday').addEventListener('click', resetIntradayZoom);
document.getElementById('resetMonthly').addEventListener('click', resetMonthlyZoom);
initializeMonthlyRangeSwitcher();
initializeKeyboardShortcuts();
refreshAll().catch((error) => {
  showToast('首次加载失败，请刷新重试');
  console.error('Dashboard refresh failed:', error);
});
setInterval(() => {
  refreshAll().catch((error) => {
    showToast('自动刷新失败，将在下个周期重试');
    console.error('Scheduled dashboard refresh failed:', error);
  });
}, 60 * 1000);



