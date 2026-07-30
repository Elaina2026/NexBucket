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
function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');
  if (!toggleBtn) return;
  toggleBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const isLight = root.getAttribute('data-theme') === 'light';
    if (isLight) {
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
    }
  });
}
function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}
let incFilters = { severity: 'all', startDate: '', endDate: '' };
function initFilters() {
  const btn = document.getElementById('incFilterBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    incFilters.severity = document.getElementById('incSeverityFilter').value;
    incFilters.startDate = document.getElementById('incStartDate').value;
    incFilters.endDate = document.getElementById('incEndDate').value;
    refreshAll(); 
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
function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
        <span class="service-name">${icon} ${svc.name}</span>
        <span class="service-status ${textClass}">
          <span class="dot ${dotClass}"></span>
          ${statusLabel}
        </span>
      </div>
      <p class="service-desc">${svc.description}</p>
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
function renderIncidents(data) {
  const summaryEl = document.getElementById('incidentSummary');
  const feedEl = document.getElementById('incidentFeed');
  if (!data) {
    if (feedEl.children.length === 0 || feedEl.querySelector('.empty-state')) {
      feedEl.innerHTML = '<div class="empty-state">Failed to connect to server. Retrying...</div>';
    }
    return;
  }
  const { summary, incidents } = data;
  summaryEl.innerHTML = '';
  if (summary.total === 0) {
    summaryEl.innerHTML = '<span class="inc-badge inc-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> No incidents in the last 24 hours</span>';
  } else {
    if (summary.errors > 0) summaryEl.innerHTML += `<span class="inc-badge inc-error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${summary.errors} Error${summary.errors > 1 ? 's' : ''}</span>`;
    if (summary.warnings > 0) summaryEl.innerHTML += `<span class="inc-badge inc-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${summary.warnings} Warning${summary.warnings > 1 ? 's' : ''}</span>`;
    if (summary.info > 0) summaryEl.innerHTML += `<span class="inc-badge inc-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> ${summary.info} Info</span>`;
  }
  if (incidents.length === 0) {
    feedEl.innerHTML = '<div class="empty-state">No incidents recorded. All systems running smoothly! <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" style="vertical-align: text-bottom; color: #f1c40f; margin-left: 4px;"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg></div>';
    return;
  }
  feedEl.innerHTML = '';
  for (const inc of incidents) {
    const tagCls = inc.severity === 'error' ? 'tag-error' : (inc.severity === 'warning' ? 'tag-warning' : 'tag-info');
    const label = inc.severity.toUpperCase();
    const item = document.createElement('div');
    item.className = 'incident-item';
    const d = new Date(inc.timestamp);
    const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    item.innerHTML = `
      <div class="inc-time">${timeStr}</div>
      <div class="inc-status-tag ${tagCls}">${label}</div>
      <div class="inc-body">
        <div class="inc-module">${escapeHTML(inc.module)}${inc.guildName ? ` - ${escapeHTML(inc.guildName)}` : ''}</div>
        <div class="inc-msg">${escapeHTML(inc.message)}</div>
      </div>
    `;
    feedEl.appendChild(item);
  }
}
function renderActivities(activities) {
  const feedEl = document.getElementById('activityFeed');
  if (!activities) {
    feedEl.innerHTML = '<div class="empty-state">Failed to load audit logs.</div>';
    return;
  }
  if (activities.length === 0) {
    feedEl.innerHTML = '<div class="empty-state">No audit logs recorded yet.</div>';
    return;
  }
  feedEl.innerHTML = '';
  for (const act of activities) {
    const item = document.createElement('div');
    item.className = 'audit-row';
    const d = new Date(act.timestamp);
    const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    item.innerHTML = `
      <div class="audit-time">${timeStr}</div>
      <div><span class="audit-event">${act.action}</span></div>
      <div class="audit-scope">${escapeHTML(act.guild_name || 'Global System')}</div>
      <div class="audit-details">${escapeHTML(act.details || '')}</div>
    `;
    feedEl.appendChild(item);
  }
}
let isRefreshing = false;
async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  const timerEl = document.getElementById('refreshBadge');
  const originalHtml = timerEl.innerHTML;
  timerEl.innerHTML = '<span style="color:var(--text-muted)">Syncing...</span>';
  const qParams = new URLSearchParams();
  if (incFilters.severity !== 'all') qParams.append('severity', incFilters.severity);
  if (incFilters.startDate) qParams.append('startDate', incFilters.startDate);
  if (incFilters.endDate) qParams.append('endDate', incFilters.endDate);
  const incUrl = '/api/incidents' + (qParams.toString() ? '?' + qParams.toString() : '');
  const [health, services, incidents, activities] = await Promise.all([
    fetchJSON('/api/health'),
    fetchJSON('/api/services'),
    fetchJSON(incUrl),
    fetchJSON('/api/activities'),
  ]);
  renderHealth(health);
  renderServices(services);
  renderIncidents(incidents);
  renderActivities(activities);
  timerEl.innerHTML = originalHtml;
  isRefreshing = false;
}
function startLoop() {
  initTheme();
  initTabs();
  initFilters();
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
