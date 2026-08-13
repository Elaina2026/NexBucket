const guildId = location.pathname.match(/^\/jtc\/(\d+)$/)?.[1] || '';
const form = document.getElementById('jtcProfileForm');
const loading = document.getElementById('profileLoading');
const statusMessage = document.getElementById('profileStatusMessage');
const saveButton = document.getElementById('saveProfile');

function setStatus(message, type = '') {
  statusMessage.textContent = message;
  statusMessage.className = `save-status ${type}`;
}

function value(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    location.assign(`/api/auth/login?returnTo=${encodeURIComponent(location.pathname)}`);
    return null;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

async function loadProfile() {
  if (!guildId) throw new Error('Invalid server ID.');
  const data = await request(`/api/guilds/${guildId}/jtc-profile`);
  if (!data) return;
  document.getElementById('guildName').textContent = data.guild.name;
  const icon = document.getElementById('guildIcon');
  if (data.guild.icon) {
    icon.src = data.guild.icon;
    icon.classList.remove('hidden');
  }
  document.getElementById('profileName').value = data.profile.name || '';
  document.getElementById('profileStatus').value = data.profile.status || '';
  document.getElementById('profileLimit').value = data.profile.limit ?? 0;
  document.getElementById('profileBitrate').value = Math.round((data.profile.bitrate || 64000) / 1000);
  document.getElementById('profileBitrate').max = Math.floor(data.maximumBitrate / 1000);
  document.getElementById('bitrateHint').textContent = `Range: 8–${Math.floor(data.maximumBitrate / 1000)} kbps for this server.`;
  const region = document.getElementById('profileRegion');
  for (const item of data.regions || []) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name}${item.optimal ? ' (Recommended)' : ''}`;
    region.appendChild(option);
  }
  region.value = data.profile.rtcRegion || '';
  document.getElementById('profileLocked').checked = data.profile.isLocked === true;
  document.getElementById('profileHidden').checked = data.profile.isHidden === true;
  document.getElementById('profileNsfw').checked = data.profile.isNsfw === true;
  loading.classList.add('hidden');
  form.classList.remove('hidden');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  saveButton.disabled = true;
  setStatus('Saving…', 'info');
  try {
    const result = await request(`/api/guilds/${guildId}/jtc-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: value('profileName'),
        status: value('profileStatus'),
        limit: Number(value('profileLimit')),
        bitrate: Number(value('profileBitrate')) * 1000,
        rtcRegion: value('profileRegion'),
        isLocked: document.getElementById('profileLocked').checked,
        isHidden: document.getElementById('profileHidden').checked,
        isNsfw: document.getElementById('profileNsfw').checked,
      }),
    });
    if (result) setStatus('Profile saved. Use Load Settings in your room to apply it now.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById('themeToggle')?.addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  localStorage.setItem('theme', next);
});

loadProfile().catch(error => {
  loading.textContent = error.message;
  loading.classList.add('save-status', 'error');
});
