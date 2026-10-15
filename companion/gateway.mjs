import { normalizeRoute } from './provider.mjs';

const FLAG = 'OMNIROUTE_EMERGENCY_FALLBACK';
const PATH = '/api/settings/feature-flags';
const RESPONSE_LIMIT = 512_000;
export const isOmniRoute = (route) => {
  const url = new URL(route.baseUrl);
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === '20128';
};

class GatewayCheckError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; Object.assign(this, details); }
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new GatewayCheckError('invalid_response', 'OmniRoute returned an empty safeguard response.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) throw new GatewayCheckError('invalid_response', 'OmniRoute response exceeded its limit.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new GatewayCheckError('invalid_response', 'OmniRoute did not return a valid safeguard response.'); }
}

async function authDiagnostic(route, { signal, fetchImpl = fetch } = {}) {
  if (!route.apiKey) return {
    code: 'missing_key', inferenceAuth: 'missing', managementAuth: 'rejected',
    reason: 'Add your OmniRoute gateway API key in ClosedCode. A key entered in Cline is not shared with this app. To verify free-only safeguards, this key also needs manage permission in OmniRoute.',
  };
  try {
    // A read-only catalog request distinguishes rejected credentials from a key
    // accepted for models but denied access to settings. Never run inference.
    const response = await fetchImpl(new URL('/v1/models?configuredOnly=true', route.baseUrl).href, {
      method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${route.apiKey}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if ([401, 403].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      return {
        code: 'invalid_key', inferenceAuth: 'rejected', managementAuth: 'rejected',
        reason: 'OmniRoute did not accept this key for model access. Copy an active gateway API key from OmniRoute into ClosedCode, then check again. An upstream provider key will not work here.',
      };
    }
    if (response.ok) {
      const data = await boundedJson(response);
      if (Array.isArray(data?.data) && data.data.every((model) => model && typeof model.id === 'string')) return {
        code: 'management_permission_required', inferenceAuth: 'accepted', managementAuth: 'rejected',
        reason: 'Your key can access OmniRoute models, but it cannot read gateway safeguards. In OmniRoute, add manage permission to a dedicated ClosedCode key, paste it here, then Verify gateway. Free-only runs stay blocked until verified.',
      };
    } else { await response.body?.cancel().catch(() => {}); }
  } catch (error) { if (signal?.aborted) throw error; }
  return {
    code: 'auth_unconfirmed', inferenceAuth: 'unknown', managementAuth: 'rejected',
    reason: 'OmniRoute denied access to gateway settings, and model-key access could not be confirmed. Check that the gateway is ready and use an active gateway key with manage permission, then Verify gateway.',
  };
}

async function request(route, { signal, fetchImpl = fetch, configure = false } = {}) {
  const response = await fetchImpl(new URL(PATH, route.baseUrl).href, {
    method: configure ? 'PUT' : 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    headers: { ...(route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}), ...(configure ? { 'Content-Type': 'application/json' } : {}) },
    ...(configure ? { body: JSON.stringify({ key: FLAG, value: 'false' }) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if ([401, 403].includes(response.status)) {
      const diagnostic = await authDiagnostic(route, { signal, fetchImpl });
      throw new GatewayCheckError(diagnostic.code, diagnostic.reason, diagnostic);
    }
    throw new GatewayCheckError(response.status === 404 ? 'unsupported_version' : 'gateway_unavailable',
      response.status === 404 ? 'This OmniRoute version does not expose runtime safeguards. Update OmniRoute, then Verify gateway.'
        : `OmniRoute safeguard check returned HTTP ${response.status}. Try Verify gateway again.`);
  }
  return boundedJson(response);
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
    const enabled = flag?.type === 'boolean' && flag.requiresRestart === false && ['true', '1'].includes(flag.effectiveValue);
    return {
      verified: disabled, emergencyFallbackDisabled: disabled,
      code: disabled ? 'verified' : enabled ? 'emergency_fallback_enabled' : 'safeguards_unconfirmed',
      managementAuth: 'accepted',
      // Free Only resolves a concrete direct model locally. It never submits
      // auto/combo routes, so OmniRoute's full-pool flag is outside this path.
      directModelsOnly: true,
      reason: disabled ? 'Running gateway verified: emergency fallback disabled. ClosedCode permits verified free direct models only.'
        : 'OmniRoute emergency fallback is enabled or cannot be verified. Choose Enable strict free routing, or turn off Emergency Fallback in OmniRoute Settings → Feature flags, then Verify gateway.',
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      verified: false, emergencyFallbackDisabled: false, directModelsOnly: true,
      code: error instanceof GatewayCheckError ? error.code : 'gateway_unreachable',
      ...(error.inferenceAuth ? { inferenceAuth: error.inferenceAuth } : {}),
      ...(error.managementAuth ? { managementAuth: error.managementAuth } : {}),
      reason: error instanceof GatewayCheckError ? error.message : 'Could not reach OmniRoute’s safeguard API. Check that the gateway is running, then Verify gateway.',
    };
  }
}

export async function configureOmniRoute(input, options = {}) {
  const route = normalizeRoute(input);
  if (!isOmniRoute(route)) throw new Error('Safeguard setup is available only for local OmniRoute at port 20128.');
  const current = await verifyOmniRoute(route, options);
  if (current.verified) return current;
  if (current.code !== 'emergency_fallback_enabled') return current;
  // A dedicated user action disables only this supported flag. Never reset
  // settings, modify prices, collect credentials or restart someone else's app.
  try { await request(route, { ...options, configure: true }); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    return { verified: false, emergencyFallbackDisabled: false, directModelsOnly: true,
      code: error instanceof GatewayCheckError ? error.code : 'gateway_unreachable',
      ...(error.inferenceAuth ? { inferenceAuth: error.inferenceAuth } : {}),
      ...(error.managementAuth ? { managementAuth: error.managementAuth } : {}),
      reason: error instanceof GatewayCheckError ? error.message : 'Could not update OmniRoute’s safeguard. Check that the gateway is running, then try again.',
    };
  }
  // OmniRoute caches this flag for 500ms. Wait for the old value to expire.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return verifyOmniRoute(route, options);
}
