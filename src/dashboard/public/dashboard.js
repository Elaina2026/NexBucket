export {};

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('nex-theme', isLight ? 'dark' : 'light');
  });
  // Generate floating particles for hero
  const particleContainer = document.getElementById('heroParticles');
  if (particleContainer) {
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.top = Math.random() * 100 + '%';
      p.style.animationDuration = (8 + Math.random() * 12) + 's';
      p.style.animationDelay = (Math.random() * 10) + 's';
      p.style.width = p.style.height = (2 + Math.random() * 4) + 'px';
      particleContainer.appendChild(p);
    }
  }
  let currentGuildId = null, guildsData = [];
  let configVersion = 0;
  let guildChannels = [], guildRoles = [];
  function parseRoute() {
    const path = window.location.pathname;
    const match = path.match(/^\/dashboard\/([\d]+)(?:\/([\w-]+))?/);
    if (match) return { serverId: match[1], section: match[2] || 'general' };
    if (path.startsWith('/dashboard')) return { serverId: null, section: null };
    return { serverId: null, section: null };
  }
  function pushRoute(serverId, section) {
    let url = '/dashboard';
    if (serverId) {
      url += '/' + serverId;
      if (section && section !== 'general') url += '/' + section;
    }
    if (window.location.pathname !== url) {
      history.pushState({ serverId, section }, '', url);
    }
  }
  const btnLogin = document.getElementById('btnLogin');
  const userBadge = document.getElementById('userBadge');
  const loggedOutView = document.getElementById('loggedOutView');
  const loggedInView = document.getElementById('loggedInView');
  const serverPickerView = document.getElementById('serverPickerView');
  const dashboardLayout = document.getElementById('dashboardLayout');
  const serverGrid = document.getElementById('serverGrid');
  const sidebarNav = document.getElementById('sidebarNav');
  const sidebarServerInfo = document.getElementById('sidebarServerInfo');
  const contentArea = document.getElementById('contentArea');
  const saveStatus = document.getElementById('saveStatus');
  const btnSave = document.getElementById('btnSave');
  const I = {
    gear: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></svg>`,
    chat: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    door: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7.5"/><path d="M15 22v-4a2 2 0 0 1 2-2h4"/></svg>`,
    ticket: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    speaker: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    shield: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    card: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    monitor: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`,
    plus: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
    chevron: `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`,
    hash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
    voice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    category: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    announcement: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>`,
    stage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`,
    forum: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  };
  const CHANNEL_ICONS = { 0: I.hash, 2: I.voice, 4: I.category, 5: I.announcement, 13: I.stage, 15: I.forum };
  const BADGE = {
    owner: { label: 'Owner', cls: 'badge-owner' },
    administrator: { label: 'Admin', cls: 'badge-administrator' },
    manage_server: { label: 'Manager', cls: 'badge-manage_server' },
  };
  const SECTIONS = [
    { id: 'general', label: 'General', icon: I.gear },
    { id: 'welcome', label: 'Welcome', icon: I.chat },
    { id: 'goodbye', label: 'Goodbye', icon: I.door },
    { id: 'ticket', label: 'Tickets', icon: I.ticket },
    { id: 'transcripts', label: 'Transcripts', icon: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
    { id: 'jtc', label: 'Voice JTC', icon: I.speaker },
    { id: 'mod', label: 'Security', icon: I.shield },
    { id: 'bank', label: 'Banking', icon: I.card },
    { id: 'status', label: 'Server Status', icon: I.monitor },
    { id: 'stats', label: 'Server Stats', icon: I.users },
  ];
  async function checkAuth() {
    try {
      const r = await fetch('/api/auth/me');
      if (r.ok) { const d = await r.json(); guildsData = d.guilds || []; renderLoggedIn(d); }
      else renderLoggedOut();
    } catch { renderLoggedOut(); }
  }
  function renderLoggedOut() { btnLogin?.classList.remove('hidden'); userBadge?.classList.add('hidden'); loggedOutView?.classList.remove('hidden'); loggedInView?.classList.add('hidden'); }
  function renderLoggedIn(data) {
    btnLogin?.classList.add('hidden'); userBadge?.classList.remove('hidden'); loggedOutView?.classList.add('hidden'); loggedInView?.classList.remove('hidden');
    document.getElementById('userName').textContent = data.user.username;
    const av = document.getElementById('userAvatar');
    av.src = data.user.avatar ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
    renderServerGrid(data.guilds);
    const route = parseRoute();
    if (route.serverId) {
      const guild = data.guilds.find(g => g.id === route.serverId);
      if (guild) openDashboard(guild, route.section || 'general', false);
    }
  }
  document.getElementById('btnLogout')?.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.reload(); });
  document.getElementById('btnBackToServers')?.addEventListener('click', () => {
    dashboardLayout.classList.add('hidden');
    serverPickerView.classList.remove('hidden');
    currentGuildId = null;
    pushRoute(null, null);
  });
  function renderServerGrid(guilds) {
    serverGrid.innerHTML = '';
    if (!guilds?.length) { serverGrid.innerHTML = '<div class="empty-state">No manageable servers found.</div>'; return; }
    guilds.forEach(g => {
      const b = BADGE[g.permissionTier] || BADGE.manage_server;
      const iconHtml = g.icon ? `<img class="server-icon" src="${esc(g.icon)}" alt="${esc(g.name)}" loading="lazy"/>` : `<div class="server-icon-ph">${g.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>`;
      const card = document.createElement('div');
      card.className = 'server-card'; card.dataset.guildId = g.id;
      card.innerHTML = `${iconHtml}<div class="server-info"><div class="server-name">${esc(g.name)}</div><div class="server-meta"><span class="server-members">${I.users} ${fmtNum(g.memberCount)}</span><span class="perm-badge ${b.cls}">${b.label}</span></div></div>`;
      card.addEventListener('click', () => openDashboard(g));
      serverGrid.appendChild(card);
    });
  }
  async function openDashboard(guild, initialSection = 'general', updateUrl = true) {
    currentGuildId = guild.id;
    serverPickerView.classList.add('hidden');
    dashboardLayout.classList.remove('hidden');
    if (updateUrl) pushRoute(guild.id, initialSection);
    const iconSrc = guild.icon || '';
    sidebarServerInfo.innerHTML = iconSrc ? `<img src="${esc(iconSrc)}" alt=""/>` : '';
    sidebarServerInfo.innerHTML += `<div><div class="ss-name">${esc(guild.name)}</div><div class="ss-id">${guild.id}</div></div>`;
    sidebarNav.innerHTML = '';
    SECTIONS.forEach((s) => {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item' + (s.id === initialSection ? ' active' : '');
      btn.dataset.section = s.id;
      btn.innerHTML = `${s.icon}<span>${s.label}</span>`;
      btn.addEventListener('click', () => switchSection(s.id));
      sidebarNav.appendChild(btn);
    });
    showStatus('Loading server data...', 'info');
    try {
      const guildDataRes = await fetch(`/api/guilds/${guild.id}/data`);
      if (guildDataRes.ok) {
        const gd = await guildDataRes.json();
        guildChannels = gd.channels || [];
        guildRoles = gd.roles || [];
      }
    } catch {  }
    buildAllSections();
    wireBannerPickers();
    await loadConfig(guild.id);
    switchSection(initialSection, false);
    showStatus('', '');
  }
  function switchSection(id, updateUrl = true) {
    sidebarNav.querySelectorAll('.sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.section === id));
    contentArea.querySelectorAll('.content-section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + id));
    const actionBar = document.querySelector('.action-bar');
    if (actionBar) actionBar.style.display = id === 'transcripts' ? 'none' : 'flex';
    if (updateUrl) pushRoute(currentGuildId, id);
    if (id === 'transcripts') loadTranscripts();
  }
  function makeChannelPicker(id, label, hint, filterTypes = null) {
    const filteredChannels = filterTypes ? guildChannels.filter(c => filterTypes.includes(c.type)) : guildChannels;
    return `<div class="form-group"><label class="field-label">${label}</label><div class="picker-wrap" data-picker-id="${id}" data-picker-type="channel"><div class="picker-display" tabindex="0"><span class="ph">Select a channel...</span><span class="selected-text hidden"></span>${I.chevron}</div><div class="picker-dropdown"><input type="text" class="picker-search" placeholder="Search channels..."/><div class="picker-options">${filteredChannels.map(c => `<div class="picker-option" data-value="${c.id}"><span class="ch-icon">${CHANNEL_ICONS[c.type] || '#'}</span><span class="ch-name">${esc(c.name)}</span></div>`).join('')}</div></div></div>${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  }
  function makeRolePicker(id, label, hint) {
    return `<div class="form-group"><label class="field-label">${label}</label><div class="picker-wrap" data-picker-id="${id}" data-picker-type="role"><div class="picker-display" tabindex="0"><span class="ph">Select a role...</span><span class="selected-text hidden"></span>${I.chevron}</div><div class="picker-dropdown"><input type="text" class="picker-search" placeholder="Search roles..."/><div class="picker-options">${guildRoles.map(r => `<div class="picker-option" data-value="${r.id}"><span class="role-dot" style="background:${r.color}"></span><span class="role-name">${esc(r.name)}</span></div>`).join('')}</div></div></div>${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  }
  function makeMultiRolePicker(id, label, hint) {
    return `<div class="form-group"><label class="field-label">${label}</label><div class="picker-wrap" data-picker-id="${id}" data-picker-type="multi-role"><div class="picker-multi-display" tabindex="0"><span class="ph">Click to add roles...</span></div><div class="picker-dropdown"><input type="text" class="picker-search" placeholder="Search roles..."/><div class="picker-options">${guildRoles.map(r => `<div class="picker-option" data-value="${r.id}"><span class="role-dot" style="background:${r.color}"></span><span class="role-name">${esc(r.name)}</span></div>`).join('')}</div></div></div>${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  }
  function makeInput(id, label, ph, hint, type = 'text', val = '') {
    const valAttr = val ? ` value="${val}"` : '';
    return `<div class="form-group"><label class="field-label">${label}</label><input type="${type}" id="${id}" class="text-input" placeholder="${ph}"${valAttr}/>${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  }
  function makeTextarea(id, label, ph, hint, rows = 3) {
    return `<div class="form-group"><label class="field-label">${label}</label><textarea id="${id}" class="text-input" placeholder="${ph}" rows="${rows}"></textarea>${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  }
  function makeColorPicker(id, label, def = '#5865F2') {
    return `<div class="form-group"><label class="field-label">${label}</label><div class="color-row"><div class="color-dot" id="${id}Dot" style="background:${def}" data-color-for="${id}"></div><input type="color" id="${id}Color" value="${def}"/><input type="text" id="${id}" class="text-input" placeholder="${def}" value="${def}" style="flex:1"/></div></div>`;
  }
  function makeToggle(id, label, desc, icon, checked = true) {
    return `<div class="toggle-group"><div class="toggle-info">${icon}<div><div class="toggle-label">${label}</div><div class="toggle-desc">${desc}</div></div></div><label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/><span class="toggle-slider"></span></label></div>`;
  }
  function makeSelect(id, label, options, hint = '') {
    const opts = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    return `<div class="form-group"><label class="field-label">${label}</label><select id="${id}" class="select-input">${opts}</select>${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  }
  function makeBannerPicker(id, label) {
    const urls = [
      'https://cdn.koya.gg/gallery/l/9tQ5kUy.png', 'https://cdn.koya.gg/gallery/l/es49qwK.png', 'https://cdn.koya.gg/gallery/l/PZb54xG.png',
      'https://cdn.koya.gg/gallery/l/e7wNTbc.png', 'https://cdn.koya.gg/gallery/l/epBvRPS.png', 'https://cdn.koya.gg/gallery/l/e32QKfw.png',
      'https://cdn.koya.gg/gallery/l/UBITUg8.png', 'https://cdn.koya.gg/gallery/l/jh0brcw.png', 'https://cdn.koya.gg/gallery/l/6mWYs87.png',
      'https://cdn.koya.gg/gallery/l/y06fE4T.png', 'https://cdn.koya.gg/gallery/l/vbOPkZ4.png', 'https://cdn.koya.gg/gallery/l/W26rNNb.png'
    ];
    const thumbs = urls.map(u => `<img class="banner-thumb" src="/api/proxy-image?url=${encodeURIComponent(u)}" title="Click to use" data-banner-target="${id}" data-banner-url="${u}" />`).join('');
    return `<div class="form-group">
      <label class="field-label">${label}</label>
      <div class="banner-preview-wrap">
        <img id="${id}_preview" class="banner-preview" src="/api/proxy-image?url=${encodeURIComponent('https://cdn.koya.gg/gallery/l/9tQ5kUy.png')}" data-banner-preview/>
      </div>
      <input type="text" id="${id}" class="text-input" placeholder="https://..." data-banner-input="${id}"/>
      <details class="banner-gallery-details">
        <summary>Choose from gallery (Suggested backgrounds)</summary>
        <div class="banner-gallery-grid">
          ${thumbs}
        </div>
      </details>
    </div>`;
  }
  // CSP script-src 'self' chan moi thuoc tinh su kien inline (onclick/oninput/onerror),
  // nen phai gan listener bang JS. Su kien 'error' khong bubble => khong the uy quyen,
  // phai gan truc tiep sau moi lan buildAllSections() thay doi innerHTML.
  const BANNER_FALLBACK = '/api/proxy-image?url=' + encodeURIComponent('https://cdn.koya.gg/gallery/l/9tQ5kUy.png');
  function wireBannerPickers() {
    document.querySelectorAll('img[data-banner-preview]').forEach(img => {
      img.onerror = () => { img.src = BANNER_FALLBACK; };
    });
    document.querySelectorAll('input[data-banner-input]').forEach(input => {
      input.addEventListener('input', () => {
        const preview = document.getElementById(input.dataset.bannerInput + '_preview');
        if (preview) preview.src = input.value ? '/api/proxy-image?url=' + encodeURIComponent(input.value) : BANNER_FALLBACK;
      });
    });
  }
  // Gan MOT LAN len #configForm (phan tu on dinh, chi innerHTML bi thay the).
  // Gan ben trong buildAllSections() se chong listener moi lan render lai.
  document.getElementById('configForm')?.addEventListener('click', (e) => {
    const thumb = e.target.closest('.banner-thumb[data-banner-url]');
    if (thumb) {
      const input = document.getElementById(thumb.dataset.bannerTarget);
      const preview = document.getElementById(thumb.dataset.bannerTarget + '_preview');
      if (input) input.value = thumb.dataset.bannerUrl;
      if (preview) preview.src = '/api/proxy-image?url=' + encodeURIComponent(thumb.dataset.bannerUrl);
      return;
    }
    const guideBtn = e.target.closest('[data-guide]');
    if (guideBtn) window.showGuideModal(guideBtn.dataset.guide);
  });
  function buildAllSections() {
    const form = document.getElementById('configForm');
    form.innerHTML = '';
    form.innerHTML += `<div class="content-section active" id="sec-general"><div class="section-card"><div class="section-card-title">${I.gear} General Configuration</div>${makeRolePicker('autoRoleId', 'Auto-Role', 'Automatically assigned to new members.')}</div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-welcome"><div class="section-card"><div class="section-card-title">${I.chat} Welcome Messages</div>
      ${makeChannelPicker('welcomeChannel', 'Welcome Channel', 'Channel where welcome messages are sent.', [0, 5])}
      ${makeTextarea('welcomeMessageContent', 'Welcome Message Text', 'Welcome {user} to **{server}**!', 'Use {user} for mention, {server} for server name. Sent as text above the banner.', 2)}
      <hr class="divider"/>
      <div class="subsection-title">${I.monitor} Banner Image</div>
      ${makeInput('welcome_text', 'Banner Title Text', 'WELCOME', 'Large text overlaid on the welcome banner image.')}
      ${makeBannerPicker('welcome_bg', 'Banner Background URL')}
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-goodbye"><div class="section-card"><div class="section-card-title">${I.door} Goodbye Messages</div>
      ${makeChannelPicker('goodbyeChannel', 'Goodbye Channel', 'Channel where goodbye messages are sent.', [0, 5])}
      ${makeTextarea('goodbyeMessageContent', 'Goodbye Message Text', '{user} has left **{server}**.', 'Use {user} for mention, {server} for server name.', 2)}
      <hr class="divider"/>
      <div class="subsection-title">${I.monitor} Banner Image</div>
      ${makeInput('goodbye_text', 'Banner Title Text', 'GOOD BYE', 'Large text overlaid on the goodbye banner image.')}
      ${makeBannerPicker('goodbye_bg', 'Banner Background URL')}
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-ticket"><div class="section-card"><div class="section-card-title">${I.ticket} Ticket Support System</div>
      <div class="subsection-title">${I.gear} System Channels & Roles</div>
      ${makeChannelPicker('ticketCategoryId', 'Ticket Category', 'Category under which ticket channels are created.', [4])}
      ${makeMultiRolePicker('ticketStaffRoleIds', 'Support Staff Roles', 'Roles that can manage and view tickets.')}
      ${makeChannelPicker('ticketTranscriptChannel', 'Transcript Log Channel', 'Channel for ticket transcript logs.', [0, 5])}
      ${makeChannelPicker('ticketReviewChannel', 'Review/Rating Channel', 'Channel where ticket reviews are posted.', [0, 5])}
      <hr class="divider"/>
      <div class="subsection-title">${I.chat} Panel Appearance</div>
      ${makeInput('panelTitle', 'Panel Embed Title', '🎫 Support Center', '')}
      ${makeTextarea('panelDescription', 'Panel Embed Description', 'Welcome to the support system...', 'Displayed in the panel embed body.')}
      ${makeInput('panelFooter', 'Panel Embed Footer', 'NexBucket Support System', '')}
      ${makeColorPicker('panelColor', 'Panel Embed Color', '#ff90ba')}
      ${makeInput('panelImageUrl', 'Panel Image URL', 'https://...', 'Image displayed in the panel embed.')}
      ${makeInput('panelSelectPlaceholder', 'Select Menu Placeholder', '🎫 Select support type...', 'Placeholder text in the ticket type dropdown.')}
      <hr class="divider"/>
      <div class="subsection-title">${I.ticket} Ticket Embed & Buttons</div>
      ${makeColorPicker('ticketEmbedColor', 'Ticket Embed Color', '#5865F2')}
      <div class="form-row">${makeInput('embedAuthorName', 'Embed Author Name', 'NexBucket Support', '')}<div class="form-group"><label class="field-label">Embed Author URL</label><input type="text" id="embedAuthorUrl" class="text-input" placeholder="https://..."/></div></div>
      <div class="form-row-3">${makeInput('closeButtonLabel', 'Close Button Label', '🔒 Close Ticket', '')}${makeInput('claimButtonLabel', 'Claim Button Label', '✋ Claim Ticket', '')}${makeInput('forceCloseButtonLabel', 'Force Close Label', '⚡ Force Close', '')}</div>
      <hr class="divider"/>
      <div class="subsection-title">${I.chat} System Messages</div>
      ${makeTextarea('ticketGreetingMessage', 'Ticket Greeting Message', 'Hello {user}, a staff member will assist you shortly!', 'Use {user} for mention. Sent when ticket opens.', 2)}
      ${makeTextarea('staffOnlineMessage', 'Staff Online Message', '✅ {count} staff members online: {staffs}', 'Use {count} and {staffs} placeholders.', 2)}
      ${makeTextarea('staffOfflineMessage', 'Staff Offline Message', '⚠️ No staff members are online...', 'Shown when no staff is online.', 2)}
      ${makeTextarea('dmMessageOnClose', 'DM Message On Close', 'Thank you for using our support system...', 'Use {channel} placeholder. Sent as DM.', 2)}
      ${makeInput('transcriptFooter', 'Transcript Footer Text', 'NexBucket Ticket System', '')}
      <hr class="divider"/>
      <div class="subsection-title">${I.gear} Feature Toggles</div>
      ${makeToggle('enableRating', 'Ticket Rating System', 'Let users rate their ticket support experience.', I.ticket, true)}
      ${makeToggle('enableClaim', 'Staff Claiming', 'Allow staff to claim tickets.', I.shield, true)}
      ${makeToggle('lockClaimedTicket', 'Lock Claimed Tickets', 'Only the claiming staff can respond after claiming.', I.shield, false)}
      <hr class="divider"/>
      <div class="subsection-title">${I.plus} Ticket Categories</div>
      <div id="ticketTypeList" class="ticket-type-list"></div>
      <button type="button" id="btnAddTicketType" class="btn-add-type">${I.plus} Add Ticket Category</button>
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-jtc"><div class="section-card"><div class="section-card-title">${I.speaker} Join to Create — Dynamic Voice Channels</div>
      ${makeChannelPicker('jtcHubChannelId', 'Master Hub Voice Channel', 'Members join this channel to create a temp room.', [2])}
      ${makeChannelPicker('jtcCategoryId', 'Temp Voice Category', 'Category where temporary voice channels are created.', [4])}
      ${makeInput('jtcDefaultName', 'Default Temp Voice Name', "🔊 {username}'s Room", 'Supported placeholders: {username}, {displayName}.', 'text')}
      <div class="form-row">
        ${makeInput('jtcDefaultLimit', 'Default User Limit', '0', '0 means unlimited. Range: 0–99.', 'number')}
        ${makeInput('jtcDefaultBitrate', 'Default Bitrate (kbps)', '64', 'Range: 8–96 kbps, subject to server boost limit.', 'number')}
      </div>
      ${makeToggle('jtcDefaultLocked', 'Lock New Temp Channels', 'New rooms start locked for other members.', I.shield, false)}
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-mod"><div class="section-card"><div class="section-card-title">${I.shield} Security & Moderation</div>
      ${makeToggle('antiSpamEnabled', 'Anti-Spam Protection', 'Detect and punish rapid message spamming.', I.shield, true)}
      ${makeToggle('antiLinkEnabled', 'Anti-Link Filter', 'Delete messages with Discord invites or external links.', I.shield, true)}
      ${makeToggle('antiRaidEnabled', 'Anti-Raid System', 'Detect and block coordinated mass-join attacks.', I.shield, true)}
      ${makeToggle('antiBotKickEnabled', 'Rogue Bot Auto-Kick', 'Auto-kick unauthorized bots.', I.shield, true)}
      <hr class="divider"/>
      <div class="subsection-title">${I.shield} Banned Words Filter (Auto Mod)</div>
      ${makeToggle('badWordsFilterEnabled', 'Enable Banned Words Filter', 'Automatically delete messages containing specific words.', I.chat, false)}
      ${makeTextarea('badWords', 'Banned Words List', 'fuck, bitch, shit...', 'Enter words separated by commas.', 3)}
      ${makeSelect('badWordsPunishment', 'Punishment Action', [
        { value: 'delete', label: 'Delete Message Only' },
        { value: 'warn', label: 'Delete & Warn User' },
        { value: 'timeout10', label: 'Delete & Timeout 10 Minutes' },
        { value: 'timeout60', label: 'Delete & Timeout 1 Hour' },
        { value: 'kick', label: 'Delete & Kick User' },
        { value: 'ban', label: 'Delete & Ban User' }
      ], 'Action taken when a user sends a banned word.')}
      <hr class="divider"/>
      <div class="subsection-title">${I.chat} Prefix Commands (Moderation)</div>
      ${makeToggle('enablePrefixCommands', 'Enable Prefix Commands', 'Allow using ban, kick, mute, etc. via text commands.', I.chat, true)}
      <div class="form-row">
        ${makeInput('modPrefix', 'Command Prefix', '!', 'Special character to trigger commands (e.g. !, ?, +)')}
        ${makeInput('warnThreshold', 'Warning Threshold', '3', 'Number of warns before auto-ban.', 'number')}
      </div>
      ${makeChannelPicker('modLogChannel', 'Moderation Log Channel', 'Channel for moderation action logs.', [0, 5])}
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-bank"><div class="section-card"><div class="section-card-title">${I.card} VietQR & PayOS Banking</div>
      <div class="subsection-title">${I.card} Bank Account</div>
      <div class="form-row-3">${makeInput('bankBin', 'Bank BIN Code', '970422', 'MBBank: 970422, VCB: 970436')}${makeInput('bankAccountNo', 'Account Number', '', '')}${makeInput('bankAccountName', 'Account Owner', 'NGUYEN VAN A', '')}</div>
      <hr class="divider"/><div class="subsection-title" style="display:flex;justify-content:space-between;align-items:center;"><span>${I.shield} PayOS</span><button type="button" class="btn-add-type" style="width:auto;padding:4px 12px;font-size:.75rem;" data-guide="payos">❓ ${window.NexI18n?.t('guide_btn') || 'Setup Guide'}</button></div>
      <div class="form-row-3">${makeInput('payosClientId', 'Client ID', '', '')}${makeInput('payosApiKey', 'API Key', '', '', 'password')}${makeInput('payosChecksumKey', 'Checksum Key', '', '', 'password')}</div>
      <hr class="divider"/><div class="subsection-title" style="display:flex;justify-content:space-between;align-items:center;"><span>${I.card} Card2K <span id="cardConfigStatus" class="perm-badge">Checking</span></span><button type="button" class="btn-add-type" style="width:auto;padding:4px 12px;font-size:.75rem;" data-guide="card2k">❓ ${window.NexI18n?.t('guide_btn') || 'Setup Guide'}</button></div>
      <div class="form-row-3">${makeInput('cardPartnerId', 'Partner ID', '', '')}${makeInput('cardPartnerKey', 'Partner Key', '', 'Để trống để giữ key đã lưu; gõ __CLEAR__ để xoá.', 'password')}${makeInput('cardDomain', 'Domain', 'card2k.com', 'Chỉ nhập hostname HTTPS.')}</div>
      ${makeChannelPicker('bankNotifChannel', 'Payment Notification Channel', '', [0, 5])}
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-status"><div class="section-card"><div class="section-card-title">${I.monitor} Minecraft & Server Status</div>
      <div class="field-hint">Refresh interval is controlled globally by UPDATE_INTERVAL.</div>
      <hr class="divider"/>
      <div class="subsection-title">${I.monitor} Tracked Servers</div>
      <div id="statusServersList" class="ticket-type-list" style="min-height:10px;"></div>
      <button type="button" id="btnAddStatusServer" class="btn-add-type">${I.plus} Add Tracked Server</button>
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-stats"><div class="section-card"><div class="section-card-title">${I.users} Server Stats Channels</div>
      ${makeChannelPicker('statsCategoryId', 'Stats Category', 'Category containing stat channels.', [4])}
      <div class="form-row">${makeChannelPicker('statsAllMembersId', 'All Members Channel', '', [2])}${makeChannelPicker('statsHumansId', 'Humans Channel', '', [2])}</div>
      <div class="form-row">${makeChannelPicker('statsStaffOnlineId', 'Staff Online Channel', '', [2])}${makeChannelPicker('statsBotCountId', 'Bot Count Channel', '', [2])}</div>
    </div></div>`;
    form.innerHTML += `<div class="content-section" id="sec-transcripts"><div class="section-card"><div class="section-card-title">${I.ticket} Ticket Transcripts</div><div id="transcriptListArea" style="min-height:100px;"><div class="empty-state">Click to load transcripts...</div></div></div></div>`;
    initAllPickers();
    initColorPickers();
    initTicketTypeManager();
    initStatusServerManager();
  }
  function initAllPickers() {
    document.querySelectorAll('.picker-wrap').forEach(wrap => {
      const type = wrap.dataset.pickerType;
      const display = wrap.querySelector('.picker-display, .picker-multi-display');
      const dropdown = wrap.querySelector('.picker-dropdown');
      const search = wrap.querySelector('.picker-search');
      const options = wrap.querySelectorAll('.picker-option');
      if (!display || !dropdown) return;
      display.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('show');
        closeAllPickers();
        if (!isOpen) { wrap.classList.add('elevated'); dropdown.classList.add('show'); display.classList.add('open'); search?.focus(); }
      });
      search?.addEventListener('input', () => {
        const q = search.value.toLowerCase();
        options.forEach(o => { o.style.display = (o.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
      });
      if (type === 'multi-role') {
        options.forEach(o => o.addEventListener('click', e => {
          e.stopPropagation();
          o.classList.toggle('selected');
          renderMultiRoleTags(wrap);
        }));
      } else {
        options.forEach(o => o.addEventListener('click', e => {
          e.stopPropagation();
          options.forEach(x => x.classList.remove('selected'));
          o.classList.add('selected');
          const selText = display.querySelector('.selected-text');
          const ph = display.querySelector('.ph');
          if (selText) { selText.textContent = o.querySelector('.ch-name, .role-name')?.textContent || o.textContent; selText.classList.remove('hidden'); }
          if (ph) ph.classList.add('hidden');
          wrap.classList.remove('elevated'); dropdown.classList.remove('show'); display.classList.remove('open');
        }));
      }
    });
    document.addEventListener('click', () => closeAllPickers());
  }
  function closeAllPickers() {
    document.querySelectorAll('.picker-wrap.elevated').forEach(w => w.classList.remove('elevated'));
    document.querySelectorAll('.picker-dropdown.show').forEach(d => d.classList.remove('show'));
    document.querySelectorAll('.picker-display.open, .picker-multi-display.open').forEach(d => d.classList.remove('open'));
  }
  function renderMultiRoleTags(wrap) {
    const display = wrap.querySelector('.picker-multi-display');
    const selected = wrap.querySelectorAll('.picker-option.selected');
    const ph = display.querySelector('.ph');
    display.querySelectorAll('.picker-selected-tag').forEach(t => t.remove());
    if (selected.length === 0) { if (ph) ph.classList.remove('hidden'); return; }
    if (ph) ph.classList.add('hidden');
    selected.forEach(o => {
      const tag = document.createElement('span');
      tag.className = 'picker-selected-tag';
      tag.innerHTML = `${esc(o.querySelector('.role-name')?.textContent || '')} <span class="tag-remove" data-value="${o.dataset.value}">&times;</span>`;
      tag.querySelector('.tag-remove').addEventListener('click', e => { e.stopPropagation(); o.classList.remove('selected'); renderMultiRoleTags(wrap); });
      display.appendChild(tag);
    });
  }
  function setPickerValue(pickerId, value) {
    const wrap = document.querySelector(`.picker-wrap[data-picker-id="${pickerId}"]`);
    if (!wrap || !value) return;
    const option = wrap.querySelector(`.picker-option[data-value="${value}"]`);
    if (option) {
      option.classList.add('selected');
      const display = wrap.querySelector('.picker-display');
      if (display) {
        const selText = display.querySelector('.selected-text');
        const ph = display.querySelector('.ph');
        if (selText) { selText.textContent = option.querySelector('.ch-name, .role-name')?.textContent || ''; selText.classList.remove('hidden'); }
        if (ph) ph.classList.add('hidden');
      }
    }
  }
  function setMultiPickerValues(pickerId, values) {
    const wrap = document.querySelector(`.picker-wrap[data-picker-id="${pickerId}"]`);
    if (!wrap || !values?.length) return;
    values.forEach(v => { const o = wrap.querySelector(`.picker-option[data-value="${v}"]`); if (o) o.classList.add('selected'); });
    renderMultiRoleTags(wrap);
  }
  function getPickerValue(pickerId) {
    const wrap = document.querySelector(`.picker-wrap[data-picker-id="${pickerId}"]`);
    if (!wrap) return '';
    const sel = wrap.querySelector('.picker-option.selected');
    return sel?.dataset.value || '';
  }
  function getMultiPickerValues(pickerId) {
    const wrap = document.querySelector(`.picker-wrap[data-picker-id="${pickerId}"]`);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.picker-option.selected')).map(o => o.dataset.value);
  }
  function initColorPickers() {
    document.querySelectorAll('.color-dot').forEach(dot => {
      const id = dot.dataset.colorFor;
      const colorInput = document.getElementById(id + 'Color');
      const textInput = document.getElementById(id);
      dot.addEventListener('click', () => colorInput?.click());
      colorInput?.addEventListener('input', () => { const v = colorInput.value; if (textInput) textInput.value = v; dot.style.background = v; });
      textInput?.addEventListener('input', () => { const v = textInput.value; if (/^#[0-9A-Fa-f]{6}$/.test(v)) { if (colorInput) colorInput.value = v; dot.style.background = v; }});
    });
  }
  let ticketTypes = [];
  let statusServers = [];
  function initTicketTypeManager() {
    document.getElementById('btnAddTicketType')?.addEventListener('click', () => showAddTicketTypeModal());
    renderTicketTypes();
  }
  function renderTicketTypes() {
    const list = document.getElementById('ticketTypeList');
    if (!list) return;
    list.innerHTML = '';
    if (ticketTypes.length === 0) { list.innerHTML = '<div class="empty-state" style="padding:14px">No ticket categories defined yet.</div>'; return; }
    ticketTypes.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'ticket-type-item';
      item.innerHTML = `<span class="tt-emoji">${renderEmoji(t.emoji || '🎫')}</span><div class="tt-info"><div class="tt-label">${esc(t.label || 'Untitled')}</div><div class="tt-desc">${esc(t.description || '')}</div></div><div class="tt-actions"><button type="button" class="tt-edit" data-idx="${i}" title="Edit Category" style="background:transparent; border:none; cursor:pointer; color:var(--text-muted); font-size:16px;">${I.edit}</button><button type="button" class="tt-remove" data-idx="${i}" title="Remove Category">${I.x}</button></div>`;
      item.querySelector('.tt-edit').addEventListener('click', () => showEditTicketTypeModal(i));
      item.querySelector('.tt-remove').addEventListener('click', () => { ticketTypes.splice(i, 1); renderTicketTypes(); });
      list.appendChild(item);
    });
  }
  function showEditTicketTypeModal(idx) {
    const t = ticketTypes[idx];
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'modalOverlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
    overlay.innerHTML = `<div class="modal"><h3>Edit Ticket Category</h3>${makeInput('ttId', 'Category ID / Prefix', 'general', 'Used for channel names (e.g. general-0001)', 'text', esc(t.id || t.value || t.channelPrefix || ''))}${makeInput('ttLabel', 'Label', 'General Support', '', 'text', esc(t.label || ''))}${makeInput('ttEmoji', 'Emoji', '🎫', '', 'text', esc(t.emoji || ''))}${makeInput('ttDescription', 'Description', 'Get help with general questions.', '', 'text', esc(t.description || ''))}<div class="modal-actions"><button class="btn-modal" id="btnCancelModal">Cancel</button><button class="btn-modal primary" id="btnConfirmModal">Save</button></div></div>`;
    overlay.classList.add('show');
    overlay.querySelector('#btnCancelModal').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.querySelector('#btnConfirmModal').addEventListener('click', () => {
      const id = document.getElementById('ttId')?.value?.trim() || document.getElementById('ttLabel')?.value?.trim().toLowerCase().replace(/\s+/g, '_');
      const label = document.getElementById('ttLabel')?.value?.trim();
      const emoji = document.getElementById('ttEmoji')?.value?.trim() || '🎫';
      const description = document.getElementById('ttDescription')?.value?.trim() || '';
      if (!label) return;
      ticketTypes[idx] = { ...t, id, label, emoji, description, channelPrefix: id };
      renderTicketTypes();
      overlay.classList.remove('show');
    });
  }
  function showAddTicketTypeModal() {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'modalOverlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
    overlay.innerHTML = `<div class="modal"><h3>Add Ticket Category</h3>${makeInput('ttId', 'Category ID / Prefix', 'general', 'Used for channel names (e.g. general-0001)')}${makeInput('ttLabel', 'Label', 'General Support', '')}${makeInput('ttEmoji', 'Emoji', '🎫', '')}${makeInput('ttDescription', 'Description', 'Get help with general questions.', '')}<div class="modal-actions"><button class="btn-modal" id="btnCancelModal">Cancel</button><button class="btn-modal primary" id="btnConfirmModal">Add</button></div></div>`;
    overlay.classList.add('show');
    overlay.querySelector('#btnCancelModal').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.querySelector('#btnConfirmModal').addEventListener('click', () => {
      const id = document.getElementById('ttId')?.value?.trim() || document.getElementById('ttLabel')?.value?.trim().toLowerCase().replace(/\s+/g, '_');
      const label = document.getElementById('ttLabel')?.value?.trim();
      const emoji = document.getElementById('ttEmoji')?.value?.trim() || '🎫';
      const description = document.getElementById('ttDescription')?.value?.trim() || '';
      if (!label) return;
      ticketTypes.push({ id, label, emoji, description, channelPrefix: id });
      renderTicketTypes();
      overlay.classList.remove('show');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
  }
  function initStatusServerManager() {
    document.getElementById('btnAddStatusServer')?.addEventListener('click', () => showAddStatusServerModal());
    renderStatusServers();
  }
  function renderStatusServers() {
    const list = document.getElementById('statusServersList');
    if (!list) return;
    list.innerHTML = '';
    if (statusServers.length === 0) { list.innerHTML = '<div class="empty-state" style="padding:14px">No servers tracked yet.</div>'; return; }
    statusServers.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'ticket-type-item';
      const channelName = guildChannels.find(c => c.id === s.channelId)?.name || s.channelId;
      item.innerHTML = `<span class="tt-emoji">${I.monitor}</span><div class="tt-info"><div class="tt-label">${esc(s.ip)}:${s.port}</div><div class="tt-desc">Channel: #${esc(channelName)}</div></div><div class="tt-actions"><button type="button" class="tt-remove" data-idx="${i}" title="Remove Server">${I.x}</button></div>`;
      item.querySelector('.tt-remove').addEventListener('click', () => { statusServers.splice(i, 1); renderStatusServers(); });
      list.appendChild(item);
    });
  }
  function showAddStatusServerModal() {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'modalOverlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
    overlay.innerHTML = `<div class="modal"><h3>Add Tracked Server</h3>${makeInput('msIp', 'Server IP', 'play.example.com', '')}${makeInput('msPort', 'Server Port', '25565', '', 'number')}${makeChannelPicker('msChannel', 'Update Channel', '', [0, 5])}<div class="modal-actions"><button class="btn-modal" id="btnCancelModal">Cancel</button><button class="btn-modal primary" id="btnConfirmModal">Add</button></div></div>`;
    overlay.classList.add('show');
    
    const wrap = overlay.querySelector('.picker-wrap[data-picker-id="msChannel"]');
    const dropdown = wrap?.querySelector('.picker-dropdown');
    const selectBtn = wrap?.querySelector('.picker-display');
    const search = wrap?.querySelector('.picker-search');
    const options = wrap?.querySelectorAll('.picker-option') || [];
    selectBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = !dropdown.classList.contains('show');
      wrap.classList.toggle('elevated', opening);
      dropdown.classList.toggle('show', opening);
      selectBtn.classList.toggle('open', opening);
      if (opening) search?.focus();
    });
    search?.addEventListener('input', () => {
      const query = search.value.toLowerCase();
      options.forEach(option => {
        option.style.display = option.textContent.toLowerCase().includes(query) ? '' : 'none';
      });
    });
    options.forEach(option => option.addEventListener('click', (event) => {
      event.stopPropagation();
      options.forEach(item => item.classList.remove('selected'));
      option.classList.add('selected');
      const selectedText = selectBtn.querySelector('.selected-text');
      const placeholder = selectBtn.querySelector('.ph');
      selectedText.textContent = option.querySelector('.ch-name')?.textContent || option.textContent;
      selectedText.classList.remove('hidden');
      placeholder.classList.add('hidden');
      wrap.classList.remove('elevated');
      dropdown.classList.remove('show');
      selectBtn.classList.remove('open');
    }));

    overlay.querySelector('#btnCancelModal').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.querySelector('#btnConfirmModal').addEventListener('click', () => {
      const ip = document.getElementById('msIp')?.value?.trim();
      const port = parseInt(document.getElementById('msPort')?.value) || 25565;
      const channelId = getPickerValue('msChannel');
      if (!ip || !channelId) {
         showStatus('IP and Channel are required!', 'error');
         return;
      }
      statusServers.push({ ip, port, channelId });
      renderStatusServers();
      overlay.classList.remove('show');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
  }

  // Expose globally for onclick
  window.showGuideModal = function(type) {
    const t = window.NexI18n ? window.NexI18n.t.bind(window.NexI18n) : (k) => k;
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'modalOverlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
    
    const baseUrl = window.location.origin;
    const isPayos = type === 'payos';
    const title = t(isPayos ? 'guide_title_payos' : 'guide_title_card2k');
    const steps = t(isPayos ? 'guide_payos_steps' : 'guide_card2k_steps');
    const webhookUrl = isPayos ? `${baseUrl}/api/webhooks/payos` : `${baseUrl}/api/webhooks/card2k`;
    const copyText = t('guide_copy');

    let stepsHtml = '<ol class="guide-steps">';
    if (Array.isArray(steps)) {
      steps.forEach(step => {
        stepsHtml += `<li>${step}`;
        if (step.includes('Webhook') || step.includes('Callback')) {
          stepsHtml += `<div class="guide-webhook-url"><code>${webhookUrl}</code><button type="button" data-copy="${webhookUrl}" data-copied-label="${t('guide_copied')}" data-copy-label="${copyText}">${copyText}</button></div>`;
        }
        stepsHtml += '</li>';
      });
    }
    stepsHtml += '</ol>';

    overlay.innerHTML = `<div class="modal" style="max-width:560px;"><h3>${title}</h3>${stepsHtml}<div class="modal-actions"><button class="btn-modal primary" id="btnCloseGuide">${t('cancel') === 'cancel' ? 'Close' : 'Đóng'}</button></div></div>`;
    overlay.classList.add('show');
    overlay.querySelector('#btnCloseGuide').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copy).then(() => {
          btn.textContent = btn.dataset.copiedLabel;
          setTimeout(() => { btn.textContent = btn.dataset.copyLabel; }, 2000);
        });
      });
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
  };
  async function loadConfig(guildId, attempt = 0) {
    showStatus(attempt ? 'Database waking up, retrying...' : 'Loading configuration...', 'info');
    try {
      const r = await fetch(`/api/config/${guildId}`);
      if (r.status === 503) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 4000 * (attempt + 1)));
          return loadConfig(guildId, attempt + 1);
        }
        const unavailable = await r.json().catch(() => ({}));
        throw new Error(unavailable.error || 'Database temporarily unavailable. Try again in a few seconds.');
      }
      if (!r.ok) throw new Error('Failed to load config');
      const c = await r.json();
      configVersion = Number(c.configVersion || 0);
      setPickerValue('autoRoleId', c.autoroleId);
      setPickerValue('welcomeChannel', c.welcomeConfig?.welcomeChannel);
      setVal('welcomeMessageContent', c.welcomeConfig?.welcomeMessageContent);
      setVal('welcome_text', c.welcomeConfig?.welcomeText);
      setVal('welcome_bg', c.welcomeConfig?.welcomeBg);
      if (c.welcomeConfig?.welcomeBg) { const img = document.getElementById('welcome_bg_preview'); if (img) img.src = '/api/proxy-image?url=' + encodeURIComponent(c.welcomeConfig.welcomeBg); }
      setPickerValue('goodbyeChannel', c.welcomeConfig?.goodbyeChannel);
      setVal('goodbyeMessageContent', c.welcomeConfig?.goodbyeMessageContent);
      setVal('goodbye_text', c.welcomeConfig?.goodbyeText);
      setVal('goodbye_bg', c.welcomeConfig?.goodbyeBg);
      if (c.welcomeConfig?.goodbyeBg) { const img = document.getElementById('goodbye_bg_preview'); if (img) img.src = '/api/proxy-image?url=' + encodeURIComponent(c.welcomeConfig.goodbyeBg); }
      const tc = c.ticketConfig || {};
      setPickerValue('ticketCategoryId', tc.categoryId);
      setMultiPickerValues('ticketStaffRoleIds', tc.staffRoleIds || (tc.staffRoleId ? [tc.staffRoleId] : []));
      setPickerValue('ticketTranscriptChannel', tc.transcriptChannelId);
      setPickerValue('ticketReviewChannel', tc.reviewChannelId);
      setVal('panelTitle', tc.panelTitle);
      setVal('panelDescription', tc.panelDescription);
      setVal('panelFooter', tc.panelFooter);
      setColorVal('panelColor', tc.panelColor || '#ff90ba');
      setVal('panelImageUrl', tc.panelImageUrl);
      setVal('panelSelectPlaceholder', tc.panelSelectPlaceholder);
      setColorVal('ticketEmbedColor', tc.ticketEmbedColor || '#5865F2');
      setVal('embedAuthorName', tc.embedAuthorName);
      setVal('embedAuthorUrl', tc.embedAuthorUrl);
      setVal('closeButtonLabel', tc.closeButtonLabel);
      setVal('claimButtonLabel', tc.claimButtonLabel);
      setVal('forceCloseButtonLabel', tc.forceCloseButtonLabel);
      setVal('ticketGreetingMessage', tc.ticketGreetingMessage);
      setVal('staffOnlineMessage', tc.staffOnlineMessage);
      setVal('staffOfflineMessage', tc.staffOfflineMessage);
      setVal('dmMessageOnClose', tc.dmMessageOnClose);
      setVal('transcriptFooter', tc.transcriptFooter);
      setChecked('enableRating', tc.enableRating !== false);
      setChecked('enableClaim', tc.enableClaim !== false);
      setChecked('lockClaimedTicket', tc.lockClaimedTicket === true);
      ticketTypes = tc.ticketTypes || [];
      renderTicketTypes();
      setPickerValue('jtcHubChannelId', c.jtcConfig?.hubChannelId);
      setPickerValue('jtcCategoryId', c.jtcConfig?.categoryId);
      setVal('jtcDefaultName', c.jtcConfig?.defaultName || "🔊 {username}'s Room");
      setVal('jtcDefaultLimit', String(c.jtcConfig?.defaultLimit ?? 0));
      setVal('jtcDefaultBitrate', String(Math.round((c.jtcConfig?.defaultBitrate || 64000) / 1000)));
      setChecked('jtcDefaultLocked', c.jtcConfig?.defaultLocked === true);
      setChecked('antiSpamEnabled', c.modConfig?.antiSpam !== false);
      setChecked('antiLinkEnabled', c.modConfig?.antiLink !== false);
      setChecked('antiRaidEnabled', c.modConfig?.antiRaid !== false);
      setChecked('antiBotKickEnabled', c.modConfig?.antiBotKick !== false);
      setChecked('enablePrefixCommands', c.modConfig?.enablePrefixCommands !== false);
      setVal('modPrefix', c.modConfig?.modPrefix || '!');
      setVal('warnThreshold', c.modConfig?.warnThreshold || 3);
      setPickerValue('modLogChannel', c.modConfig?.modLogChannel);
      setChecked('badWordsFilterEnabled', c.modConfig?.badWordsFilterEnabled === true);
      setVal('badWords', c.modConfig?.badWords || '');
      setVal('badWordsPunishment', c.modConfig?.badWordsPunishment || 'warn');
      const bc = c.bankConfig || {};
      setVal('bankBin', bc.bankBin);
      setVal('bankAccountNo', bc.accountNo);
      setVal('bankAccountName', bc.accountName);
      setVal('payosClientId', '');
      setVal('payosApiKey', '');
      setVal('payosChecksumKey', '');
      setPickerValue('bankNotifChannel', bc.notificationChannelId);
      const cc = c.cardConfig || {};
      setVal('cardPartnerId', cc.partnerId);
      setVal('cardPartnerKey', '');
      setVal('cardDomain', cc.domain || 'card2k.com');
      const cardStatus = document.getElementById('cardConfigStatus');
      if (cardStatus) {
        cardStatus.textContent = cc.cardConfigured ? 'Đã cấu hình' : `Chưa sẵn sàng: ${cc.status || 'missing'}`;
        cardStatus.className = `perm-badge ${cc.cardConfigured ? 'badge-owner' : 'badge-manage_server'}`;
      }
      // Server không bao giờ gửi secret về đây, nên các ô này luôn trống.
      markSecretField('payosClientId', bc.payosConfigured);
      markSecretField('payosApiKey', bc.payosConfigured);
      markSecretField('payosChecksumKey', bc.payosConfigured);
      markSecretField('cardPartnerKey', cc.cardConfigured);
      statusServers = c.statusConfig?.servers || [];
      renderStatusServers();
      setPickerValue('statsCategoryId', c.statsConfig?.categoryId);
      setPickerValue('statsAllMembersId', c.statsConfig?.allMembersChannelId);
      setPickerValue('statsHumansId', c.statsConfig?.humansChannelId);
      setPickerValue('statsStaffOnlineId', c.statsConfig?.staffOnlineChannelId);
      setPickerValue('statsBotCountId', c.statsConfig?.botCountChannelId);
      showStatus('', '');
    } catch (err) { showStatus(err.message, 'error'); }
  }
  btnSave?.addEventListener('click', async () => {
    if (!currentGuildId) return;
    showStatus('Saving to Supabase...', 'info');
    btnSave.disabled = true;
    const payload = {
      configVersion,
      autoroleId: getPickerValue('autoRoleId'),
      welcomeConfig: {
        welcomeChannel: getPickerValue('welcomeChannel'),
        goodbyeChannel: getPickerValue('goodbyeChannel'),
        welcomeMessageContent: getVal('welcomeMessageContent'),
        goodbyeMessageContent: getVal('goodbyeMessageContent'),
        welcomeText: getVal('welcome_text'),
        goodbyeText: getVal('goodbye_text'),
        welcomeBg: getVal('welcome_bg'),
        goodbyeBg: getVal('goodbye_bg'),
      },
      ticketConfig: {
        categoryId: getPickerValue('ticketCategoryId'),
        staffRoleIds: getMultiPickerValues('ticketStaffRoleIds'),
        transcriptChannelId: getPickerValue('ticketTranscriptChannel'),
        reviewChannelId: getPickerValue('ticketReviewChannel'),
        panelTitle: getVal('panelTitle'),
        panelDescription: getVal('panelDescription'),
        panelFooter: getVal('panelFooter'),
        panelColor: getVal('panelColor'),
        panelImageUrl: getVal('panelImageUrl'),
        panelSelectPlaceholder: getVal('panelSelectPlaceholder'),
        ticketEmbedColor: getVal('ticketEmbedColor'),
        embedAuthorName: getVal('embedAuthorName'),
        embedAuthorUrl: getVal('embedAuthorUrl'),
        closeButtonLabel: getVal('closeButtonLabel'),
        claimButtonLabel: getVal('claimButtonLabel'),
        forceCloseButtonLabel: getVal('forceCloseButtonLabel'),
        ticketGreetingMessage: getVal('ticketGreetingMessage'),
        staffOnlineMessage: getVal('staffOnlineMessage'),
        staffOfflineMessage: getVal('staffOfflineMessage'),
        dmMessageOnClose: getVal('dmMessageOnClose'),
        transcriptFooter: getVal('transcriptFooter'),
        enableRating: isChecked('enableRating'),
        enableClaim: isChecked('enableClaim'),
        lockClaimedTicket: isChecked('lockClaimedTicket'),
        ticketTypes,
      },
      jtcConfig: {
        hubChannelId: getPickerValue('jtcHubChannelId'),
        categoryId: getPickerValue('jtcCategoryId'),
        defaultName: getVal('jtcDefaultName') || "🔊 {username}'s Room",
        defaultLimit: Number(getVal('jtcDefaultLimit') || 0),
        defaultLocked: isChecked('jtcDefaultLocked'),
        defaultBitrate: Number(getVal('jtcDefaultBitrate') || 64) * 1000,
      },
      modConfig: {
        antiSpam: isChecked('antiSpamEnabled'),
        antiLink: isChecked('antiLinkEnabled'),
        antiRaid: isChecked('antiRaidEnabled'),
        antiBotKick: isChecked('antiBotKickEnabled'),
        enablePrefixCommands: isChecked('enablePrefixCommands'),
        modPrefix: getVal('modPrefix') || '!',
        warnThreshold: parseInt(getVal('warnThreshold')) || 3,
        modLogChannel: getPickerValue('modLogChannel'),
        badWordsFilterEnabled: isChecked('badWordsFilterEnabled'),
        badWords: getVal('badWords'),
        badWordsPunishment: getVal('badWordsPunishment'),
      },
      bankConfig: {
        bankBin: getVal('bankBin'),
        accountNo: getVal('bankAccountNo'),
        accountName: getVal('bankAccountName'),
        payosClientId: getVal('payosClientId'),
        payosApiKey: getVal('payosApiKey'),
        payosChecksumKey: getVal('payosChecksumKey'),
        notificationChannelId: getPickerValue('bankNotifChannel'),
      },
      cardConfig: {
        partnerId: getVal('cardPartnerId'),
        partnerKey: getVal('cardPartnerKey'),
        domain: getVal('cardDomain'),
      },
      statusConfig: {
        servers: statusServers,
      },
      statsConfig: {
        categoryId: getPickerValue('statsCategoryId'),
        allMembersChannelId: getPickerValue('statsAllMembersId'),
        humansChannelId: getPickerValue('statsHumansId'),
        staffOnlineChannelId: getPickerValue('statsStaffOnlineId'),
        botCountChannelId: getPickerValue('statsBotCountId'),
      },
    };
    try {
      const r = await fetch(`/api/config/${currentGuildId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await r.json();
      if (r.status === 409) {
        showStatus(result.error || 'Settings changed. Reloading...', 'error');
        await loadConfig(currentGuildId);
        return;
      }
      if (!r.ok) throw new Error(result.error || 'Save failed');
      configVersion = Number(result.configVersion || configVersion);
      await loadConfig(currentGuildId);
      showStatus('Configuration saved and verified!', 'success');
      setTimeout(() => showStatus('', ''), 4000);
    } catch (err) { showStatus(`Error: ${err.message}`, 'error'); }
    finally { btnSave.disabled = false; }
  });
  function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }
  function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }
  /** Cho biết một ô secret đang có giá trị lưu sẵn, và cách giữ lại hoặc xoá nó. */
  function markSecretField(id, isConfigured) {
    const el = document.getElementById(id);
    if (!el) return;
    el.placeholder = isConfigured
      ? '•••••• đã lưu — để trống để giữ nguyên, gõ __CLEAR__ để xoá'
      : 'Chưa cấu hình';
  }
  function isChecked(id) { return document.getElementById(id)?.checked ?? false; }
  function setChecked(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val; }
  function setColorVal(id, val) {
    const color = val || '#5865F2';
    setVal(id, color);
    const cInput = document.getElementById(id + 'Color');
    if (cInput && /^#[0-9A-Fa-f]{6}$/.test(color)) cInput.value = color;
    const dot = document.getElementById(id + 'Dot');
    if (dot) dot.style.background = color;
  }
  function showStatus(msg, type) { if (saveStatus) { saveStatus.textContent = msg; saveStatus.className = `save-status ${type}`; } }
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
  function renderEmoji(raw) {
    if (!raw) return '🎫';
    const match = raw.match(/^<(a?):([^:]+):(\d+)>$/);
    if (match) {
      const animated = match[1] === 'a';
      const name = match[2];
      const id = match[3];
      const ext = animated ? 'gif' : 'png';
      return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt="${esc(name)}" style="width:22px;height:22px;vertical-align:middle;object-fit:contain" />`;
    }
    return esc(raw);
  }
  window.addEventListener('popstate', (e) => {
    const route = parseRoute();
    if (route.serverId && guildsData.length) {
      const guild = guildsData.find(g => g.id === route.serverId);
      if (guild) openDashboard(guild, route.section || 'general', false);
    } else if (currentGuildId) {
      dashboardLayout.classList.add('hidden');
      serverPickerView.classList.remove('hidden');
      currentGuildId = null;
    }
  });
  function parseMentions(str) {
    if (!str) return '';
    return esc(str)
      .replace(/&lt;@!?(\d+)&gt;/g, '<span style="background:var(--brand-experiment-15a);color:var(--brand-experiment);padding:0 4px;border-radius:3px;">@User</span>')
      .replace(/&lt;@&amp;(\d+)&gt;/g, '<span style="background:var(--brand-experiment-15a);color:var(--brand-experiment);padding:0 4px;border-radius:3px;">@Role</span>')
      .replace(/&lt;#(\d+)&gt;/g, '<span style="background:var(--brand-experiment-15a);color:var(--brand-experiment);padding:0 4px;border-radius:3px;">#channel</span>')
      .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}" alt=":${name}:" style="width:18px;height:18px;vertical-align:middle;"/>`);
  }

  async function loadTranscripts(page = 1) {
    const area = document.getElementById('transcriptListArea');
    if (!area || !currentGuildId) return;
    area.innerHTML = '<div class="empty-state">Loading transcripts...</div>';
    try {
      const r = await fetch(`/api/guilds/${currentGuildId}/transcripts?page=${page}&limit=50`);
      if (!r.ok) throw new Error('Failed to load');
      const payload = await r.json();
      const list = Array.isArray(payload) ? payload : payload.items || [];
      if (!list.length) { area.innerHTML = '<div class="empty-state">No transcripts found for this server.</div>'; return; }
      const grouped = {};
      list.forEach(t => {
        const d = new Date(t.created_at);
        const key = d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(t);
      });
      let html = '';
      for (const [date, items] of Object.entries(grouped)) {
        html += `<div style="margin-bottom:24px;"><div style="font-size:13px;font-weight:600;color:var(--text-m);text-transform:uppercase;margin-bottom:8px;letter-spacing:0.5px;">${esc(date)}</div>`;
        items.forEach(t => {
          const time = new Date(t.created_at).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
          let metaHtml = `Created at ${time}`;
          if (t.closed_by) {
            metaHtml += ` • Closed by ${/^\d+$/.test(t.closed_by) ? parseMentions('<@' + t.closed_by + '>') : esc(t.closed_by)}`;
          }
          if (t.claimed_by) {
            metaHtml += ` • Claimed by ${/^\d+$/.test(t.claimed_by) ? parseMentions('<@' + t.claimed_by + '>') : esc(t.claimed_by)}`;
          }
          html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;">`;
          html += `<div style="display:flex;flex-direction:column;gap:2px;"><span style="font-weight:600;color:var(--text);">#${esc(t.ticket_name)}</span><span style="font-size:12px;color:var(--text-m);">${metaHtml}</span></div>`;
          html += `<a href="/transcript/${esc(t.id)}" target="_blank" style="padding:6px 16px;background:var(--accent);color:#fff;border-radius:var(--r-md);font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap;">View</a>`;
          html += `</div>`;
        });
        html += `</div>`;
      }
      if (!Array.isArray(payload) && payload.totalPages > 1) {
        html += `<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;">`;
        html += `<button type="button" class="btn-back" data-transcript-page="${payload.page - 1}" ${payload.page <= 1 ? 'disabled' : ''}>Previous</button>`;
        html += `<span style="color:var(--text-m);font-size:13px;">Page ${payload.page} of ${payload.totalPages} • ${payload.total} transcripts</span>`;
        html += `<button type="button" class="btn-back" data-transcript-page="${payload.page + 1}" ${payload.page >= payload.totalPages ? 'disabled' : ''}>Next</button>`;
        html += `</div>`;
      }
      area.innerHTML = html;
      area.querySelectorAll('[data-transcript-page]').forEach(button => {
        button.addEventListener('click', () => loadTranscripts(Number(button.dataset.transcriptPage)));
      });
    } catch (err) { area.innerHTML = `<div class="empty-state">Error: ${esc(err.message)}</div>`; }
  }
  await checkAuth();
});
