export {};

const REFRESH_SEC = 30;
let countdown = REFRESH_SEC;
const STATUS_LABELS = {
  up: 'Operational',
  down: 'Outage',
  degraded: 'Degraded',
  unknown: 'Checking',
};
const SERVICE_ICONS = {
  'bot-core': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
  'database': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  'tickets': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>',
  'welcome': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
  'moderation': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  'status': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  'banking': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  'jtc': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svc-icon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
};
function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) {
        target.classList.add('active');
        if (btn.dataset.tab === 'tab-ai-models') fetchAiModels();
      }
    });
  });
}

const AI_MODELS_PER_PAGE = 20;
const aiModelsState = { models: null, query: '', provider: '', page: 1 };

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function formatModelNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : 'Unknown';
}

function formatModelPrice(value) {
  return Number.isFinite(value) ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '?';
}

function renderAiModels() {
  const container = document.getElementById('aiModelsList');
  const summary = document.getElementById('aiModelsSummary');
  const pagination = document.getElementById('aiModelsPagination');
  const pageLabel = document.getElementById('aiModelsPage');
  const previous = document.getElementById('aiModelsPrev');
  const next = document.getElementById('aiModelsNext');
  if (!container || !Array.isArray(aiModelsState.models)) return;

  const query = aiModelsState.query.toLowerCase();
  const filtered = aiModelsState.models.filter(model => {
    const matchesProvider = !aiModelsState.provider || model.provider === aiModelsState.provider;
    const searchable = `${model.name} ${model.id} ${model.provider}`.toLowerCase();
    return matchesProvider && searchable.includes(query);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / AI_MODELS_PER_PAGE));
  aiModelsState.page = Math.min(aiModelsState.page, pages);
  const offset = (aiModelsState.page - 1) * AI_MODELS_PER_PAGE;
  const pageModels = filtered.slice(offset, offset + AI_MODELS_PER_PAGE);

  if (summary) summary.textContent = `${filtered.length.toLocaleString()} of ${aiModelsState.models.length.toLocaleString()} models`;
  if (pagination) pagination.hidden = filtered.length <= AI_MODELS_PER_PAGE;
  if (pageLabel) pageLabel.textContent = `Page ${aiModelsState.page} of ${pages}`;
  if (previous) previous.disabled = aiModelsState.page <= 1;
  if (next) next.disabled = aiModelsState.page >= pages;

  if (pageModels.length === 0) {
    container.innerHTML = '<div class="empty-state">No AI models match these filters.</div>';
    return;
  }

  container.innerHTML = pageModels.map(model => `
    <div class="service-card operational">
      <div class="svc-main">
        <div class="svc-info">
          <div class="svc-name">${escapeHTML(model.name || model.id)}</div>
          <div class="svc-desc">${escapeHTML(model.id)}<br>Context: ${formatModelNumber(model.context_window)} tokens | Max Output: ${formatModelNumber(model.max_output_tokens)} tokens</div>
        </div>
      </div>
      <div class="svc-meta">
        <span class="status-badge">Provider: ${escapeHTML(model.provider || 'unknown')}</span>
        <span class="status-badge status-up">Vision: ${model.vision_support ? 'Yes' : 'No'}</span>
        <span class="status-badge">Price In/Out: ${formatModelPrice(model.input_price_per_m)} / ${formatModelPrice(model.output_price_per_m)} per 1M</span>
      </div>
    </div>
  `).join('');
}

async function fetchAiModels() {
  const container = document.getElementById('aiModelsList');
  if (!container || aiModelsState.models) return;
  const data = await fetchJSON('/api/ai/models');
  if (!Array.isArray(data?.models) || data.models.length === 0) {
    container.innerHTML = '<div class="empty-state">Failed to load AI models catalogue.</div>';
    return;
  }

  aiModelsState.models = data.models.filter(model =>
    model && typeof model.id === 'string' && typeof model.name === 'string'
  );
  if (aiModelsState.models.length === 0) {
    container.innerHTML = '<div class="empty-state">Failed to load AI models catalogue.</div>';
    return;
  }

  const providers = [...new Set(aiModelsState.models.map(model => model.provider).filter(Boolean))].sort();
  const providerFilter = document.getElementById('aiProviderFilter');
  if (providerFilter) {
    providerFilter.replaceChildren(new Option('All providers', ''));
    providers.forEach(provider => providerFilter.add(new Option(provider, provider)));
  }
  renderAiModels();
}

