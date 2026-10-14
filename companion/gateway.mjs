import { normalizeRoute } from './provider.mjs';

const FLAG = 'OMNIROUTE_EMERGENCY_FALLBACK';
const PATH = '/api/settings/feature-flags';
export const isOmniRoute = (route) => {
  const url = new URL(route.baseUrl);
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === '20128';
};

async function request(route, { signal, fetchImpl = fetch, configure = false } = {}) {
  const response = await fetchImpl(new URL(PATH, route.baseUrl).href, {
    method: configure ? 'PUT' : 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    headers: { ...(route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}), ...(configure ? { 'Content-Type': 'application/json' } : {}) },
    ...(configure ? { body: JSON.stringify({ key: FLAG, value: 'false' }) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error([401, 403].includes(response.status)
      ? 'OmniRoute needs an API key with manage permission to check safeguards. In its dashboard, grant manage permission to your ClosedCode key, then Verify gateway. Cline keys are not shared automatically.'
      : response.status === 404 ? 'This OmniRoute version does not expose runtime safeguards. Update OmniRoute, then Verify gateway.'
        : `OmniRoute safeguard check returned HTTP ${response.status}. Try Verify gateway again.`);
  }
  const text = await response.text();
  if (text.length > 512_000) throw new Error('OmniRoute safeguard response exceeded its limit.');
  try { return JSON.parse(text); } catch { throw new Error('OmniRoute did not return a valid safeguard response.'); }
}

// Verify the running service, never the identity of the process that launched
// it. The gateway's DB overrides take precedence over environment variables.
// No cache: each inference round checks the effective live flag again.
export async function verifyOmniRoute(input, options = {}) {
  const route = normalizeRoute(input);
  if (!isOmniRoute(route)) return { verified: true, reason: 'This endpoint does not use the local OmniRoute gateway.' };
  try {
    const data = await request(route, options);
    const flags = Array.isArray(data.flags) ? data.flags.filter((flag) => flag?.key === FLAG) : [];
    const flag = flags.length === 1 ? flags[0] : null;
    const disabled = flag?.type === 'boolean' && flag.requiresRestart === false && ['false', '0'].includes(flag.effectiveValue);
    return {
      verified: disabled, emergencyFallbackDisabled: disabled,
      // Free Only resolves a concrete direct model locally. It never submits
      // auto/combo routes, so OmniRoute's full-pool flag is outside this path.
      directModelsOnly: true,
      reason: disabled ? 'Running gateway verified: emergency fallback disabled. ClosedCode permits verified free direct models only.'
        : 'OmniRoute emergency fallback is enabled or cannot be verified. Choose Enable strict free routing, or turn off Emergency Fallback in OmniRoute Settings → Feature flags, then Verify gateway.',
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { verified: false, emergencyFallbackDisabled: false, directModelsOnly: true, reason: error.message?.startsWith('OmniRoute') || error.message?.startsWith('This OmniRoute') ? error.message : 'Could not reach OmniRoute’s safeguard API. Check the gateway and API key, then Verify gateway.' };
  }
}

export async function configureOmniRoute(input, options = {}) {
  const route = normalizeRoute(input);
  if (!isOmniRoute(route)) throw new Error('Safeguard setup is available only for local OmniRoute at port 20128.');
  const current = await verifyOmniRoute(route, options);
  if (current.verified) return current;
  // A dedicated user action disables only this supported flag. Never reset
  // settings, modify prices, collect credentials or restart someone else's app.
  await request(route, { ...options, configure: true });
  // OmniRoute caches this flag for 500ms. Wait for the old value to expire.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return verifyOmniRoute(route, options);
}
