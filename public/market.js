const adviceState = {
  rows: [],
  region: 'all',
  metal: 'all',
  bias: 'all'
};

const METAL_LABELS = {
  gold: '黄金',
  silver: '白银',
  platinum: '铂金',
  palladium: '钯金'
};

function formatDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleDateString('zh-CN');
}

function cardTemplate(item) {
  const link = item.link
    ? `<a class="opinion-link" href="${item.link}" target="_blank" rel="noopener noreferrer">来源链接</a>`
    : '';

  return `
    <article class="opinion-card market-card">
      <div class="opinion-top">
        <span class="opinion-source">${item.institution || '机构观点'}</span>
        <span class="opinion-date">${formatDate(item.date)}</span>
      </div>
      <div class="opinion-name">${item.expert || '分析师'}</div>
      <p class="opinion-text">${item.view || ''}</p>
      <div class="market-card-tags">
        <span class="opinion-tag">${METAL_LABELS[item.metal] || '贵金属'}</span>
        <span class="opinion-tag">${item.region || '国际'}</span>
        <span class="opinion-tag">${item.bias || '中性'}</span>
        ${link}
      </div>
    </article>
  `;
}

function applyFilters() {
  const result = adviceState.rows.filter((item) => {
    const regionOk = adviceState.region === 'all' || item.region === adviceState.region;
    const metalOk = adviceState.metal === 'all' || item.metal === adviceState.metal;
    const biasOk = adviceState.bias === 'all' || item.bias === adviceState.bias;
    return regionOk && metalOk && biasOk;
  });

  const container = document.getElementById('marketAdviceList');
  const count = document.getElementById('marketCount');
  const meta = document.getElementById('marketMeta');

  count.textContent = `共 ${result.length} 条观点`;
  meta.textContent = `当前展示 ${result.length} / ${adviceState.rows.length} 条，支持按地区、金属、倾向多维筛选。`;

  if (!result.length) {
    container.innerHTML = '<p class="status-note">当前筛选条件下暂无数据，请调整筛选项。</p>';
    return;
  }

  container.innerHTML = result.map(cardTemplate).join('');
}

function bindFilters() {
  const regionFilter = document.getElementById('regionFilter');
  const metalFilter = document.getElementById('metalFilter');
  const biasFilter = document.getElementById('biasFilter');

  regionFilter.addEventListener('change', () => {
    adviceState.region = regionFilter.value;
    applyFilters();
  });

  metalFilter.addEventListener('change', () => {
    adviceState.metal = metalFilter.value;
    applyFilters();
  });

  biasFilter.addEventListener('change', () => {
    adviceState.bias = biasFilter.value;
    applyFilters();
  });
}

async function boot() {
  try {
    const response = await fetch('./data/market_advice.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rows = await response.json();
    adviceState.rows = Array.isArray(rows)
      ? rows.sort((a, b) => new Date(b.date) - new Date(a.date))
      : [];

    bindFilters();
    applyFilters();
  } catch (error) {
    const meta = document.getElementById('marketMeta');
    const container = document.getElementById('marketAdviceList');
    meta.textContent = '建议数据加载失败，请稍后刷新重试。';
    container.innerHTML = '<p class="status-note">建议数据加载失败。</p>';
    console.error('Market advice load failed:', error);
  }
}

boot();
