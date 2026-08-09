export {};

const transcriptId = window.location.pathname.split('/').pop();
const loadingScreen = document.getElementById('loadingScreen');
const passwordScreen = document.getElementById('passwordScreen');
const errorScreen = document.getElementById('errorScreen');
const errorDesc = document.getElementById('errorDesc');
const errorMsg = document.getElementById('errorMsg');

const topbar = document.getElementById('topbar');
const chatArea = document.getElementById('chatArea');
const tbTitle = document.getElementById('tbTitle');
const tbSubtitle = document.getElementById('tbSubtitle');
const chTitle = document.getElementById('chTitle');
const messagesContainer = document.getElementById('messagesContainer');

const pwdInput = document.getElementById('pwdInput');
const btnSubmit = document.getElementById('btnSubmit');

function escapeHTML(value) {
    const str = String(value ?? '');
    return str.replace(/[&<>'"]/g,
    tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag)
    );
}

function safeHttpUrl(value, allowedHosts = []) {
    try {
        const url = new URL(String(value || ''));
        if (url.protocol !== 'https:') return '';
        if (allowedHosts.length && !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
        return url.href;
    } catch {
        return '';
    }
}

function safeColor(value, fallback = 'inherit') {
    const color = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function parseMarkdown(text, msg = {}) {
    if (!text) return '';
    let html = escapeHTML(text);

    html = html.replace(/&lt;a?:([^:]+):(\d+)&gt;/g, (match, name, id) => {
    const isAnim = match.startsWith('&lt;a:');
    const ext = isAnim ? 'gif' : 'png';
    return `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${name}:" title=":${name}:" />`;
    });

    if (msg.mentions) {
    if (Array.isArray(msg.mentions.users)) {
        msg.mentions.users.forEach(u => {
        if (!/^\d+$/.test(String(u?.id || ''))) return;
        const regex = new RegExp(`&lt;@!?${u.id}&gt;`, 'g');
        html = html.replace(regex, `<span class="mention">@${escapeHTML(u.name)}</span>`);
        });
    }
    if (Array.isArray(msg.mentions.roles)) {
        msg.mentions.roles.forEach(r => {
        if (!/^\d+$/.test(String(r?.id || ''))) return;
        const regex = new RegExp(`&lt;@&amp;${r.id}&gt;`, 'g');
        const color = r.color === '#000000' ? '' : safeColor(r.color, '');
        const style = color ? `style="color: ${color}; background-color: ${color}20;"` : '';
        html = html.replace(regex, `<span class="mention" ${style}>@${escapeHTML(r.name)}</span>`);
        });
    }
    if (Array.isArray(msg.mentions.channels)) {
        msg.mentions.channels.forEach(c => {
        if (!/^\d+$/.test(String(c?.id || ''))) return;
        const regex = new RegExp(`&lt;#${c.id}&gt;`, 'g');
        html = html.replace(regex, `<span class="mention">#${escapeHTML(c.name)}</span>`);
        });
    }
    }

    html = html.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@User</span>');
    html = html.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@Role</span>');
    html = html.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#Channel</span>');

    html = html.replace(/```([\s\S]*?)```/g, '<span class="md-codeblock">$1</span>');
    html = html.replace(/`([^`]+)`/g, '<span class="md-code">$1</span>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">$1</span>');
    html = html.replace(/\*([^*]+)\*/g, '<span class="md-italic">$1</span>');
    html = html.replace(/_([^_]+)_/g, '<span class="md-italic">$1</span>');
    html = html.replace(/__([^_]+)__/g, '<span class="md-underline">$1</span>');
    html = html.replace(/~~([^~]+)~~/g, '<span class="md-strike">$1</span>');
    return html;
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return 'Unknown time';
    return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
    });
}

function renderMessage(value) {
    const msg = value && typeof value === 'object' ? value : {};
    const author = msg.author && typeof msg.author === 'object' ? msg.author : {};
    const timeStr = formatTime(msg.timestamp);
    const botTag = author.bot ? '<span class="message-bot-tag">BOT</span>' : '';
    const avatarUrl = safeHttpUrl(author.avatar, ['cdn.discordapp.com', 'media.discordapp.net'])
        || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const authorColor = author.color === '#000000' ? 'inherit' : safeColor(author.color);

    let attachmentsHtml = '';
    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    attachmentsHtml = '<div class="attachments">';
    msg.attachments.forEach(att => {
        const attachmentUrl = safeHttpUrl(att.url, ['cdn.discordapp.com', 'media.discordapp.net']);
        if (!attachmentUrl) return;
        if (att.contentType && att.contentType.startsWith('image/')) {
        attachmentsHtml += `<img src="${escapeHTML(attachmentUrl)}" alt="${escapeHTML(att.name)}" class="attachment-img" />`;
        } else {
        attachmentsHtml += `<div class="attachment-file"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg><a href="${escapeHTML(attachmentUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(att.name)}</a></div>`;
        }
    });
    attachmentsHtml += '</div>';
    }

    let embedsHtml = '';
    if (Array.isArray(msg.embeds) && msg.embeds.length > 0) {
    msg.embeds.forEach(value => {
        const emb = value && typeof value === 'object' ? value : {};
        const numericColor = Number(emb.color);
        const colorHex = Number.isInteger(numericColor) && numericColor >= 0 && numericColor <= 0xffffff
            ? `#${numericColor.toString(16).padStart(6, '0')}`
            : '#202225';
        let authorHtml = '';
        if (emb.author) {
        const authorIcon = safeHttpUrl(emb.author.icon_url, ['cdn.discordapp.com', 'media.discordapp.net']);
        authorHtml = `
            <div class="embed-author">
            ${authorIcon ? `<img src="${escapeHTML(authorIcon)}" class="embed-author-icon" alt=""/>` : ''}
            <div class="embed-author-name">${escapeHTML(emb.author.name)}</div>
            </div>`;
        }

        let titleHtml = emb.title ? `<div class="embed-title">${escapeHTML(emb.title)}</div>` : '';
        let descHtml = emb.description ? `<div class="embed-description">${parseMarkdown(emb.description, msg)}</div>` : '';
        
        let fieldsHtml = '';
        if (Array.isArray(emb.fields) && emb.fields.length > 0) {
        fieldsHtml = '<div class="embed-fields">';
        emb.fields.forEach(f => {
            const inlineClass = f.inline ? ' inline' : '';
            fieldsHtml += `
            <div class="embed-field${inlineClass}">
                <div class="embed-field-name">${parseMarkdown(f.name, msg)}</div>
                <div class="embed-field-value">${parseMarkdown(f.value, msg)}</div>
            </div>`;
        });
        fieldsHtml += '</div>';
        }

        let footerHtml = '';
        if (emb.footer && typeof emb.footer === 'object') {
        const footerIcon = safeHttpUrl(emb.footer.icon_url, ['cdn.discordapp.com', 'media.discordapp.net']);
        footerHtml = `
            <div class="embed-footer">
            ${footerIcon ? `<img src="${escapeHTML(footerIcon)}" class="embed-footer-icon" alt=""/>` : ''}
            <span>${escapeHTML(emb.footer.text)}</span>
            </div>`;
        }

        embedsHtml += `
        <div class="embed-wrapper">
            <div class="embed-color-pill" style="background-color: ${colorHex}"></div>
            <div class="embed-inner">
            ${authorHtml}
            ${titleHtml}
            ${descHtml}
            ${fieldsHtml}
            ${footerHtml}
            </div>
        </div>`;
    });
    }

    return `
    <div class="message-group">
        <div class="message-avatar">
        <img src="${escapeHTML(avatarUrl)}" alt="" data-avatar-fallback/>
        </div>
        <div class="message-header">
        <span class="message-author" style="color: ${authorColor}">${escapeHTML(author.username || 'Unknown User')}</span>
        ${botTag}
        <span class="message-timestamp">${timeStr}</span>
        </div>
        <div class="message-content">${parseMarkdown(msg.content, msg)}</div>
        ${attachmentsHtml}
        ${embedsHtml}
    </div>
    `;
}

