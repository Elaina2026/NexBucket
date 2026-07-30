export {};

const REFRESH_SEC = 30;
let countdown = REFRESH_SEC;
let currentSection = 'overview';

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function switchSection(sec) {
  currentSection = sec;
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(el => el.classList.remove('active'));
  
  const btn = document.querySelector(`.sidebar-item[data-section="${sec}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`sec-${sec}`);
  if (panel) panel.classList.add('active');
  
  if (window.location.pathname !== `/admin/${sec}`) {
      history.pushState(null, '', `/admin/${sec}`);
  }
}

function initRouter() {
  const pathParts = window.location.pathname.split('/');
  const sec = pathParts[2] && pathParts[2] !== '' ? pathParts[2].replace('.html', '') : 'overview';
  switchSection(sec);
  
  document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const section = e.currentTarget.getAttribute('data-section');
      if (section) switchSection(section);
    });
  });
  
  window.addEventListener('popstate', () => {
    const sec = window.location.pathname.split('/')[2] || 'overview';
    switchSection(sec.replace('.html', ''));
  });
}
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (r.status === 403) return { __forbidden: true };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { console.error(`[Fetch] ${url}:`, e); return null; }
}
document.getElementById('themeToggle')?.addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
  localStorage.setItem('nex-theme', isLight ? 'dark' : 'light');
});
function renderBotInfo(info) {
  if (!info) return;
  const avatar = document.getElementById('botAvatar');
  const name = document.getElementById('botName');
  if (avatar) avatar.src = info.avatar;
  if (name) name.textContent = info.username + ' Admin';
}
function renderOverview(data) {
  if (!data) return;
  document.getElementById('sGuilds').textContent = fmtNum(data.guilds);
  document.getElementById('sUsers').textContent = fmtNum(data.totalUsers);
  document.getElementById('sUptime').textContent = fmtUptime(data.uptime);
  document.getElementById('sPing').textContent = data.ping + 'ms';
  const sysUptime = document.getElementById('sysUptime');
  if (sysUptime) sysUptime.textContent = fmtUptime(data.uptime);
  const sysPing = document.getElementById('sysPing');
  if (sysPing) sysPing.textContent = data.ping + 'ms';
}
function renderGrowthChart(data) {
  const wrap = document.getElementById('growthChart');
  // fetchJSON tra ve {__forbidden:true} khi gap 403; kiem tra Array.isArray
  // de khong goi .map() tren object do (TypeError).
  if (!Array.isArray(data) || data.length < 2) {
    wrap.innerHTML = '<div class="empty-state">Not enough data yet. Growth snapshots are saved every 6 hours.</div>';
    return;
  }
  
  const oldest = data[0];
  const newest = data[data.length - 1];
  let guildsGrowth = 0;
  let usersGrowth = 0;
  if (oldest && newest) {
    if (oldest.guild_count > 0) guildsGrowth = ((newest.guild_count - oldest.guild_count) / oldest.guild_count) * 100;
    if (oldest.user_count > 0) usersGrowth = ((newest.user_count - oldest.user_count) / oldest.user_count) * 100;
  }
  const gGrowthEl = document.getElementById('sGuildsGrowth');
  if (gGrowthEl) gGrowthEl.textContent = Math.max(0, guildsGrowth).toFixed(1) + '%';
  const uGrowthEl = document.getElementById('sUsersGrowth');
  if (uGrowthEl) uGrowthEl.textContent = Math.max(0, usersGrowth).toFixed(1) + '%';

  const W = 800, H = 280, PAD = 50;
  const chartW = W - PAD * 2, chartH = H - PAD * 2;
  const guilds = data.map(d => d.guild_count);
  const users = data.map(d => d.user_count);
  const times = data.map(d => new Date(d.timestamp));
  const maxG = Math.max(...guilds, 1);
  const maxU = Math.max(...users, 1);
  function toPath(arr, maxVal) {
    return arr.map((v, i) => {
      const x = PAD + (i / (arr.length - 1)) * chartW;
      const y = PAD + chartH - (v / maxVal) * chartH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }
  let gridLines = '';
  for (let i = 0; i <= 4; i++) {
    const y = PAD + (i / 4) * chartH;
    gridLines += `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="var(--border)" stroke-dasharray="4"/>`;
    const gVal = Math.round(maxG * (1 - i / 4));
    gridLines += `<text x="${PAD - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-m)" font-size="10">${fmtNum(gVal)}</text>`;
  }
  let timeLabels = '';
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    const x = PAD + (i / (data.length - 1)) * chartW;
    const d = times[i];
    const label = `${d.getMonth()+1}/${d.getDate()}`;
    timeLabels += `<text x="${x}" y="${H - 8}" text-anchor="middle" fill="var(--text-m)" font-size="10">${label}</text>`;
  }
  let dots = '';
  guilds.forEach((v, i) => {
    const x = PAD + (i / (guilds.length - 1)) * chartW;
    const y = PAD + chartH - (v / maxG) * chartH;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--accent)" opacity="0.7"/>`;
  });
  wrap.innerHTML = `
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:var(--accent)"></span>Servers (${guilds[guilds.length-1]})</span>
      <span class="legend-item"><span class="legend-dot" style="background:var(--green)"></span>Users (${fmtNum(users[users.length-1])})</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="growth-svg">
      ${gridLines}
      ${timeLabels}
      <path d="${toPath(guilds, maxG)}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${toPath(users, maxU)}" fill="none" stroke="var(--green)" stroke-width="2" stroke-dasharray="6 3" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
      ${dots}
    </svg>`;
}
function renderSessions(data) {
  const el = document.getElementById('sessionsList');
  if (!Array.isArray(data) || data.length === 0) {
    el.innerHTML = '<div class="empty-state">No active sessions.</div>';
    return;
  }
  el.innerHTML = data.map(s => {
    const isExpired = new Date(s.expires_at) < new Date();
    const avatarUrl = s.avatar
      ? `https://cdn.discordapp.com/avatars/${s.user_id}/${s.avatar}.png?size=64`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';
    return `<div class="session-row ${isExpired ? 'expired' : ''}">
      <img class="session-avatar" src="${esc(avatarUrl)}" alt="" />
      <div class="session-info">
        <span class="session-name">${esc(s.username)}</span>
        <span class="session-meta">ID: ${s.user_id} · Last: ${fmtDate(s.updated_at)}</span>
      </div>
      <div class="session-actions">
        <span class="session-status ${isExpired ? 'expired' : 'active'}">${isExpired ? 'Expired' : 'Active'}</span>
        ${!isExpired ? `<button class="btn-revoke" data-session-id="${esc(s.session_id)}">Revoke</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
async function revokeSession(sessionId) {
  if (!confirm('Revoke this session? The user will be logged out.')) return;
  try {
    const r = await fetch(`/api/admin/sessions/${sessionId}/revoke`, { method: 'POST' });
    if (r.ok) refreshAll();
    else alert('Failed to revoke session');
  } catch { alert('Network error'); }
}
function renderSecurityLog(data) {
  const el = document.getElementById('securityFeed');
  if (!Array.isArray(data) || data.length === 0) {
    el.innerHTML = '<div class="empty-state">No security events recorded. Your system is clean! 🛡️</div>';
    return;
  }
  const EVENT_COLORS = {
    'RATE_LIMIT': 'warning',
    'AUTH_FAIL': 'error',
    'ADMIN_ACCESS_DENIED': 'error',
    'SESSION_REVOKE': 'info',
  };
  el.innerHTML = data.map(evt => {
    const cls = EVENT_COLORS[evt.event_type] || 'info';
    return `<div class="security-item">
      <div class="sec-time">${fmtDate(evt.timestamp)}</div>
      <span class="sec-badge sec-${cls}">${esc(evt.event_type)}</span>
      <div class="sec-details">
        <span class="sec-ip">${esc(evt.ip_address || '')}</span>
        <span class="sec-msg">${esc(evt.details || '')}</span>
      </div>
    </div>`;
  }).join('');
}

function renderSystemStats(sys) {
  if (!sys || !sys.cpu || !sys.ram || !sys.disk) return;
  document.getElementById('cpuUsage').textContent = (sys.cpu.processUsagePercent).toFixed(1) + '%';
  document.getElementById('cpuModel').textContent = sys.cpu.model;
  const cpuBar = document.getElementById('cpuBar');
  if (cpuBar) cpuBar.style.width = Math.min(100, sys.cpu.processUsagePercent) + '%';
  
  const gbTotal = (sys.ram.total / 1073741824).toFixed(1);
  const gbUsed = ((sys.ram.total - sys.ram.free) / 1073741824).toFixed(1);
  const ramPercent = ((sys.ram.total - sys.ram.free) / sys.ram.total) * 100;
  document.getElementById('ramUsage').textContent = `${gbUsed} / ${gbTotal} GB`;
  document.getElementById('ramProcess').textContent = (sys.ram.process / 1048576).toFixed(1) + ' MB';
  const ramBar = document.getElementById('ramBar');
  if (ramBar) ramBar.style.width = Math.min(100, ramPercent) + '%';

  if (sys.disk.total > 0) {
    const dGbTotal = (sys.disk.total / 1073741824).toFixed(1);
    const dGbUsed = ((sys.disk.total - sys.disk.free) / 1073741824).toFixed(1);
    const diskPercent = ((sys.disk.total - sys.disk.free) / sys.disk.total) * 100;
    document.getElementById('diskUsage').textContent = `${dGbUsed} / ${dGbTotal} GB`;
    document.getElementById('diskStatus').textContent = 'Primary Drive';
    const diskBar = document.getElementById('diskBar');
    if (diskBar) diskBar.style.width = Math.min(100, diskPercent) + '%';
  } else {
    document.getElementById('diskUsage').textContent = 'N/A';
  }

  document.getElementById('dbSize').textContent = sys.db.size;
  document.getElementById('dbStatus').textContent = sys.db.status;
}
let isRefreshing = false;
async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  const [botInfo, overview, growth, sessions, security, system] = await Promise.all([
    fetchJSON('/api/admin/bot-info'),
    fetchJSON('/api/admin/overview'),
    fetchJSON('/api/admin/growth'),
    fetchJSON('/api/admin/sessions'),
    fetchJSON('/api/admin/security-log'),
    fetchJSON('/api/admin/system'),
  ]);
  if (botInfo?.__forbidden || overview?.__forbidden) {
    document.getElementById('accessDenied').classList.remove('hidden');
    document.getElementById('adminContent').classList.add('hidden');
    isRefreshing = false;
    return;
  }
  document.getElementById('accessDenied').classList.add('hidden');
  document.getElementById('adminContent').classList.remove('hidden');
  renderBotInfo(botInfo);
  renderOverview(overview);
  renderGrowthChart(growth);
  renderSessions(sessions);
  renderSecurityLog(security);
  renderSystemStats(system);
  isRefreshing = false;
}
function start() {
  initRouter();
  // Uy quyen su kien: CSP script-src 'self' chan moi onclick inline, va sessionsList
  // duoc render lai lien tuc nen khong the gan listener truc tiep len tung nut.
  document.getElementById('sessionsList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-revoke');
    if (btn) revokeSession(btn.dataset.sessionId);
  });
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      countdown = REFRESH_SEC;
      if (timerEl) timerEl.textContent = String(countdown);
      refreshAll();
    }
  });
}
document.addEventListener('DOMContentLoaded', start);
