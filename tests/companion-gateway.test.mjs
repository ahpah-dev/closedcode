import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOmniRoute, configureOmniRoute } from '../companion/gateway.mjs';
import { enforceFreeRoute } from '../companion/models.mjs';
const route = { baseUrl: 'http://127.0.0.1:20128/v1', model: 'direct:free', apiKey: 'test-private-key' };
const flag = (effectiveValue = 'false') => ({ key: 'OMNIROUTE_EMERGENCY_FALLBACK', type: 'boolean', requiresRestart: false, effectiveValue });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('running external gateway is verified from effective runtime settings and rechecked each request', async () => {
  let enabled = false, checks = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-private-key');
    assert.equal(new URL(url).origin, new URL(route.baseUrl).origin);
    if (new URL(url).pathname === '/api/settings/feature-flags') {
      checks++; assert.equal(options.redirect, 'error');
      return json({ flags: [flag(enabled ? 'true' : 'false')] });
    }
    return json({ data: [{ id: 'direct:free' }, { id: 'bundle', owned_by: 'combo', pricing: { input: 0, output: 0 } }] });
  };
  const result = await verifyOmniRoute(route, { fetchImpl });
  assert.equal(result.verified, true);
  assert.equal(JSON.stringify(result).includes(route.apiKey), false);
  assert.equal((await enforceFreeRoute(route, { fetchImpl })).model, 'direct:free');
  enabled = true;
  await assert.rejects(() => enforceFreeRoute(route, { fetchImpl }), /emergency fallback is enabled/);
  assert.equal(checks, 3);
  enabled = false;
  assert.equal((await enforceFreeRoute({ ...route, model: 'auto/free' }, { fetchImpl })).model, 'direct:free');
  await assert.rejects(() => enforceFreeRoute({ ...route, model: 'bundle' }, { fetchImpl }), /direct model/);
});

test('missing, duplicate, malformed, restart-required and unauthenticated safeguards fail closed', async () => {
  for (const flags of [[], [flag('true')], [flag('false'), flag('true')], [{ ...flag(), requiresRestart: true }], [{ ...flag(), type: 'string' }], [flag(false)], [flag('unknown')]]) {
    assert.equal((await verifyOmniRoute(route, { fetchImpl: async () => json({ flags }) })).verified, false);
  }
  for (const status of [401, 403, 404, 500]) {
    const result = await verifyOmniRoute(route, { fetchImpl: async () => json({ error: 'private server detail' }, status) });
    assert.equal(result.verified, false);
    assert.equal(JSON.stringify(result).includes('private server detail'), false);
    assert.match(result.reason, status === 404 ? /Update OmniRoute/ : status < 404 ? /did not accept this key/ : /HTTP 500/);
  }
  assert.equal((await verifyOmniRoute(route, { fetchImpl: async () => { throw new Error('network secret'); } })).verified, false);
});

test('missing gateway key has its own diagnostic and never probes or configures models', async () => {
  const paths = [];
  const fetchImpl = async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, undefined);
    return json({ error: 'private detail must not be displayed' }, 401);
  };
  const result = await configureOmniRoute({ ...route, apiKey: '' }, { fetchImpl });
  assert.equal(result.verified, false);
  assert.equal(result.code, 'missing_key');
  assert.equal(result.inferenceAuth, 'missing');
  assert.match(result.reason, /key entered in Cline is not shared/);
  assert.deepEqual(paths, ['/api/settings/feature-flags']);
});

