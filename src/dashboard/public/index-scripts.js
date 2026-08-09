export {};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion) {
  let scrollFrame = 0;
  window.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const hero = document.getElementById('heroSection');
      if (!hero) return;
      const scrollY = window.scrollY;
      hero.style.transform = `translateY(${scrollY * 0.3}px)`;
      hero.style.opacity = String(Math.max(0, 1 - scrollY / 600));
    });
  }, { passive: true });
}

document.getElementById('langToggle')?.addEventListener('click', () => {
  const current = window.NexI18n?.getLang() || 'en';
  window.NexI18n?.setLang(current === 'en' ? 'vi' : 'en');
});

const observeCards = () => {
  const cards = document.querySelectorAll('.feature-card, .creator-card');
  if (!cards.length || reduceMotion || !('IntersectionObserver' in window)) return;
  cards.forEach(card => card.classList.add('reveal-pending'));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.remove('reveal-pending');
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  cards.forEach(card => observer.observe(card));
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeCards);
else observeCards();
