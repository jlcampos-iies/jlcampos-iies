const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token, secret, remoteip, fetchImpl = fetch) {
  if (!token || typeof token !== 'string') return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set('remoteip', remoteip);
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await res.json();
    return json?.success === true;
  } catch {
    return false;
  }
}