test('valid model key without management access is distinct from a rejected key', async () => {
  for (const managementStatus of [401, 403]) {
    const calls = [];
    const fetchImpl = async (url, options) => {
      const parsed = new URL(url);
      calls.push(`${options.method} ${parsed.pathname}${parsed.search}`);
      assert.equal(parsed.origin, 'http://127.0.0.1:20128');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer ${route.apiKey}`);
      assert.ok(options.signal);
      return parsed.pathname === '/api/settings/feature-flags'
        ? json({ error: route.apiKey }, managementStatus)
        : json({ data: [{ id: 'model:free' }] });
    };
    const result = await configureOmniRoute(route, { fetchImpl });
    assert.equal(result.verified, false);
    assert.equal(result.code, 'management_permission_required');
    assert.equal(result.inferenceAuth, 'accepted');
    assert.equal(result.managementAuth, 'rejected');
    assert.match(result.reason, /Your key can access OmniRoute models/);
    assert.match(result.reason, /manage permission/);
    assert.equal(JSON.stringify(result).includes(route.apiKey), false);
    assert.deepEqual(calls, ['GET /api/settings/feature-flags', 'GET /v1/models?configuredOnly=true']);
  }
  const rejected = await verifyOmniRoute(route, { fetchImpl: async () => json({ error: route.apiKey }, 401) });
  assert.equal(rejected.code, 'invalid_key');
  assert.equal(rejected.inferenceAuth, 'rejected');
  assert.equal(JSON.stringify(rejected).includes(route.apiKey), false);
});

test('inconclusive catalog auth stays unconfirmed and no private body or network error escapes', async () => {
  const variants = [
    () => json({ error: route.apiKey }, 500),
    () => json({ data: [{ id: 42 }] }),
    () => new Response('<html>private dashboard</html>'),
    () => new Response(JSON.stringify({ data: [], padding: route.apiKey.repeat(40_000) })),
    () => { throw new Error(`private error ${route.apiKey}`); },
  ];
  for (const catalog of variants) {
    const result = await verifyOmniRoute(route, { fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      return new URL(url).pathname === '/api/settings/feature-flags' ? json({}, 403) : catalog();
    } });
    assert.equal(result.verified, false);
    assert.equal(result.code, 'auth_unconfirmed');
    assert.equal(result.inferenceAuth, 'unknown');
    assert.equal(JSON.stringify(result).includes(route.apiKey), false);
    assert.equal(JSON.stringify(result).includes('private dashboard'), false);
  }
});

test('unknown runtime flag cannot trigger a settings write and oversized safeguard responses fail closed', async () => {
  let calls = 0;
  const result = await configureOmniRoute(route, { fetchImpl: async (url, options) => {
    calls++; assert.equal(options.method, 'GET');
    return json({ flags: [{ ...flag('false'), requiresRestart: true }] });
  } });
  assert.equal(result.verified, false);
  assert.equal(result.code, 'safeguards_unconfirmed');
  assert.equal(calls, 1);
  const oversized = await verifyOmniRoute(route, { fetchImpl: async () => new Response('x'.repeat(512_001)) });
  assert.equal(oversized.code, 'invalid_response');
  assert.equal(oversized.verified, false);
});

test('explicit setup changes only supported emergency flag, then verifies live state without a restart', async () => {
  let enabled = true; const methods = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:20128/api/settings/feature-flags');
    methods.push(options.method);
    if (options.method === 'PUT') { assert.deepEqual(JSON.parse(options.body), { key: 'OMNIROUTE_EMERGENCY_FALLBACK', value: 'false' }); enabled = false; return json({ effectiveValue: 'false' }); }
    return json({ flags: [flag(enabled ? 'true' : 'false')] });
  };
  assert.equal((await configureOmniRoute(route, { fetchImpl })).verified, true);
  assert.deepEqual(methods, ['GET', 'PUT', 'GET']);
  await configureOmniRoute(route, { fetchImpl });
  assert.deepEqual(methods, ['GET', 'PUT', 'GET', 'GET']);
  await assert.rejects(() => configureOmniRoute({ baseUrl: 'https://other.example/v1' }, { fetchImpl }), /only for local/);
});

test('one-click OmniRoute setup configures user API key and verifies live safeguards', async () => {
  let fallbackEnabled = true;
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer user-typed-api-key');
    if (options.method === 'PUT') {
      assert.deepEqual(JSON.parse(options.body), { key: 'OMNIROUTE_EMERGENCY_FALLBACK', value: 'false' });
      fallbackEnabled = false;
      return json({ effectiveValue: 'false' });
    }
    return json({ flags: [flag(fallbackEnabled ? 'true' : 'false')] });
  };
  const userRoute = { baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto', apiKey: 'user-typed-api-key' };
  const result = await configureOmniRoute(userRoute, { fetchImpl });
  assert.equal(result.verified, true);
  assert.equal(result.emergencyFallbackDisabled, true);
});
