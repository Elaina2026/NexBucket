export {};

window.addEventListener('scroll', () => {
  const hero = document.getElementById('heroSection');
  if (!hero) return;
  const scrollY = window.scrollY;
  hero.style.transform = `translateY(${scrollY * 0.3}px)`;
  hero.style.opacity = String(Math.max(0, 1 - scrollY / 600));
});

document.getElementById('langToggle')?.addEventListener('click', () => {
  const current = window.NexI18n?.getLang() || 'en';
  window.NexI18n?.setLang(current === 'en' ? 'vi' : 'en');
});

const observeCards = () => {
  const cards = document.querySelectorAll('.feature-card, .creator-card');
  if (!cards.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  cards.forEach(card => observer.observe(card));
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeCards);
else observeCards();
