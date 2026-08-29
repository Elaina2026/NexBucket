export {};

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('nex-theme', isLight ? 'dark' : 'light');
  });

  let currentGuildId = null, currentGuild = null, currentUser = null, guildsData = [];
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
  };
  const BADGE = {
    owner: { label: 'Owner', cls: 'badge-owner' },
    administrator: { label: 'Admin', cls: 'badge-administrator' },
    manage_server: { label: 'Manager', cls: 'badge-manage_server' },
  };
  const SECTIONS = [
    { id: 'general', label: 'General', icon: I.gear },
    { id: 'learn', label: 'Learn', icon: I.chat, adminOnly: true },
    { id: 'welcome', label: 'Welcome', icon: I.chat },
    { id: 'goodbye', label: 'Goodbye', icon: I.door },
    { id: 'ticket', label: 'Tickets', icon: I.ticket },
    { id: 'transcripts', label: 'Transcripts', icon: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
    { id: 'jtc', label: 'Voice JTC', icon: I.speaker },
    { id: 'mod', label: 'Security', icon: I.shield },
    { id: 'bank', label: 'Banking', icon: I.card },
    { id: 'status', label: 'Server Status', icon: I.monitor },
    { id: 'stats', label: 'Server Stats', icon: I.users },
    { id: 'management', label: 'Setup & History', icon: I.gear },
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
    currentUser = data.user;
    btnLogin?.classList.add('hidden'); userBadge?.classList.remove('hidden'); loggedOutView?.classList.add('hidden'); loggedInView?.classList.remove('hidden');
    document.getElementById('userName').textContent = data.user.username;
    const av = document.getElementById('userAvatar');
    av.src = data.user.avatar ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
    renderServerGrid(data.guilds);
    loadReminders();
    loadPrivacySummary();
    const route = parseRoute();
    if (route.serverId) {
      const guild = data.guilds.find(g => g.id === route.serverId);
      if (guild) openDashboard(guild, route.section || 'general', false);
    }
  }
  document.getElementById('btnLogout')?.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.reload(); });
  async function loadPrivacySummary() {
    const container = document.getElementById('privacySummary');
    const status = document.getElementById('privacyStatus');
    if (!container) return;
    try {
      const response = await fetch('/api/privacy/summary');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Privacy summary failed');
      container.replaceChildren();
      const labels = {
        reminders: 'Schedules', jtcProfiles: 'JTC profiles', afkRows: 'AFK rows', activePartyMemberships: 'Active parties',
        tickets: 'Tickets', transcripts: 'Transcripts', moderationCases: 'Moderation cases', paymentTransactions: 'Payments',
      };
      for (const [key, value] of Object.entries(result.summary)) {
        const item = document.createElement('span'); item.className = 'doctor-count'; item.textContent = `${labels[key] || key}: ${value}`; container.appendChild(item);
      }
      status.textContent = 'Counts only. Transcript, evidence, card, bank, and OAuth content is excluded.';
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
  }
  document.getElementById('btnPrivacyExport')?.addEventListener('click', async () => {
    const response = await fetch('/api/privacy/export');
    if (!response.ok) return document.getElementById('privacyStatus').textContent = 'Privacy export failed.';
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = 'nexbucket-privacy-export.json'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  });
  document.getElementById('btnPrivacyRequest')?.addEventListener('click', () => {
    const overlay = modalOverlay(); overlay.replaceChildren();
    const dialog = document.createElement('div'); dialog.className = 'modal'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h3'); title.textContent = 'Request deletion review';
    const description = document.createElement('p'); description.textContent = 'Safe categories may be deleted after owner approval. Tickets, transcripts, moderation, and payments are retained under policy.';
    const categories = document.createElement('div'); categories.className = 'privacy-categories';
    for (const [value, label] of [['reminders','Schedules'],['jtc','JTC profiles'],['afk','AFK'],['parties','Party memberships'],['tickets','Tickets'],['moderation','Moderation'],['payments','Payments']]) {
      const option = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; option.append(input, document.createTextNode(` ${label}`)); categories.appendChild(option);
    }
    const note = document.createElement('textarea'); note.className = 'text-input'; note.rows = 3; note.maxLength = 1000; note.placeholder = 'Optional note';
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-modal'; cancel.textContent = 'Cancel';
    const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'btn-modal danger'; submit.textContent = 'Submit request';
    actions.append(cancel, submit); dialog.append(title, description, categories, note, actions); overlay.appendChild(dialog); overlay.classList.add('show');
    cancel.addEventListener('click', () => overlay.classList.remove('show'));
    submit.addEventListener('click', async () => {
      const selected = [...categories.querySelectorAll('input:checked')].map(input => input.value);
      if (!selected.length) return;
      submit.disabled = true;
      try {
        await reminderRequest('/api/privacy/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'delete', categories: selected, note: note.value }) });
        overlay.classList.remove('show'); document.getElementById('privacyStatus').textContent = 'Deletion review request submitted.';
      } catch (error) { submit.disabled = false; document.getElementById('privacyStatus').textContent = error.message; }
    });
  });

  const reminderList = document.getElementById('reminderList');
  const reminderStatus = document.getElementById('reminderStatus');
  const reminderEditOverlay = document.getElementById('reminderEditOverlay');
  const reminderCancelOverlay = document.getElementById('reminderCancelOverlay');
  const reminderEditForm = document.getElementById('reminderEditForm');
  const reminderMessageInput = document.getElementById('reminderMessageInput');
  const reminderTimeInput = document.getElementById('reminderTimeInput');
  const reminderEditError = document.getElementById('reminderEditError');
  const reminderDateTimeGroup = document.getElementById('reminderDateTimeGroup');
  const scheduleTargetFields = document.getElementById('scheduleTargetFields');
  const scheduleGuildInput = document.getElementById('scheduleGuildInput');
  const scheduleChannelInput = document.getElementById('scheduleChannelInput');
  const scheduleLocalTimeInput = document.getElementById('scheduleLocalTimeInput');
  const scheduleRecurrenceInput = document.getElementById('scheduleRecurrenceInput');
  const scheduleOnceInput = document.getElementById('scheduleOnceInput');
  const scheduleDayOfMonthInput = document.getElementById('scheduleDayOfMonthInput');
  const scheduleTimeZone = document.getElementById('scheduleTimeZone');
  let reminders = [];
  let activeReminderId = null;
  let activeReminderType = 'dm';
  let activeScheduleTimeZone = 'UTC';

  function setReminderStatus(message, isError = false) {
    if (!reminderStatus) return;
    reminderStatus.textContent = message;
    reminderStatus.classList.toggle('error', isError);
  }
  function localDatetimeValue(timestamp) {
    const date = new Date(timestamp);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }
  function closeReminderOverlay(overlay) {
    overlay?.classList.remove('show');
    activeReminderId = null;
  }
  function renderReminders() {
    if (!reminderList) return;
    reminderList.replaceChildren();
    if (!reminders.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No pending schedules.';
      reminderList.appendChild(empty);
      return;
    }
    for (const reminder of reminders) {
      const item = document.createElement('article');
      item.className = 'reminder-item';
      const main = document.createElement('div');
      main.className = 'reminder-item-main';
      const message = document.createElement('div');
      message.className = 'reminder-message';
      message.textContent = reminder.message;
      const time = document.createElement('div');
      time.className = 'reminder-time';
      time.textContent = reminder.targetType === 'channel'
        ? `${reminder.paused ? 'Paused · ' : ''}${reminder.recurrence || 'daily'} at ${reminder.localTime} (${reminder.timeZone}) · ${reminder.guildName || 'Unknown server'} / #${reminder.channelName || 'unknown-channel'} · Next ${new Date(reminder.endTime).toLocaleString()}`
        : `Personal DM · Scheduled for ${new Date(reminder.endTime).toLocaleString()}`;
      main.append(message, time);

      const actions = document.createElement('div');
      actions.className = 'reminder-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'reminder-action';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => openReminderEdit(reminder));
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'reminder-action danger';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => openReminderCancel(reminder));
      actions.append(edit);
      if (reminder.targetType === 'channel') {
        const pause = document.createElement('button');
        pause.type = 'button'; pause.className = 'reminder-action'; pause.textContent = reminder.paused ? 'Resume' : 'Pause';
        pause.addEventListener('click', async () => {
          pause.disabled = true;
          try { await reminderRequest(`/api/reminders/${reminder.id}/pause`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: !reminder.paused }) }); await loadReminders(); }
          catch (error) { setReminderStatus(error.message, true); pause.disabled = false; }
        });
        const clone = document.createElement('button');
        clone.type = 'button'; clone.className = 'reminder-action'; clone.textContent = 'Clone';
        clone.addEventListener('click', async () => {
          clone.disabled = true;
          try { await reminderRequest(`/api/reminders/${reminder.id}/clone`, { method: 'POST' }); await loadReminders(); }
          catch (error) { setReminderStatus(error.message, true); clone.disabled = false; }
        });
        actions.append(pause, clone);
      }
      actions.append(cancel);
      item.append(main, actions);
      reminderList.appendChild(item);
    }
  }
  async function reminderRequest(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
      location.assign('/api/auth/login');
      throw new Error('Session expired');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }
  async function loadReminders() {
    if (!reminderList) return;
    setReminderStatus('Loading schedules...');
    try {
      const result = await reminderRequest('/api/reminders');
      reminders = Array.isArray(result.reminders) ? result.reminders : [];
      renderReminders();
      setReminderStatus(`${reminders.length} pending schedule${reminders.length === 1 ? '' : 's'}.`);
    } catch (error) {
      if (error.message !== 'Session expired') setReminderStatus(error.message, true);
    }
  }
  function browserTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }
  function fillScheduleGuilds(selectedId = '') {
    scheduleGuildInput.replaceChildren();
    for (const guild of guildsData) {
      const option = document.createElement('option');
      option.value = guild.id;
      option.textContent = guild.name;
      option.selected = guild.id === selectedId;
      scheduleGuildInput.appendChild(option);
    }
  }
  async function loadScheduleChannels(guildId, selectedId = '') {
    scheduleChannelInput.replaceChildren(new Option('Loading channels...', ''));
    scheduleChannelInput.disabled = true;
    try {
      const data = await reminderRequest(`/api/guilds/${guildId}/data`);
      const channels = (data.channels || []).filter(channel => (channel.type === 0 || channel.type === 5) && channel.botCanSend);
      scheduleChannelInput.replaceChildren();
      for (const channel of channels) {
        const option = new Option(`#${channel.name}`, channel.id, false, channel.id === selectedId);
        scheduleChannelInput.appendChild(option);
      }
      if (!channels.length) scheduleChannelInput.appendChild(new Option('No text channels available', ''));
    } catch (error) {
      scheduleChannelInput.replaceChildren(new Option(error.message, ''));
    } finally {
      scheduleChannelInput.disabled = false;
    }
  }
  function updateScheduleFields() {
    const recurrence = scheduleRecurrenceInput.value;
    document.getElementById('scheduleOnceGroup').hidden = recurrence !== 'once';
    document.getElementById('scheduleWeekdaysGroup').hidden = recurrence !== 'weekly';
    document.getElementById('scheduleMonthlyGroup').hidden = recurrence !== 'monthly';
    scheduleOnceInput.required = recurrence === 'once';
    scheduleDayOfMonthInput.required = recurrence === 'monthly';
  }
  async function openReminderEdit(reminder = null) {
    activeReminderId = reminder?.id || null;
    activeReminderType = reminder?.targetType || 'channel';
    activeScheduleTimeZone = reminder?.timeZone || browserTimeZone();
    document.getElementById('reminderEditTitle').textContent = reminder
      ? `Edit ${activeReminderType === 'channel' ? 'server schedule' : 'reminder'}`
      : 'Add server schedule';
    reminderMessageInput.value = reminder?.message || '';
    reminderMessageInput.maxLength = activeReminderType === 'channel' ? 2000 : 4096;
    reminderDateTimeGroup.hidden = activeReminderType === 'channel';
    scheduleTargetFields.hidden = activeReminderType !== 'channel';
    reminderTimeInput.required = activeReminderType === 'dm';
    scheduleGuildInput.required = activeReminderType === 'channel';
    scheduleChannelInput.required = activeReminderType === 'channel';
    scheduleLocalTimeInput.required = activeReminderType === 'channel';
    if (activeReminderType === 'dm') {
      reminderTimeInput.value = localDatetimeValue(reminder.endTime);
      reminderTimeInput.min = localDatetimeValue(Date.now() + 60_000);
    } else {
      fillScheduleGuilds(reminder?.guildId || guildsData[0]?.id || '');
      scheduleLocalTimeInput.value = reminder?.localTime || '06:00';
      scheduleRecurrenceInput.value = reminder?.recurrence || 'daily';
      scheduleOnceInput.value = localDatetimeValue(reminder?.endTime || Date.now() + 60 * 60_000);
      scheduleDayOfMonthInput.value = String(reminder?.dayOfMonth || 1);
      document.querySelectorAll('#scheduleWeekdaysGroup input[type="checkbox"]').forEach(input => { input.checked = (reminder?.weekdays || []).includes(Number(input.value)); });
      document.getElementById('scheduleEmbedTitle').value = reminder?.embed?.title || '';
      document.getElementById('scheduleEmbedDescription').value = reminder?.embed?.description || '';
      document.getElementById('scheduleEmbedColor').value = reminder?.embed?.color || '';
      document.getElementById('scheduleEmbedImage').value = reminder?.embed?.image || '';
      updateScheduleFields();
      scheduleTimeZone.textContent = `Time zone: ${activeScheduleTimeZone}`;
      if (scheduleGuildInput.value) await loadScheduleChannels(scheduleGuildInput.value, reminder?.channelId || '');
    }
    reminderEditError.hidden = true;
    reminderEditOverlay.classList.add('show');
    reminderMessageInput.focus();
  }
  function openReminderCancel(reminder) {
    activeReminderId = reminder.id;
    document.getElementById('reminderCancelMessage').textContent = `Cancel “${reminder.message}”?`;
    reminderCancelOverlay.classList.add('show');
    document.getElementById('btnKeepReminder')?.focus();
  }
  document.getElementById('btnRefreshReminders')?.addEventListener('click', loadReminders);
  document.getElementById('btnAddSchedule')?.addEventListener('click', () => openReminderEdit());
  scheduleGuildInput?.addEventListener('change', () => loadScheduleChannels(scheduleGuildInput.value));
  scheduleRecurrenceInput?.addEventListener('change', updateScheduleFields);
  document.getElementById('btnCancelReminderEdit')?.addEventListener('click', () => closeReminderOverlay(reminderEditOverlay));
  document.getElementById('btnKeepReminder')?.addEventListener('click', () => closeReminderOverlay(reminderCancelOverlay));
  reminderEditOverlay?.addEventListener('click', event => { if (event.target === reminderEditOverlay) closeReminderOverlay(reminderEditOverlay); });
  reminderCancelOverlay?.addEventListener('click', event => { if (event.target === reminderCancelOverlay) closeReminderOverlay(reminderCancelOverlay); });
  reminderEditForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const endTime = new Date(reminderTimeInput.value).getTime();
    if (activeReminderType === 'dm' && (!Number.isSafeInteger(endTime) || endTime <= Date.now())) {
      reminderEditError.textContent = 'Reminder time must be in the future.';
      reminderEditError.hidden = false;
      return;
    }
    const button = document.getElementById('btnSaveReminderEdit');
    button.disabled = true;
    reminderEditError.hidden = true;
    try {
      const embed = {
        title: document.getElementById('scheduleEmbedTitle').value.trim(),
        description: document.getElementById('scheduleEmbedDescription').value.trim(),
        color: document.getElementById('scheduleEmbedColor').value.trim(),
        image: document.getElementById('scheduleEmbedImage').value.trim(),
      };
      const hasEmbed = Object.values(embed).some(Boolean);
      const channelPayload = {
        targetType: 'channel',
        message: reminderMessageInput.value,
        guildId: scheduleGuildInput.value,
        channelId: scheduleChannelInput.value,
        localTime: scheduleLocalTimeInput.value,
        timeZone: activeScheduleTimeZone,
        recurrence: scheduleRecurrenceInput.value,
        weekdays: [...document.querySelectorAll('#scheduleWeekdaysGroup input:checked')].map(input => Number(input.value)),
        dayOfMonth: Number(scheduleDayOfMonthInput.value),
        endTime: new Date(scheduleOnceInput.value).getTime(),
        embed: hasEmbed ? embed : null,
      };
      await reminderRequest(activeReminderId ? `/api/reminders/${activeReminderId}` : '/api/reminders', {
        method: activeReminderId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeReminderType === 'channel'
          ? channelPayload
          : { targetType: 'dm', message: reminderMessageInput.value, endTime }),
      });
      closeReminderOverlay(reminderEditOverlay);
      await loadReminders();
    } catch (error) {
      reminderEditError.textContent = error.message;
      reminderEditError.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('btnConfirmReminderCancel')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try {
      await reminderRequest(`/api/reminders/${activeReminderId}`, { method: 'DELETE' });
      closeReminderOverlay(reminderCancelOverlay);
      await loadReminders();
    } catch (error) {
      closeReminderOverlay(reminderCancelOverlay);
      setReminderStatus(error.message, true);
    } finally {
      event.target.disabled = false;
    }
  });
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
      const initials = String(g.name || '').split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();
      const iconHtml = g.icon ? `<img class="server-icon" src="${esc(g.icon)}" alt="${esc(g.name)}" loading="lazy"/>` : `<div class="server-icon-ph">${esc(initials)}</div>`;
      const card = document.createElement('div');
      card.className = 'server-card'; card.dataset.guildId = g.id;
      card.innerHTML = `${iconHtml}<div class="server-info"><div class="server-name">${esc(g.name)}</div><div class="server-meta"><span class="server-members">${I.users} ${fmtNum(g.memberCount)}</span><span class="perm-badge ${b.cls}">${b.label}</span></div></div>`;
      card.addEventListener('click', () => openDashboard(g));
      serverGrid.appendChild(card);
    });
  }
  async function openDashboard(guild, initialSection = 'general', updateUrl = true) {
    currentGuildId = guild.id;
    currentGuild = guild;
    serverPickerView.classList.add('hidden');
    dashboardLayout.classList.remove('hidden');
    if (updateUrl) pushRoute(guild.id, initialSection);
    const iconSrc = guild.icon || '';
    sidebarServerInfo.innerHTML = iconSrc ? `<img src="${esc(iconSrc)}" alt=""/>` : '';
    sidebarServerInfo.innerHTML += `<div><div class="ss-name">${esc(guild.name)}</div><div class="ss-id">${esc(guild.id)}</div></div>`;
    sidebarNav.innerHTML = '';
    SECTIONS.filter(s => !s.adminOnly || ['owner', 'administrator'].includes(guild.permissionTier)).forEach((s) => {
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
    prepareDashboardSections();
    wireBannerPickers();
    await loadConfig(guild.id);
    switchSection(initialSection, false);
    showStatus('', '');
  }
  function switchSection(id, updateUrl = true) {
    sidebarNav.querySelectorAll('.sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.section === id));
    contentArea.querySelectorAll('.content-section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + id));
    const actionBar = document.querySelector('.action-bar');
    actionBar?.classList.toggle('hidden', ['transcripts', 'learn', 'management'].includes(id));
    if (updateUrl) pushRoute(currentGuildId, id);
    if (id === 'transcripts') loadTranscripts();
    if (id === 'learn') loadLearnEntries();
    if (id === 'ticket') loadTicketSlaReport();
    if (id === 'mod') loadModerationCases();
    if (id === 'management') loadManagementSuite();
  }
  function modalOverlay() {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modalOverlay';
      overlay.className = 'modal-overlay';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function showTemplateModal(templateId) {
    const overlay = modalOverlay();
    const template = document.getElementById(templateId);
    overlay.replaceChildren(template.content.cloneNode(true));
    overlay.classList.add('show');
    return overlay;
  }
  const previewState = new Map();
  function previewFields(mode) {
    return mode === 'welcome'
      ? { message: 'welcomeMessageContent', title: 'welcome_text', background: 'welcome_bg' }
      : { message: 'goodbyeMessageContent', title: 'goodbye_text', background: 'goodbye_bg' };
  }
  function previewMessage(mode) {
    const fields = previewFields(mode);
    const template = getVal(fields.message) || (mode === 'welcome' ? 'Welcome {user} to **{server}**!' : '{user} has left **{server}**.');
    const username = currentUser?.username || 'User';
    const serverName = currentGuild?.name || 'Server';
    const escaped = esc(template)
      .replace(/\{user\}/g, `<span class="discord-mention">@${esc(username)}</span>`)
      .replace(/\{server\}/g, esc(serverName));
    return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }
  function scheduleBannerPreview(mode, immediate = false) {
    const current = previewState.get(mode) || {};
    clearTimeout(current.timer);
    current.timer = setTimeout(() => updateBannerPreview(mode), immediate ? 0 : 350);
    previewState.set(mode, current);
    const message = document.querySelector(`[data-preview-message="${mode}"]`);
    if (message) message.innerHTML = previewMessage(mode);
  }
  async function updateBannerPreview(mode) {
    if (!currentGuildId) return;
    const fields = previewFields(mode);
    const image = document.getElementById(fields.background + '_preview');
    const status = document.querySelector(`[data-preview-status="${mode}"]`);
    if (!image || !status) return;
    const current = previewState.get(mode) || {};
    current.controller?.abort();
    current.controller = new AbortController();
    previewState.set(mode, current);
    status.textContent = 'Rendering preview...';
    status.classList.remove('hidden');
    try {
      const response = await fetch(`/api/guilds/${currentGuildId}/welcome-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          message: getVal(fields.message),
          title: getVal(fields.title),
          background: getVal(fields.background),
        }),
        signal: current.controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Preview failed');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
      current.objectUrl = objectUrl;
      image.src = objectUrl;
      status.classList.add('hidden');
    } catch (error) {
      if (error.name === 'AbortError') return;
      status.textContent = error.message;
      status.classList.remove('hidden');
    }
  }
  function wireBannerPickers() {
    for (const mode of ['welcome', 'goodbye']) {
      const fields = previewFields(mode);
      for (const id of Object.values(fields)) {
        document.getElementById(id)?.addEventListener('input', () => scheduleBannerPreview(mode));
      }
    }
  }
  document.getElementById('configForm')?.addEventListener('click', (e) => {
    const thumb = e.target.closest('.banner-thumb-button[data-banner-url]');
    if (thumb) {
      const input = document.getElementById(thumb.dataset.bannerTarget);
      if (input) input.value = thumb.dataset.bannerUrl;
      scheduleBannerPreview(thumb.dataset.bannerMode, true);
      return;
    }
    const guideBtn = e.target.closest('[data-guide]');
    if (guideBtn) window.showGuideModal(guideBtn.dataset.guide);
  });
  function prepareDashboardSections() {
    const form = document.getElementById('configForm');
    const template = document.getElementById('dashboardSectionsTemplate');
    form.replaceChildren(template.content.cloneNode(true));
    const learnSection = document.getElementById('sec-learn');
    if (learnSection) learnSection.hidden = !['owner', 'administrator'].includes(currentGuild?.permissionTier);
    populatePickerOptions();
    initAllPickers();
    initColorPickers();
    initTicketTypeManager();
    initStatusServerManager();
    initLearnManager();
    initManagementSuite();
    document.getElementById('btnLoadTicketReport')?.addEventListener('click', loadTicketSlaReport);
    document.getElementById('btnLoadCases')?.addEventListener('click', () => loadModerationCases(1));
  }
  const PICKER_CHANNEL_TYPES = {
    welcomeChannel: [0, 5], goodbyeChannel: [0, 5], ticketCategoryId: [4],
    ticketTranscriptChannel: [0, 5], ticketReviewChannel: [0, 5], slaEscalationChannelId: [0, 5],
    jtcHubChannelId: [2], jtcCategoryId: [4], jtcLfmChannelId: [0, 5],
    modLogChannel: [0, 5], bankNotifChannel: [0, 5], statsCategoryId: [4],
    statsAllMembersId: [2], statsHumansId: [2], statsStaffOnlineId: [2],
    statsBotCountId: [2], msChannel: [0, 5],
  };
  function populatePickerOptions(root = document) {
    root.querySelectorAll('.picker-wrap').forEach(wrap => {
      const options = wrap.querySelector('.picker-options');
      if (!options) return;
      options.replaceChildren();
      const type = wrap.dataset.pickerType;
      const allowedTypes = PICKER_CHANNEL_TYPES[wrap.dataset.pickerId];
      const source = type === 'channel'
        ? guildChannels.filter(channel => !allowedTypes || allowedTypes.includes(channel.type))
        : guildRoles;
      for (const item of source) {
        const option = document.createElement('div');
        option.className = 'picker-option';
        option.dataset.value = item.id;
        if (type === 'channel') {
          const icon = document.createElement('span');
          icon.className = 'ch-icon';
          icon.textContent = { 0: '#', 2: '🔊', 4: '▾', 5: '📣', 13: '🎙', 15: '☷' }[item.type] || '#';
          const name = document.createElement('span');
          name.className = 'ch-name';
          name.textContent = item.name;
          option.append(icon, name);
        } else {
          const dot = document.createElement('span');
          dot.className = 'role-dot';
          const name = document.createElement('span');
          name.className = 'role-name';
          name.textContent = item.name;
          option.append(dot, name);
        }
        options.appendChild(option);
      }
    });
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
        options.forEach(o => o.classList.toggle('hidden', !o.textContent.toLowerCase().includes(q)));
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
      colorInput?.addEventListener('input', () => { if (textInput) textInput.value = colorInput.value; });
      textInput?.addEventListener('input', () => { const v = textInput.value; if (/^#[0-9A-Fa-f]{6}$/.test(v) && colorInput) colorInput.value = v; });
    });
  }
  let ticketTypes = [];
  let statusServers = [];
  let learnEntries = Object.create(null);
  let learnQuery = '';
  function initLearnManager() {
    document.getElementById('btnAddLearn')?.addEventListener('click', () => showLearnModal());
    document.getElementById('learnSearch')?.addEventListener('input', event => {
      learnQuery = event.target.value.trim().toLowerCase();
      renderLearnEntries();
    });
  }
  async function learnRequest(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return result;
  }
  async function loadLearnEntries() {
    const list = document.getElementById('learnList');
    if (!list || !currentGuildId) return;
    list.innerHTML = '<div class="empty-state">Loading learned responses...</div>';
    try {
      const result = await learnRequest(`/api/guilds/${currentGuildId}/learn`);
      learnEntries = result.entries && typeof result.entries === 'object' ? result.entries : Object.create(null);
      renderLearnEntries();
    } catch (error) {
      list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`;
    }
  }
  function learnActor(entry) {
    const name = entry.updatedByName || entry.updatedBy || entry.createdByName || entry.createdBy || 'Unknown';
    const timestamp = entry.updatedAt || entry.createdAt;
    if (!timestamp) return esc(name);
    const date = new Date(timestamp);
    return `${esc(name)} · ${Number.isNaN(date.getTime()) ? '' : esc(date.toLocaleString())}`;
  }
  const LEARN_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const LEARN_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
  function learnMedia(entry) {
    const url = entry?.mediaUrl || entry?.imageUrl || '';
    const mediaPath = entry?.mediaPath || entry?.imagePath || '';
    let type = entry?.mediaType || '';
    if (!type && /\.(?:mp4)(?:$|[?#])/i.test(url)) type = 'video/mp4';
    if (!type && /\.(?:webm)(?:$|[?#])/i.test(url)) type = 'video/webm';
    return { url, path: mediaPath, type, kind: type.startsWith('video/') ? 'video' : 'image' };
  }
  function renderLearnEntries() {
    const list = document.getElementById('learnList');
    if (!list) return;
    const entries = Object.entries(learnEntries).filter(([trigger, entry]) =>
      `${trigger} ${entry?.response || ''}`.toLowerCase().includes(learnQuery)
    );
    if (!entries.length) {
      list.innerHTML = `<div class="empty-state">${learnQuery ? 'No learned responses match this search.' : 'No learned responses yet.'}</div>`;
      return;
    }
    list.innerHTML = '';
    for (const [trigger, entry] of entries) {
      const media = learnMedia(entry);
      const thumbnail = media.url
        ? media.kind === 'video'
          ? `<video class="learn-thumb" src="${esc(media.url)}" preload="metadata" muted aria-label="Video preview for ${esc(trigger)}"></video>`
          : `<img class="learn-thumb" src="${esc(media.url)}" alt="Preview for ${esc(trigger)}"/>`
        : '';
      const item = document.createElement('div');
      item.className = `learn-item${entry.enabled === false ? ' disabled' : ''}`;
      item.innerHTML = `<div class="learn-item-main">
        <div class="learn-trigger">${esc(trigger)}</div>
        <div class="learn-response">${entry.response ? esc(entry.response) : '<em>Media-only response</em>'}</div>
        <div class="learn-meta">${media.url ? `${media.kind === 'video' ? 'Video' : 'Image'} attached · ` : ''}Updated by ${learnActor(entry)}</div>
      </div>
      ${thumbnail}
      <div class="learn-actions">
        <label class="toggle-switch" title="Enable response"><input type="checkbox" data-learn-toggle="${esc(trigger)}" ${entry.enabled === false ? '' : 'checked'}/><span class="toggle-slider"></span></label>
        <button type="button" class="tt-edit" data-learn-edit="${esc(trigger)}" title="Edit response">${I.edit}</button>
        <button type="button" class="tt-remove" data-learn-delete="${esc(trigger)}" title="Delete response">${I.x}</button>
      </div>`;
      item.querySelector('[data-learn-edit]')?.addEventListener('click', () => showLearnModal(trigger));
      item.querySelector('[data-learn-delete]')?.addEventListener('click', () => confirmDeleteLearn(trigger));
      item.querySelector('[data-learn-toggle]')?.addEventListener('change', async event => {
        event.target.disabled = true;
        try {
          const result = await learnRequest(`/api/guilds/${currentGuildId}/learn`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalTrigger: trigger, trigger, ...entry, enabled: event.target.checked }),
          });
          learnEntries[trigger] = result.entry;
          renderLearnEntries();
        } catch (error) {
          event.target.checked = !event.target.checked;
          event.target.disabled = false;
          showStatus(error.message, 'error');
        }
      });
      list.appendChild(item);
    }
  }
  async function cleanupUploadedLearnMedia(mediaPath) {
    if (!mediaPath) return;
    await fetch(`/api/guilds/${currentGuildId}/learn/media`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaPath }),
    }).catch(() => {});
  }
  function showLearnModal(originalTrigger = null) {
    const current = originalTrigger ? learnEntries[originalTrigger] : null;
    const currentMedia = learnMedia(current);
    const overlay = showTemplateModal('learnModalTemplate');
    overlay.querySelector('#learnModalTitle').textContent = `${current ? 'Edit' : 'Add'} Learned Response`;
    const triggerInput = overlay.querySelector('#learnTriggerInput');
    const responseInput = overlay.querySelector('#learnResponseInput');
    const mediaInput = overlay.querySelector('#learnMediaInput');
    const mediaFileName = overlay.querySelector('#learnMediaFileName');
    const mediaDropZone = overlay.querySelector('#learnMediaDropZone');
    const mediaError = overlay.querySelector('#learnMediaError');
    const removeMedia = overlay.querySelector('#learnRemoveMedia');
    const duplicateWarning = overlay.querySelector('#learnDuplicateWarning');
    const previewText = overlay.querySelector('#learnPreviewText');
    const previewImage = overlay.querySelector('#learnPreviewImage');
    const previewVideo = overlay.querySelector('#learnPreviewVideo');
    const errorBox = overlay.querySelector('#learnModalError');
    const saveButton = overlay.querySelector('#btnSaveLearn');
    triggerInput.value = originalTrigger || '';
    responseInput.value = current?.response || '';
    overlay.querySelector('#learnRemoveMediaLabel').hidden = !currentMedia.url;
    let previewUrl = '';
    let selectedFile = null;
    const clearPreviewUrl = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; };
    const clearElementSource = element => {
      if (!element.hasAttribute('src')) return;
      element.removeAttribute('src');
      if (element instanceof HTMLMediaElement) element.load();
    };
    const normalizedTrigger = value => value.trim().toLowerCase();
    const renderPreview = () => {
      const hasCurrent = Boolean(currentMedia.url && !removeMedia.checked);
      previewText.textContent = responseInput.value.trim() || (selectedFile || hasCurrent ? '' : 'Response preview');
      const source = removeMedia.checked ? '' : (previewUrl || currentMedia.url);
      const kind = selectedFile ? (selectedFile.type.startsWith('video/') ? 'video' : 'image') : currentMedia.kind;
      const showVideo = Boolean(source && kind === 'video');
      previewImage.hidden = !source || showVideo;
      previewVideo.hidden = !showVideo;
      if (source && !showVideo) {
        if (previewImage.getAttribute('src') !== source) previewImage.src = source;
      } else {
        clearElementSource(previewImage);
      }
      if (showVideo) {
        if (previewVideo.getAttribute('src') !== source) previewVideo.src = source;
      } else {
        clearElementSource(previewVideo);
      }
    };
    const checkDuplicate = () => {
      const trigger = normalizedTrigger(triggerInput.value);
      const duplicate = Boolean(learnEntries[trigger] && trigger !== originalTrigger);
      duplicateWarning.hidden = !duplicate;
      saveButton.disabled = duplicate;
    };
    const clearSelectedMedia = () => {
      selectedFile = null;
      mediaInput.value = '';
      clearPreviewUrl();
      mediaFileName.textContent = 'No media selected';
      mediaFileName.classList.remove('selected');
    };
    const showMediaError = message => {
      mediaError.textContent = message;
      mediaError.hidden = !message;
    };
    const selectLearnMedia = file => {
      showMediaError('');
      if (!file) {
        clearSelectedMedia();
        renderPreview();
        return;
      }
      const isImage = LEARN_IMAGE_TYPES.has(file.type);
      const isVideo = LEARN_VIDEO_TYPES.has(file.type);
      if (!isImage && !isVideo) {
        clearSelectedMedia();
        showMediaError('Choose PNG, JPEG, WebP, GIF, MP4, or WebM media.');
        renderPreview();
        return;
      }
      const maximum = isVideo ? 25 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maximum) {
        clearSelectedMedia();
        showMediaError(`${isVideo ? 'Video' : 'Image'} must be ${isVideo ? '25' : '5'} MB or smaller.`);
        renderPreview();
        return;
      }
      selectedFile = file;
      clearPreviewUrl();
      previewUrl = URL.createObjectURL(file);
      mediaFileName.textContent = file.name;
      mediaFileName.classList.add('selected');
      removeMedia.checked = false;
      renderPreview();
    };
    triggerInput.addEventListener('input', checkDuplicate);
    responseInput.addEventListener('input', renderPreview);
    removeMedia.addEventListener('change', () => {
      if (removeMedia.checked) clearSelectedMedia();
      renderPreview();
    });
    mediaInput.addEventListener('change', () => selectLearnMedia(mediaInput.files[0]));
    for (const eventName of ['dragenter', 'dragover']) {
      mediaDropZone.addEventListener(eventName, event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        mediaDropZone.classList.add('is-dragover');
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      mediaDropZone.addEventListener(eventName, event => {
        event.preventDefault();
        mediaDropZone.classList.remove('is-dragover');
      });
    }
    mediaDropZone.addEventListener('drop', event => {
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length !== 1) {
        showMediaError('Drop exactly one media file.');
        return;
      }
      selectLearnMedia(files[0]);
    });
    const close = () => {
      clearPreviewUrl();
      clearElementSource(previewVideo);
      overlay.classList.remove('show');
    };
    overlay.querySelector('#btnCancelLearn').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    saveButton.addEventListener('click', async () => {
      errorBox.hidden = true;
      saveButton.disabled = true;
      let uploadedPath = '';
      try {
        const file = selectedFile;
        let mediaPath = removeMedia.checked ? '' : currentMedia.path;
        let mediaUrl = removeMedia.checked ? '' : currentMedia.url;
        let mediaType = removeMedia.checked ? '' : currentMedia.type;
        if (file) {
          const uploaded = await learnRequest(`/api/guilds/${currentGuildId}/learn/media`, {
            method: 'POST', headers: { 'Content-Type': file.type }, body: file,
          });
          mediaPath = uploaded.mediaPath;
          mediaUrl = uploaded.mediaUrl;
          mediaType = uploaded.mediaType;
          uploadedPath = mediaPath;
        }
        const payload = {
          originalTrigger, trigger: triggerInput.value, response: responseInput.value,
          mediaPath, mediaUrl, mediaType, enabled: current?.enabled !== false,
        };
        const result = await learnRequest(`/api/guilds/${currentGuildId}/learn`, {
          method: current ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (originalTrigger && originalTrigger !== result.trigger) delete learnEntries[originalTrigger];
        learnEntries[result.trigger] = result.entry;
        uploadedPath = '';
        close();
        renderLearnEntries();
      } catch (error) {
        if (error.status) await cleanupUploadedLearnMedia(uploadedPath);
        errorBox.textContent = error.message;
        errorBox.hidden = false;
        saveButton.disabled = false;
      }
    });
    checkDuplicate();
    renderPreview();
  }
  function confirmDeleteLearn(trigger) {
    const overlay = showTemplateModal('learnDeleteModalTemplate');
    overlay.querySelector('#learnDeleteTrigger').textContent = trigger;
    overlay.querySelector('#btnCancelLearnDelete').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.querySelector('#btnConfirmLearnDelete').addEventListener('click', async event => {
      event.target.disabled = true;
      try {
        await learnRequest(`/api/guilds/${currentGuildId}/learn`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger }),
        });
        delete learnEntries[trigger];
        overlay.classList.remove('show');
        renderLearnEntries();
      } catch (error) {
        event.target.disabled = false;
        showStatus(error.message, 'error');
      }
    });
  }
  function initTicketTypeManager() {
    document.getElementById('btnAddTicketType')?.addEventListener('click', () => showAddTicketTypeModal());
    renderTicketTypes();
  }
  function renderTicketTypes() {
    const list = document.getElementById('ticketTypeList');
    if (!list) return;
    list.innerHTML = '';
    if (ticketTypes.length === 0) { list.innerHTML = '<div class="empty-state empty-state-compact">No ticket categories defined yet.</div>'; return; }
    ticketTypes.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'ticket-type-item';
      item.innerHTML = `<span class="tt-emoji">${renderEmoji(t.emoji || '🎫')}</span><div class="tt-info"><div class="tt-label">${esc(t.label || 'Untitled')}</div><div class="tt-desc">${esc(t.description || '')}</div></div><div class="tt-actions"><button type="button" class="tt-edit" data-idx="${i}" title="Edit Category">${I.edit}</button><button type="button" class="tt-remove" data-idx="${i}" title="Remove Category">${I.x}</button></div>`;
      item.querySelector('.tt-edit').addEventListener('click', () => showEditTicketTypeModal(i));
      item.querySelector('.tt-remove').addEventListener('click', () => { ticketTypes.splice(i, 1); renderTicketTypes(); });
      list.appendChild(item);
    });
  }
  function showTicketTypeModal(idx = null) {
    const current = idx === null ? null : ticketTypes[idx];
    const overlay = showTemplateModal('ticketTypeModalTemplate');
    overlay.querySelector('#ticketTypeModalTitle').textContent = current ? 'Edit Ticket Category' : 'Add Ticket Category';
    overlay.querySelector('#btnConfirmModal').textContent = current ? 'Save' : 'Add';
    overlay.querySelector('#ttId').value = current?.id || current?.value || current?.channelPrefix || '';
    overlay.querySelector('#ttLabel').value = current?.label || '';
    overlay.querySelector('#ttEmoji').value = current?.emoji || '';
    overlay.querySelector('#ttDescription').value = current?.description || '';
    overlay.querySelector('#btnCancelModal').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.querySelector('#btnConfirmModal').addEventListener('click', () => {
      const label = overlay.querySelector('#ttLabel').value.trim();
      const id = overlay.querySelector('#ttId').value.trim() || label.toLowerCase().replace(/\s+/g, '_');
      const emoji = overlay.querySelector('#ttEmoji').value.trim() || '🎫';
      const description = overlay.querySelector('#ttDescription').value.trim();
      if (!label) return;
      const entry = { ...(current || {}), id, label, emoji, description, channelPrefix: id };
      if (idx === null) ticketTypes.push(entry);
      else ticketTypes[idx] = entry;
      renderTicketTypes();
      overlay.classList.remove('show');
    });
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('show'); });
  }
  function showEditTicketTypeModal(idx) { showTicketTypeModal(idx); }
  function showAddTicketTypeModal() { showTicketTypeModal(); }
  function initStatusServerManager() {
    document.getElementById('btnAddStatusServer')?.addEventListener('click', () => showAddStatusServerModal());
    renderStatusServers();
  }
  function formatMinecraftAddress(server) {
    const host = String(server?.ip || '').trim();
    const port = Number(server?.port || 25565);
    if (host.startsWith('[') && host.endsWith(']')) return port === 25565 ? host : `${host}:${port}`;
    if (host.includes(':') && !host.includes(']')) return port === 25565 ? `[${host}]` : `[${host}]:${port}`;
    return port === 25565 ? host : `${host}:${port}`;
  }
  function parseMinecraftAddressInput(rawIp, rawPort) {
    const value = String(rawIp || '').trim();
    if (!value || /\s|[\\/\0]/.test(value)) throw new Error('Invalid Minecraft address');
    const portText = String(rawPort || '').trim();
    let host = value;
    let embeddedPort = null;

    if (value.startsWith('[')) {
      const match = value.match(/^\[([^\]]+)](?::(\d+))?$/);
      if (!match) throw new Error('Invalid IPv6 address');
      host = match[1];
      embeddedPort = match[2] || null;
    } else if ((value.match(/:/g) || []).length === 1 && /:\d+$/.test(value)) {
      const splitAt = value.lastIndexOf(':');
      host = value.slice(0, splitAt);
      embeddedPort = value.slice(splitAt + 1);
    }

    if (!host || host.length > 253) throw new Error('Invalid Minecraft host');
    const parsePort = raw => {
      if (!/^\d+$/.test(raw)) throw new Error('Port must be between 1 and 65535');
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('Port must be between 1 and 65535');
      return parsed;
    };
    const explicitPort = portText ? parsePort(portText) : null;
    const parsedEmbeddedPort = embeddedPort ? parsePort(embeddedPort) : null;
    if (explicitPort !== null && parsedEmbeddedPort !== null && explicitPort !== parsedEmbeddedPort) {
      throw new Error('Port is specified twice with different values');
    }
    return { ip: host, port: explicitPort ?? parsedEmbeddedPort ?? 25565 };
  }
  function renderStatusServers() {
    const list = document.getElementById('statusServersList');
    if (!list) return;
    list.innerHTML = '';
    if (statusServers.length === 0) { list.innerHTML = '<div class="empty-state empty-state-compact">No servers tracked yet.</div>'; return; }
    statusServers.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'ticket-type-item';
      const channelName = guildChannels.find(c => c.id === s.channelId)?.name || s.channelId;
      item.innerHTML = `<span class="tt-emoji">${I.monitor}</span><div class="tt-info"><div class="tt-label">${esc(formatMinecraftAddress(s))}</div><div class="tt-desc">Channel: #${esc(channelName)}</div></div><div class="tt-actions"><button type="button" class="tt-remove" data-idx="${i}" title="Remove Server">${I.x}</button></div>`;
      item.querySelector('.tt-remove').addEventListener('click', () => { statusServers.splice(i, 1); renderStatusServers(); });
      list.appendChild(item);
    });
  }
  function showAddStatusServerModal() {
    const overlay = showTemplateModal('statusServerModalTemplate');
    populatePickerOptions(overlay);

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
      options.forEach(option => option.classList.toggle('hidden', !option.textContent.toLowerCase().includes(query)));
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
      const rawIp = document.getElementById('msIp')?.value;
      const rawPort = document.getElementById('msPort')?.value;
      const channelId = getPickerValue('msChannel');
      if (!rawIp?.trim() || !channelId) {
        showStatus('IP and Channel are required!', 'error');
        return;
      }
      try {
        const { ip, port } = parseMinecraftAddressInput(rawIp, rawPort);
        statusServers.push({ ip, port, channelId });
        renderStatusServers();
        overlay.classList.remove('show');
      } catch (error) {
        showStatus(error.message, 'error');
      }
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
  }


  function appendGuideStepContent(item, value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    for (const node of [...template.content.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        item.appendChild(document.createTextNode(node.textContent));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.tagName === 'STRONG') {
        const strong = document.createElement('strong');
        strong.textContent = node.textContent;
        item.appendChild(strong);
      } else if (node.tagName === 'A' && /^https:\/\/(payos\.vn|card2k\.com)\/?$/i.test(node.href)) {
        const link = document.createElement('a');
        link.href = node.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = node.textContent;
        item.appendChild(link);
      } else {
        item.appendChild(document.createTextNode(node.textContent));
      }
    }
  }

  window.showGuideModal = function(type) {
    const t = window.NexI18n ? window.NexI18n.t.bind(window.NexI18n) : key => key;
    const overlay = showTemplateModal('guideModalTemplate');
    const isPayos = type === 'payos';
    const steps = t(isPayos ? 'guide_payos_steps' : 'guide_card2k_steps');
    const webhookUrl = `${window.location.origin}/api/webhooks/${isPayos ? 'payos' : 'card2k'}`;
    const copyText = t('guide_copy');
    overlay.querySelector('#guideModalTitle').textContent = t(isPayos ? 'guide_title_payos' : 'guide_title_card2k');
    overlay.querySelector('#btnCloseGuide').textContent = t('cancel') === 'cancel' ? 'Close' : 'Đóng';
    const list = overlay.querySelector('#guideSteps');
    for (const step of Array.isArray(steps) ? steps : []) {
      const item = document.createElement('li');
      appendGuideStepContent(item, step);
      if (step.includes('Webhook') || step.includes('Callback')) {
        const row = document.createElement('div');
        row.className = 'guide-webhook-url';
        const code = document.createElement('code');
        code.textContent = webhookUrl;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = copyText;
        button.addEventListener('click', () => {
          navigator.clipboard.writeText(webhookUrl).then(() => {
            button.textContent = t('guide_copied');
            setTimeout(() => { button.textContent = copyText; }, 2000);
          });
        });
        row.append(code, button);
        item.appendChild(row);
      }
      list.appendChild(item);
    }
    overlay.querySelector('#btnCloseGuide').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('show'); });
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
      setPickerValue('goodbyeChannel', c.welcomeConfig?.goodbyeChannel);
      setVal('goodbyeMessageContent', c.welcomeConfig?.goodbyeMessageContent);
      setVal('goodbye_text', c.welcomeConfig?.goodbyeText);
      setVal('goodbye_bg', c.welcomeConfig?.goodbyeBg);
      scheduleBannerPreview('welcome', true);
      scheduleBannerPreview('goodbye', true);
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
      setChecked('slaEnabled', tc.slaEnabled === true);
      setVal('slaClaimTargetMinutes', tc.slaClaimTargetMinutes || 15);
      setVal('slaFirstResponseTargetMinutes', tc.slaFirstResponseTargetMinutes || 30);
      setVal('slaReminderCadenceMinutes', tc.slaReminderCadenceMinutes || 15);
      setPickerValue('slaEscalationChannelId', tc.slaEscalationChannelId);
      ticketTypes = tc.ticketTypes || [];
      renderTicketTypes();
      setPickerValue('jtcHubChannelId', c.jtcConfig?.hubChannelId);
      setPickerValue('jtcCategoryId', c.jtcConfig?.categoryId);
      setPickerValue('jtcLfmChannelId', c.jtcConfig?.lfmChannelId);
      setVal('jtcDefaultName', c.jtcConfig?.defaultName || "🔊 {username}'s Room");
      setVal('jtcDefaultStatus', c.jtcConfig?.defaultStatus || '');
      setVal('jtcDefaultLimit', String(c.jtcConfig?.defaultLimit ?? 0));
      setVal('jtcDefaultBitrate', String(Math.round((c.jtcConfig?.defaultBitrate || 64000) / 1000)));
      const regionSelect = document.getElementById('jtcDefaultRegion');
      if (regionSelect) {
        regionSelect.innerHTML = '<option value="">Automatic</option>' + (c.voiceRegions || []).map(region => `<option value="${esc(region.id)}">${esc(region.name)}${region.optimal ? ' (Recommended)' : ''}</option>`).join('');
        regionSelect.value = c.jtcConfig?.defaultRegion || '';
      }
      setChecked('jtcDefaultLocked', c.jtcConfig?.defaultLocked === true);
      setChecked('jtcDefaultHidden', c.jtcConfig?.defaultHidden === true);
      setChecked('jtcDefaultNsfw', c.jtcConfig?.defaultNsfw === true);
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
    showStatus('Saving to VanillaDB...', 'info');
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
        slaEnabled: isChecked('slaEnabled'),
        slaClaimTargetMinutes: Number(getVal('slaClaimTargetMinutes') || 15),
        slaFirstResponseTargetMinutes: Number(getVal('slaFirstResponseTargetMinutes') || 30),
        slaReminderCadenceMinutes: Number(getVal('slaReminderCadenceMinutes') || 15),
        slaEscalationChannelId: getPickerValue('slaEscalationChannelId'),
        ticketTypes,
      },
      jtcConfig: {
        hubChannelId: getPickerValue('jtcHubChannelId'),
        categoryId: getPickerValue('jtcCategoryId'),
        lfmChannelId: getPickerValue('jtcLfmChannelId'),
        defaultName: getVal('jtcDefaultName') || "🔊 {username}'s Room",
        defaultLimit: Number(getVal('jtcDefaultLimit') || 0),
        defaultLocked: isChecked('jtcDefaultLocked'),
        defaultHidden: isChecked('jtcDefaultHidden'),
        defaultBitrate: Number(getVal('jtcDefaultBitrate') || 64) * 1000,
        defaultStatus: getVal('jtcDefaultStatus'),
        defaultRegion: getVal('jtcDefaultRegion'),
        defaultNsfw: isChecked('jtcDefaultNsfw'),
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
      return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt="${esc(name)}" class="ticket-emoji-image" />`;
    }
    return esc(raw);
  }
  window.addEventListener('popstate', () => {
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
      .replace(/&lt;@!?(\d+)&gt;/g, '<span class="discord-mention">@User</span>')
      .replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="discord-mention">@Role</span>')
      .replace(/&lt;#(\d+)&gt;/g, '<span class="discord-mention">#channel</span>')
      .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}" alt=":${name}:" class="discord-emoji"/>`);
  }

  let moderationCasePage = 1;
  async function loadModerationCases(page = moderationCasePage) {
    const list = document.getElementById('moderationCaseList');
    const status = document.getElementById('caseStatus');
    const pagination = document.getElementById('casePagination');
    if (!list || !currentGuildId) return;
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    const action = document.getElementById('caseActionFilter')?.value;
    const caseStatus = document.getElementById('caseStatusFilter')?.value;
    const targetId = document.getElementById('caseTargetFilter')?.value.trim();
    if (action) params.set('action', action);
    if (caseStatus) params.set('status', caseStatus);
    if (targetId) params.set('targetId', targetId);
    status.textContent = 'Loading moderation cases...';
    try {
      const result = await managementRequest(`/api/guilds/${currentGuildId}/moderation-cases?${params}`);
      moderationCasePage = result.page;
      list.replaceChildren();
      if (!result.items?.length) {
        const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No moderation cases match these filters.'; list.appendChild(empty);
      }
      for (const entry of result.items || []) {
        const item = document.createElement('article'); item.className = 'management-item';
        const body = document.createElement('div'); body.className = 'management-item-main';
        const title = document.createElement('strong'); title.textContent = `Case #${entry.case_number} · ${entry.action.toUpperCase()} · ${entry.status}`;
        const detail = document.createElement('span'); detail.textContent = `Target ${entry.target_id} · ${entry.reason} · ${new Date(entry.created_at).toLocaleString()}`;
        body.append(title, detail); item.appendChild(body);
        const actions = document.createElement('div'); actions.className = 'management-actions';
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn-modal'; edit.textContent = 'Edit'; edit.addEventListener('click', () => editModerationCase(entry)); actions.appendChild(edit);
        if (entry.status === 'active' && ['ban', 'tempban', 'timeout', 'mute', 'hardmute'].includes(entry.action) && ['owner', 'administrator'].includes(currentGuild?.permissionTier)) {
          const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'btn-modal danger'; revoke.textContent = 'Revoke'; revoke.addEventListener('click', () => confirmCaseRevoke(entry)); actions.appendChild(revoke);
        }
        item.appendChild(actions); list.appendChild(item);
      }
      pagination.replaceChildren();
      if (result.totalPages > 1) {
        const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'btn-back'; previous.textContent = 'Previous'; previous.disabled = result.page <= 1; previous.addEventListener('click', () => loadModerationCases(result.page - 1));
        const label = document.createElement('span'); label.className = 'transcript-page-label'; label.textContent = `Page ${result.page} of ${result.totalPages}`;
        const next = document.createElement('button'); next.type = 'button'; next.className = 'btn-back'; next.textContent = 'Next'; next.disabled = result.page >= result.totalPages; next.addEventListener('click', () => loadModerationCases(result.page + 1));
        pagination.append(previous, label, next);
      }
      status.textContent = `${result.total} moderation case${result.total === 1 ? '' : 's'}.`;
    } catch (error) {
      list.replaceChildren(); pagination.replaceChildren(); status.textContent = error.message; status.classList.add('error');
    }
  }
  function caseDialog(entry, revoke = false) {
    const overlay = modalOverlay(); overlay.replaceChildren();
    const dialog = document.createElement('div'); dialog.className = 'modal'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h3'); title.textContent = revoke ? `Revoke case #${entry.case_number}?` : `Edit case #${entry.case_number}`; dialog.appendChild(title);
    if (revoke) {
      const text = document.createElement('p'); text.textContent = `This reverses the active ${entry.action} in Discord, then marks the case revoked.`; dialog.appendChild(text);
    } else {
      const reason = document.createElement('textarea'); reason.id = 'caseReasonInput'; reason.className = 'text-input'; reason.rows = 3; reason.maxLength = 1000; reason.value = entry.reason || '';
      const evidenceUrl = document.createElement('input'); evidenceUrl.id = 'caseEvidenceUrlInput'; evidenceUrl.className = 'text-input'; evidenceUrl.placeholder = 'HTTPS evidence URL'; evidenceUrl.value = entry.evidence_url || '';
      const evidenceText = document.createElement('textarea'); evidenceText.id = 'caseEvidenceTextInput'; evidenceText.className = 'text-input'; evidenceText.rows = 3; evidenceText.maxLength = 2000; evidenceText.placeholder = 'Evidence notes'; evidenceText.value = entry.evidence_text || '';
      dialog.append(reason, evidenceUrl, evidenceText);
    }
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-modal'; cancel.textContent = 'Cancel';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = `btn-modal ${revoke ? 'danger' : 'primary'}`; apply.textContent = revoke ? 'Revoke action' : 'Save case';
    actions.append(cancel, apply); dialog.appendChild(actions); overlay.appendChild(dialog); overlay.classList.add('show'); cancel.addEventListener('click', () => overlay.classList.remove('show'));
    return { overlay, apply };
  }
  function editModerationCase(entry) {
    const { overlay, apply } = caseDialog(entry);
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        await managementRequest(`/api/guilds/${currentGuildId}/moderation-cases/${entry.case_number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: document.getElementById('caseReasonInput').value, evidenceUrl: document.getElementById('caseEvidenceUrlInput').value, evidenceText: document.getElementById('caseEvidenceTextInput').value }) });
        overlay.classList.remove('show'); await loadModerationCases();
      } catch (error) { apply.disabled = false; managementStatus('caseStatus', error.message, true); }
    });
  }
  function confirmCaseRevoke(entry) {
    const { overlay, apply } = caseDialog(entry, true);
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        await managementRequest(`/api/guilds/${currentGuildId}/moderation-cases/${entry.case_number}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        overlay.classList.remove('show'); await loadModerationCases();
      } catch (error) { apply.disabled = false; managementStatus('caseStatus', error.message, true); }
    });
  }

  async function loadTicketSlaReport() {
    const container = document.getElementById('ticketSlaReport');
    const status = document.getElementById('ticketSlaStatus');
    if (!container || !currentGuildId) return;
    status.textContent = 'Loading SLA report...';
    status.classList.remove('error');
    try {
      const days = document.getElementById('ticketReportDays')?.value || '30';
      const report = await managementRequest(`/api/guilds/${currentGuildId}/tickets/report?days=${encodeURIComponent(days)}`);
      container.replaceChildren();
      const values = [
        ['Resolved', report.resolved], ['Open', report.open], ['Breached', report.breached],
        ['Median claim', report.medianClaimMinutes === null ? 'N/A' : `${Math.round(report.medianClaimMinutes)}m`],
        ['Median response', report.medianFirstResponseMinutes === null ? 'N/A' : `${Math.round(report.medianFirstResponseMinutes)}m`],
      ];
      for (const [label, value] of values) {
        const card = document.createElement('span');
        card.className = 'doctor-count';
        card.textContent = `${label}: ${value}`;
        container.appendChild(card);
      }
      status.textContent = `Report for the last ${report.days} days.`;
    } catch (error) {
      container.replaceChildren();
      status.textContent = error.message;
      status.classList.add('error');
    }
  }

  let pendingImport = null;
  function managementStatus(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
  }
  async function managementRequest(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function initManagementSuite() {
    document.getElementById('btnDoctorRecheck')?.addEventListener('click', loadDoctor);
    document.getElementById('btnHistoryRefresh')?.addEventListener('click', loadConfigHistory);
    document.getElementById('btnExportPortable')?.addEventListener('click', () => downloadConfig('portable'));
    document.getElementById('btnExportBackup')?.addEventListener('click', () => downloadConfig('same-guild'));
    document.getElementById('configImportFile')?.addEventListener('change', prepareImport);
    document.getElementById('btnApplyImport')?.addEventListener('click', confirmImport);
  }
  function loadManagementSuite() {
    loadDoctor();
    loadConfigHistory();
  }
  async function loadDoctor() {
    const list = document.getElementById('doctorList');
    const summary = document.getElementById('doctorSummary');
    if (!list || !currentGuildId) return;
    managementStatus('doctorStatus', 'Checking server configuration...');
    try {
      const result = await managementRequest(`/api/guilds/${currentGuildId}/doctor`);
      summary.replaceChildren();
      for (const [label, value] of [['Errors', result.summary?.errors || 0], ['Warnings', result.summary?.warnings || 0], ['Info', result.summary?.info || 0]]) {
        const item = document.createElement('span');
        item.className = `doctor-count ${label.toLowerCase()}`;
        item.textContent = `${label}: ${value}`;
        summary.appendChild(item);
      }
      list.replaceChildren();
      if (!result.findings?.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No configuration or permission issues found.';
        list.appendChild(empty);
      }
      for (const finding of result.findings || []) {
        const item = document.createElement('article');
        item.className = `management-item doctor-${finding.severity}`;
        const body = document.createElement('div');
        body.className = 'management-item-main';
        const title = document.createElement('strong');
        title.textContent = finding.title;
        const detail = document.createElement('span');
        detail.textContent = `${finding.module} · ${finding.detail}`;
        body.append(title, detail);
        item.appendChild(body);
        if (finding.fixable && ['owner', 'administrator'].includes(currentGuild?.permissionTier)) {
          const fix = document.createElement('button');
          fix.type = 'button';
          fix.className = 'btn-modal primary';
          fix.textContent = 'Preview fix';
          fix.addEventListener('click', () => confirmDoctorFix(finding));
          item.appendChild(fix);
        }
        list.appendChild(item);
      }
      managementStatus('doctorStatus', `Checked ${new Date(result.checkedAt).toLocaleString()}.`);
    } catch (error) {
      managementStatus('doctorStatus', error.message, true);
      list.replaceChildren();
    }
  }
  function confirmDoctorFix(finding) {
    const overlay = modalOverlay();
    overlay.replaceChildren();
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h3');
    title.textContent = `Create resource for ${finding.title}?`;
    const detail = document.createElement('p');
    detail.textContent = `${finding.detail} This only creates the missing resource and saves its ID. Nothing is deleted or reordered.`;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn-modal'; cancel.textContent = 'Cancel';
    const apply = document.createElement('button');
    apply.type = 'button'; apply.className = 'btn-modal primary'; apply.textContent = 'Create and configure';
    actions.append(cancel, apply); dialog.append(title, detail, actions); overlay.appendChild(dialog); overlay.classList.add('show');
    cancel.addEventListener('click', () => overlay.classList.remove('show'));
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const result = await managementRequest(`/api/guilds/${currentGuildId}/wizard/fix`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findingId: finding.id }),
        });
        configVersion = Number(result.configVersion || configVersion);
        overlay.classList.remove('show');
        await Promise.all([loadDoctor(), loadConfigHistory(), loadConfig(currentGuildId)]);
      } catch (error) {
        apply.disabled = false;
        managementStatus('doctorStatus', error.message, true);
      }
    });
  }
  async function downloadConfig(mode) {
    managementStatus('transferStatus', 'Preparing secure export...');
    try {
      const response = await fetch(`/api/guilds/${currentGuildId}/config-export?mode=${encodeURIComponent(mode)}`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nexbucket-${currentGuildId}-${mode}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      managementStatus('transferStatus', 'Configuration exported without payment secrets.');
    } catch (error) {
      managementStatus('transferStatus', error.message, true);
    }
  }
  async function prepareImport(event) {
    pendingImport = null;
    const apply = document.getElementById('btnApplyImport');
    const preview = document.getElementById('transferPreview');
    apply.disabled = true;
    preview.hidden = true;
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return managementStatus('transferStatus', 'Configuration file exceeds 1 MB.', true);
    try {
      const config = JSON.parse(await file.text());
      const result = await managementRequest(`/api/guilds/${currentGuildId}/config-import/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
      });
      pendingImport = config;
      preview.hidden = false;
      preview.textContent = `${result.mode === 'portable' ? 'Portable template' : 'Same-server backup'} · Sections: ${result.sections.join(', ')} · Existing payment secrets will be preserved.`;
      apply.disabled = false;
      managementStatus('transferStatus', 'Validation passed. Review the preview before importing.');
    } catch (error) {
      managementStatus('transferStatus', error.message, true);
    }
  }
  function confirmImport() {
    if (!pendingImport) return;
    const overlay = modalOverlay();
    overlay.replaceChildren();
    const dialog = document.createElement('div'); dialog.className = 'modal'; dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h3'); title.textContent = 'Import configuration?';
    const detail = document.createElement('p'); detail.textContent = 'This replaces non-secret configuration sections. Stored PayOS and Card2K keys remain unchanged. A history version is created for rollback.';
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-modal'; cancel.textContent = 'Cancel';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'btn-modal danger'; apply.textContent = 'Import';
    actions.append(cancel, apply); dialog.append(title, detail, actions); overlay.appendChild(dialog); overlay.classList.add('show');
    cancel.addEventListener('click', () => overlay.classList.remove('show'));
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const result = await managementRequest(`/api/guilds/${currentGuildId}/config-import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ configVersion, config: pendingImport }),
        });
        configVersion = Number(result.configVersion || configVersion);
        pendingImport = null;
        document.getElementById('configImportFile').value = '';
        document.getElementById('btnApplyImport').disabled = true;
        document.getElementById('transferPreview').hidden = true;
        overlay.classList.remove('show');
        await Promise.all([loadConfig(currentGuildId), loadConfigHistory(), loadDoctor()]);
        managementStatus('transferStatus', 'Configuration imported. Stored payment secrets were preserved.');
      } catch (error) {
        apply.disabled = false;
        managementStatus('transferStatus', error.message, true);
      }
    });
  }
  async function loadConfigHistory() {
    const list = document.getElementById('configHistoryList');
    if (!list || !currentGuildId) return;
    managementStatus('historyStatus', 'Loading configuration history...');
    try {
      const result = await managementRequest(`/api/guilds/${currentGuildId}/config-history?limit=100`);
      list.replaceChildren();
      if (!result.history?.length) {
        const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No history yet. The next configuration save will create one.'; list.appendChild(empty);
      }
      for (const entry of result.history || []) {
        const item = document.createElement('article'); item.className = 'management-item';
        const body = document.createElement('div'); body.className = 'management-item-main';
        const title = document.createElement('strong'); title.textContent = `Version ${entry.version} · ${(entry.changed_sections || []).join(', ') || 'no section changes'}`;
        const detail = document.createElement('span'); detail.textContent = `${entry.actor_name || entry.actor_id || 'System'} · ${entry.source} · ${new Date(entry.created_at).toLocaleString()}`;
        body.append(title, detail); item.appendChild(body);
        const rollback = document.createElement('button'); rollback.type = 'button'; rollback.className = 'btn-modal'; rollback.textContent = 'Rollback';
        rollback.addEventListener('click', () => confirmRollback(entry)); item.appendChild(rollback); list.appendChild(item);
      }
      managementStatus('historyStatus', `${result.history?.length || 0} versions loaded.`);
    } catch (error) {
      managementStatus('historyStatus', error.message, true);
      list.replaceChildren();
    }
  }
  function confirmRollback(entry) {
    const overlay = modalOverlay(); overlay.replaceChildren();
    const dialog = document.createElement('div'); dialog.className = 'modal'; dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h3'); title.textContent = `Roll back to version ${entry.version}?`;
    const detail = document.createElement('p'); detail.textContent = `Sections from this snapshot will replace current values. Payment secrets remain unchanged. A new rollback history version will be recorded.`;
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-modal'; cancel.textContent = 'Cancel';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'btn-modal danger'; apply.textContent = 'Rollback';
    actions.append(cancel, apply); dialog.append(title, detail, actions); overlay.appendChild(dialog); overlay.classList.add('show');
    cancel.addEventListener('click', () => overlay.classList.remove('show'));
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const result = await managementRequest(`/api/guilds/${currentGuildId}/config-history/${entry.id}/rollback`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configVersion }),
        });
        configVersion = Number(result.configVersion || configVersion);
        overlay.classList.remove('show');
        await Promise.all([loadConfig(currentGuildId), loadConfigHistory(), loadDoctor()]);
        managementStatus('historyStatus', `Rolled back to snapshot version ${entry.version}.`);
      } catch (error) {
        apply.disabled = false;
        managementStatus('historyStatus', error.message, true);
      }
    });
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
        html += `<div class="transcript-group"><div class="transcript-date">${esc(date)}</div>`;
        items.forEach(t => {
          const time = new Date(t.created_at).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
          let metaHtml = `Created at ${time}`;
          if (t.closed_by) {
            metaHtml += ` • Closed by ${/^\d+$/.test(t.closed_by) ? parseMentions('<@' + t.closed_by + '>') : esc(t.closed_by)}`;
          }
          if (t.claimed_by) {
            metaHtml += ` • Claimed by ${/^\d+$/.test(t.claimed_by) ? parseMentions('<@' + t.claimed_by + '>') : esc(t.claimed_by)}`;
          }
          html += `<div class="transcript-row">`;
          html += `<div class="transcript-info"><span class="transcript-name">#${esc(t.ticket_name)}</span><span class="transcript-meta">${metaHtml}</span></div>`;
          html += `<a href="/transcript/${esc(t.id)}" target="_blank" rel="noopener noreferrer" class="transcript-view">View</a>`;
          html += `</div>`;
        });
        html += `</div>`;
      }
      if (!Array.isArray(payload) && payload.totalPages > 1) {
        html += `<div class="transcript-pagination">`;
        html += `<button type="button" class="btn-back" data-transcript-page="${payload.page - 1}" ${payload.page <= 1 ? 'disabled' : ''}>Previous</button>`;
        html += `<span class="transcript-page-label">Page ${payload.page} of ${payload.totalPages} • ${payload.total} transcripts</span>`;
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
