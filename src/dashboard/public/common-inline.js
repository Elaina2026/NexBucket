export {};

document.getElementById('themeToggle')?.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('nex-theme', isLight ? 'dark' : 'light');
});

const langToggle = document.getElementById('langToggle');
if (langToggle) {
    const updateSVG = (lang) => {
        const svgEN = '<svg viewBox="0 0 60 30" width="18" height="12" style="border-radius:2px; vertical-align: middle; margin-right: 6px;"><clipPath id="t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#t)" stroke="#C8102E" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></svg>';
        const svgVN = '<svg viewBox="0 0 900 600" width="18" height="12" style="border-radius:2px; vertical-align: middle; margin-right: 6px;"><rect width="900" height="600" fill="#da251d"/><polygon fill="#ff0" points="450,114.7 534.6,375 313.3,214.3 586.7,214.3 365.4,375"/></svg>';
        
        if (langToggle.innerHTML.includes('VN') || langToggle.innerHTML.includes('EN')) {
            langToggle.innerHTML = lang === 'vi' ? svgVN + ' VN' : svgEN + ' EN';
        }
    };
    
    if (window.NexI18n) {
        updateSVG(window.NexI18n.getLang());
    } else {
        const savedLang = localStorage.getItem('nex-lang') || 'en';
        document.documentElement.setAttribute('lang', savedLang);
        updateSVG(savedLang);
    }
    
    langToggle.addEventListener('click', () => {
        if (window.NexI18n) {
            const current = window.NexI18n.getLang();
            const nextLang = current === 'en' ? 'vi' : 'en';
            window.NexI18n.setLang(nextLang);
            updateSVG(nextLang);
        } else {
            const currentLang = document.documentElement.getAttribute('lang') || 'en';
            const nextLang = currentLang === 'vi' ? 'en' : 'vi';
            document.documentElement.setAttribute('lang', nextLang);
            localStorage.setItem('nex-lang', nextLang);
            updateSVG(nextLang);
        }
    });
}

document.querySelectorAll('.current-date').forEach(el => {
    el.textContent = new Date().toLocaleDateString();
});
