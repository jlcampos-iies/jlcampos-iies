export type ContactResult = 'ok' | 'validation' | 'captcha' | 'send' | 'network';

const ERRORS = ['validation', 'captcha', 'send'] as const;

/** Envía el formulario a la Lambda y traduce la respuesta (nunca lanza). */
export async function submitContact(
  form: HTMLFormElement,
  fetchImpl: typeof fetch = fetch,
): Promise<ContactResult> {
  try {
    const res = await fetchImpl(form.getAttribute('action') ?? '/api/contact', {
      method: 'POST',
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
) {
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  const alerts = [...form.querySelectorAll<HTMLElement>('[role=alert]')];
  const hideErrors = () => alerts.forEach((a) => a.classList.remove('is-visible'));
  let pending: Promise<void> = Promise.resolve();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (button?.disabled) return;
    if (button) button.disabled = true;
    hideErrors();
    pending = (async () => {
      const result = await submitContact(form, fetchImpl);
      if (result === 'ok') {
        navigate(form.dataset.thanks ?? '/');
        return;
      }
      if (button) button.disabled = false;
      if (result === 'captcha') {
        (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset();
      }
      // El `:target` de una visita anterior no debe mantener visible otro mensaje.
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      const el = form.querySelector<HTMLElement>(`#form-error-${result}`);
      el?.classList.add('is-visible');
      el?.focus();
    })();
  });

  return { settled: () => pending };
}

for (const form of document.querySelectorAll<HTMLFormElement>('form[data-contact-form]')) {
  initContactForm(form);
}
