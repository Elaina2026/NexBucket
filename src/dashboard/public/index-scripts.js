export {};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
