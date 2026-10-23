export type ContactResult = 'ok' | 'validation' | 'captcha' | 'send' | 'network';

const TIMEOUT_MS = 15000;
const ERRORS = ['validation', 'captcha', 'send'] as const;

/** Envía el formulario a la Lambda y traduce la respuesta (nunca lanza). */
export async function submitContact(
  form: HTMLFormElement,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<ContactResult> {
  try {
    const res = await fetchImpl(form.getAttribute('action') ?? '/api/contact', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString(),
    });
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return 'network';
    }
    const body = (data && typeof data === 'object' ? data : {}) as { ok?: unknown; error?: unknown };
    if (res.ok && body.ok === true) return 'ok';
    const known = ERRORS.find((e) => e === body.error);
    return known ?? 'network';
  } catch {
    return 'network';
  }
}

interface TurnstileApi {
  reset: () => void;
}

/** Mejora progresiva: envía por fetch y muestra los mismos mensajes que la ruta sin JS. */
export function initContactForm(
  form: HTMLFormElement,
  fetchImpl: typeof fetch = fetch,
  navigate: (url: string) => void = (url) => location.assign(url),
  timeoutMs = TIMEOUT_MS,
) {
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  const alerts = [...form.querySelectorAll<HTMLElement>('[role=alert]')];
  const label = button?.textContent ?? '';
  const resetCaptcha = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset();
  // `.is-hidden` gana a `:target`, que replaceState no deja de aplicar.
  const hideErrors = () =>
    alerts.forEach((a) => {
      a.classList.remove('is-visible');
      a.classList.add('is-hidden');
    });
  const idle = () => {
    if (!button) return;
    button.disabled = false;
    button.textContent = label;
    button.removeAttribute('aria-busy');
  };
  let pending: Promise<void> = Promise.resolve();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = button.dataset.sending ?? label;
    }
    hideErrors();
    pending = (async () => {
      const result = await submitContact(form, fetchImpl, timeoutMs);
      if (result === 'ok') {
        navigate(form.dataset.thanks ?? '/');
        return;
      }
      idle();
      // El token de Turnstile es de un solo uso y la Lambda lo consume antes de enviar.
      resetCaptcha();
      // El `:target` de una visita anterior no debe mantener visible otro mensaje.
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      const el = form.querySelector<HTMLElement>(`#form-error-${result}`);
      el?.classList.remove('is-hidden');
      el?.classList.add('is-visible');
      el?.focus();
    })();
  });

  // bfcache: al volver con «atrás» la página se restaura con el botón en «Enviando…».
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    idle();
    resetCaptcha();
  });

  return { settled: () => pending };
}

for (const form of document.querySelectorAll<HTMLFormElement>('form[data-contact-form]')) {
  initContactForm(form);
}