function initAiModelsControls() {
  document.getElementById('aiModelSearch')?.addEventListener('input', event => {
    aiModelsState.query = event.target.value.trim();
    aiModelsState.page = 1;
    renderAiModels();
  });
  document.getElementById('aiProviderFilter')?.addEventListener('change', event => {
    aiModelsState.provider = event.target.value;
    aiModelsState.page = 1;
    renderAiModels();
  });
  document.getElementById('aiModelsPrev')?.addEventListener('click', () => {
    aiModelsState.page--;
    renderAiModels();
  });
  document.getElementById('aiModelsNext')?.addEventListener('click', () => {
    aiModelsState.page++;
    renderAiModels();
  });
}
function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function formatShortDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? `Today, ${time}` : `${d.toLocaleDateString()} ${time}`;
}
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { console.error(`[Fetch] ${url}:`, e); return null; }
}
function renderBanner(overall) {
  const banner = document.getElementById('statusBanner');
  const title = document.getElementById('bannerTitle');
  const desc = document.getElementById('bannerDesc');
  const icon = document.getElementById('bannerIcon');
  banner.classList.remove('degraded', 'down', 'operational');
  if (!overall || overall === 'All Systems Operational') {
    banner.classList.add('operational');
    title.textContent = 'All Systems Operational';
    desc.textContent = 'All core services have been verified and are running normally.';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  } else if (overall === 'Degraded Performance') {
    banner.classList.add('degraded');
    title.textContent = 'Degraded Performance';
    desc.textContent = 'Some services are experiencing degraded performance.';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else if (overall === 'Partial Outage' || overall === 'Major Outage') {
    banner.classList.add('down');
    title.textContent = overall;
    desc.textContent = 'One or more services are currently experiencing issues.';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else {
    title.textContent = overall;
    desc.textContent = 'Verifying the status of all core services.';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  }
}
function renderHealth(data) {
  if (!data) return;
  document.getElementById('hUptime').textContent = formatUptime(data.uptime);
  document.getElementById('hPing').textContent = `${data.ping}ms`;
  document.getElementById('hMemory').textContent = `${data.memory.heapUsed} MB`;
  document.getElementById('hGuilds').textContent = data.guilds;
  document.getElementById('hUsers').textContent = data.totalUsers.toLocaleString();
}
function renderServices(data) {
  const container = document.getElementById('servicesList');
  if (!data || !data.services) {
    if (container.children.length === 0 || container.querySelector('.empty-state')) {
      container.innerHTML = '<div class="empty-state">Failed to connect to server. Retrying...</div>';
    }
    return;
  }
  renderBanner(data.overall);
  container.innerHTML = '';
  for (const svc of data.services) {
    const icon = SERVICE_ICONS[svc.id] || '⚙️';
    const statusLabel = STATUS_LABELS[svc.status] || 'Unknown';
    const dotClass = `dot-${svc.status}`;
    const textClass = `status-${svc.status}`;
    let barsHTML = '';
    const totalBars = svc.bars.length;
    svc.bars.forEach((bar, index) => {
      const barClass = `bar-${bar.status}`;
      const hoursAgo = totalBars - 1 - index;
      let timeLabel = hoursAgo === 0 ? 'Now' : `${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago`;
      const absoluteTime = new Date(bar.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const tooltipStatus = STATUS_LABELS[bar.status] || 'Unknown';
      barsHTML += `<div class="uptime-bar ${barClass}"><div class="bar-tooltip">${timeLabel} (${absoluteTime}) — ${tooltipStatus}</div></div>`;
    });
    const card = document.createElement('div');
    card.className = 'service-card';
    card.innerHTML = `
      <div class="service-header">
        <span class="service-name">${icon} ${escapeHTML(svc.name)}</span>
        <span class="service-status ${textClass}">
          <span class="dot ${dotClass}"></span>
          ${statusLabel}
        </span>
      </div>
      <p class="service-desc">${escapeHTML(svc.description)}</p>
      <div class="uptime-bar-wrap">
        <div class="uptime-bars">${barsHTML}</div>
        <div class="uptime-labels">
          <span>30 hours ago</span>
          <span class="uptime-percent">${svc.uptimePercent}% uptime</span>
          <span>Now</span>
        </div>
      </div>`;
    container.appendChild(card);
  }
}
let isRefreshing = false;
async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  const timerEl = document.getElementById('refreshBadge');
  const originalContent = timerEl ? [...timerEl.childNodes] : [];
  if (timerEl) {
    const syncing = document.createElement('span');
    syncing.className = 'syncing-label';
    syncing.textContent = 'Syncing...';
    timerEl.replaceChildren(syncing);
  }
  try {
    const [health, services] = await Promise.all([
      fetchJSON('/api/health'),
      fetchJSON('/api/services'),
    ]);
    renderHealth(health);
    renderServices(services);
  } finally {
    if (timerEl) timerEl.replaceChildren(...originalContent);
    isRefreshing = false;
  }
}
function startLoop() {
  initTabs();
  initAiModelsControls();
  const timerEl = document.getElementById('refreshTimer');
  countdown = REFRESH_SEC;
  refreshAll();
  setInterval(() => {
    countdown--;
    if (timerEl) timerEl.textContent = String(countdown);
    if (countdown <= 0) {
      countdown = REFRESH_SEC;
      refreshAll();
    }
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      countdown = REFRESH_SEC;
      if (timerEl) timerEl.textContent = String(countdown);
      refreshAll();
    }
  });
}
document.addEventListener('DOMContentLoaded', startLoop);
