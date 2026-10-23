const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN = 2048;

/**
 * @param {string} token
 * @param {string} secret
 * @param {string} [remoteip]
 * @param {typeof fetch} [fetchImpl]
 * @param {{ hostnames?: string[], timeoutMs?: number }} [opts]
 */
export async function verifyTurnstile(token, secret, remoteip, fetchImpl = fetch, opts = {}) {
  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set('remoteip', remoteip);
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    const json = await res.json();
    if (json?.success !== true) return false;
    if (opts.hostnames?.length && !opts.hostnames.includes(json.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
