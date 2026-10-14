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
    assert.match(result.reason, status === 404 ? /Update OmniRoute/ : status < 404 ? /manage permission/ : /HTTP 500/);
  }
  assert.equal((await verifyOmniRoute(route, { fetchImpl: async () => { throw new Error('network secret'); } })).verified, false);
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
