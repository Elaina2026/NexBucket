export {};

document.getElementById('themeToggle')?.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('nex-theme', isLight ? 'dark' : 'light');
});

document.getElementById('langToggle')?.addEventListener('click', () => {
    const current = window.NexI18n?.getLang() || 'en';
    window.NexI18n?.setLang(current === 'en' ? 'vi' : 'en');
});

document.querySelectorAll('.current-date').forEach(el => {
    el.textContent = new Date().toLocaleDateString();
});
