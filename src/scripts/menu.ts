document.documentElement.classList.add('js');

const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const panel = document.getElementById('site-menu');

if (toggle && panel) {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      panel.classList.remove('is-open');
      toggle.focus();
    }
  });
}