async function attemptFetch(password = '') {
    try {
    loadingScreen.classList.remove('hidden');
    passwordScreen.classList.add('hidden');
    errorScreen.classList.add('hidden');
    
    const res = await fetch(`/api/transcript/${transcriptId}`, {
        headers: password ? { Authorization: `Transcript ${password}` } : {},
    });
    
    if (res.status === 401 || res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        loadingScreen.classList.add('hidden');
        passwordScreen.classList.remove('hidden');
        if (errData.meta) {
        document.getElementById('metaBox').classList.remove('hidden');
        document.getElementById('metaTicketName').textContent = '#' + errData.meta.ticket_name;
        document.getElementById('metaCreatedAt').textContent = formatTime(errData.meta.created_at);
        }
        if (password) {
        errorMsg.classList.remove('hidden');
        }
        return;
    }

    if (!res.ok) {
        loadingScreen.classList.add('hidden');
        errorScreen.classList.remove('hidden');
        return;
    }

    const data = await res.json();
    const ticketName = String(data.ticket_name || 'ticket');

    tbTitle.textContent = ticketName;
    chTitle.textContent = `Welcome to #${ticketName}!`;

    let subtitleText = `Created on ${formatTime(data.created_at)}`;
    if (data.closed_by) subtitleText += ` | Closed by ${data.closed_by}`;
    if (data.claimed_by) subtitleText += ` | Claimed by ${data.claimed_by}`;
    tbSubtitle.textContent = subtitleText;

    const messages = Array.isArray(data.messages) ? data.messages.slice(0, 10000) : [];
    let htmlContent = '';
    messages.forEach(msg => {
        htmlContent += renderMessage(msg);
    });

    messagesContainer.innerHTML = htmlContent;
    // CSP script-src 'self' chan onerror inline; su kien 'error' khong bubble
    // nen phai gan truc tiep sau khi chen HTML.
    messagesContainer.querySelectorAll('img[data-avatar-fallback]').forEach(img => {
        img.onerror = () => { img.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; };
    });
    
    loadingScreen.classList.add('hidden');
    topbar.classList.remove('hidden');
    chatArea.classList.remove('hidden');
    
    } catch (err) {
    console.error(err);
    loadingScreen.classList.add('hidden');
    errorScreen.classList.remove('hidden');
    errorDesc.textContent = "An error occurred while loading transcript.";
    }
}

btnSubmit.addEventListener('click', () => {
    const pwd = pwdInput.value.trim();
    if (pwd) attemptFetch(pwd);
});

pwdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
    const pwd = pwdInput.value.trim();
    if (pwd) attemptFetch(pwd);
    }
});

const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
});

attemptFetch('');
