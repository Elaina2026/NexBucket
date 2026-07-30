export {};

const transcriptId = window.location.pathname.split('/').pop();
const loadingScreen = document.getElementById('loadingScreen');
const passwordScreen = document.getElementById('passwordScreen');
const errorScreen = document.getElementById('errorScreen');
const errorDesc = document.getElementById('errorDesc');
const errorMsg = document.getElementById('errorMsg');
const errorMsgText = document.getElementById('errorMsgText');

const topbar = document.getElementById('topbar');
const chatArea = document.getElementById('chatArea');
const tbTitle = document.getElementById('tbTitle');
const tbSubtitle = document.getElementById('tbSubtitle');
const chTitle = document.getElementById('chTitle');
const messagesContainer = document.getElementById('messagesContainer');

const pwdInput = document.getElementById('pwdInput');
const btnSubmit = document.getElementById('btnSubmit');

function escapeHTML(str) {
    if (!str) return '';
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

function parseMarkdown(text, msg) {
    if (!text) return '';
    let html = escapeHTML(text);

    html = html.replace(/&lt;a?:([^:]+):(\d+)&gt;/g, (match, name, id) => {
    const isAnim = match.startsWith('&lt;a:');
    const ext = isAnim ? 'gif' : 'png';
    return `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${name}:" title=":${name}:" />`;
    });

    if (msg && msg.mentions) {
    if (msg.mentions.users) {
        msg.mentions.users.forEach(u => {
        const regex = new RegExp(`&lt;@!?${u.id}&gt;`, 'g');
        html = html.replace(regex, `<span class="mention">@${escapeHTML(u.name)}</span>`);
        });
    }
    if (msg.mentions.roles) {
        msg.mentions.roles.forEach(r => {
        const regex = new RegExp(`&lt;@&amp;${r.id}&gt;`, 'g');
        const color = (r.color && r.color !== '#000000') ? r.color : '';
        const style = color ? `style="color: ${color}; background-color: ${color}20;"` : '';
        html = html.replace(regex, `<span class="mention" ${style}>@${escapeHTML(r.name)}</span>`);
        });
    }
    if (msg.mentions.channels) {
        msg.mentions.channels.forEach(c => {
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
    return d.toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
    });
}

function renderMessage(msg) {
    const timeStr = formatTime(msg.timestamp);
    const botTag = msg.author.bot ? '<span class="message-bot-tag">BOT</span>' : '';
    
    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
    attachmentsHtml = '<div class="attachments">';
    msg.attachments.forEach(att => {
        if (att.contentType && att.contentType.startsWith('image/')) {
        attachmentsHtml += `<img src="${escapeHTML(att.url)}" alt="${escapeHTML(att.name)}" class="attachment-img" />`;
        } else {
        attachmentsHtml += `<div class="attachment-file"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg><a href="${escapeHTML(att.url)}" target="_blank">${escapeHTML(att.name)}</a></div>`;
        }
    });
    attachmentsHtml += '</div>';
    }

    let embedsHtml = '';
    if (msg.embeds && msg.embeds.length > 0) {
    msg.embeds.forEach(emb => {
        const colorHex = emb.color ? '#' + emb.color.toString(16).padStart(6, '0') : '#202225';
        let authorHtml = '';
        if (emb.author) {
        authorHtml = `
            <div class="embed-author">
            ${emb.author.icon_url ? `<img src="${escapeHTML(emb.author.icon_url)}" class="embed-author-icon"/>` : ''}
            <div class="embed-author-name">${escapeHTML(emb.author.name)}</div>
            </div>`;
        }

        let titleHtml = emb.title ? `<div class="embed-title">${escapeHTML(emb.title)}</div>` : '';
        let descHtml = emb.description ? `<div class="embed-description">${parseMarkdown(emb.description, msg)}</div>` : '';
        
        let fieldsHtml = '';
        if (emb.fields && emb.fields.length > 0) {
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
        if (emb.footer) {
        footerHtml = `
            <div class="embed-footer">
            ${emb.footer.icon_url ? `<img src="${escapeHTML(emb.footer.icon_url)}" class="embed-footer-icon"/>` : ''}
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
        <img src="${escapeHTML(msg.author.avatar)}" alt="" data-avatar-fallback/>
        </div>
        <div class="message-header">
        <span class="message-author" style="color: ${msg.author.color && msg.author.color !== '#000000' ? msg.author.color : 'inherit'}">${escapeHTML(msg.author.username)}</span>
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
    
    const res = await fetch(`/api/transcript/${transcriptId}?pwd=${encodeURIComponent(password)}`);
    
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
    
    tbTitle.textContent = data.ticket_name;
    chTitle.textContent = `Welcome to #${data.ticket_name}!`;
    
    let subtitleText = `Created on ${formatTime(data.created_at)}`;
    if (data.closed_by) subtitleText += ` | Closed by ${data.closed_by}`;
    if (data.claimed_by) subtitleText += ` | Claimed by ${data.claimed_by}`;
    tbSubtitle.textContent = subtitleText;

    const messages = data.messages || [];
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
