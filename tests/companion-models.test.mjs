import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Workspace } from '../companion/workspace.mjs';
import { discoverModels, enforceFreeRoute } from '../companion/models.mjs';
import { runAgent } from '../companion/agent.mjs';
import { createCompanion } from '../companion/server.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-models-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root); await workspace.select(root);
  return { root, workspace };
}
async function mock(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const answer = (res, text) => json(res, { choices: [{ message: { role: 'assistant', content: text } }] });
async function body(req) { let input = ''; for await (const chunk of req) input += chunk; return JSON.parse(input); }

test('catalog verifies zero rates and exact free aliases while blocking unknown, paid, fee and auto models', async (t) => {
  let catalogs = 0;
  const baseUrl = await mock(t, (req, res) => {
    catalogs++;
    assert.equal(req.headers.authorization, 'Bearer model-secret');
    assert.equal(new URL(req.url, 'http://localhost').searchParams.get('configuredOnly'), 'true');
    json(res, { data: [
      { id: 'paid', pricing: { input: 0.01, output: 0.02 } },
      { id: 'label-only', free: true },
      { id: 'blank-zero', pricing: { input: '', output: '' } },
      { id: 'fee', pricing: { input: 0, output: 0, request: 0.01 } },
      { id: 'conflict:free', free: false },
      { id: 'auto/coding:free', owned_by: 'combo', pricing: { input: 0, output: 0 } },
      { id: 'coder:free', capabilities: { tool_calling: true } },
      { id: 'zero', pricing: { prompt: '0', completion: '0', cache_creation: 0 }, capabilities: { tool_calling: true } },
      { id: 'image:free', type: 'image', output_modalities: ['image'] },
    ] });
  });
  const route = { baseUrl, model: 'auto', apiKey: 'model-secret' };
  const catalog = await discoverModels(route);
  assert.deepEqual(catalog.models.filter((model) => model.free).map((model) => model.id), ['coder:free', 'zero']);
  assert.equal(catalog.selected, 'coder:free');
  assert.equal(JSON.stringify(catalog).includes('model-secret'), false);
  await discoverModels(route);
  assert.equal(catalogs, 1);
  await discoverModels(route, { refresh: true });
  assert.equal(catalogs, 2);
  await assert.rejects(() => enforceFreeRoute({ ...route, model: 'paid' }), /Free Only blocked/);
  await assert.rejects(() => enforceFreeRoute({ ...route, model: 'label-only' }), /Free Only blocked/);
  assert.equal((await enforceFreeRoute(route, { requireTools: true })).model, 'coder:free');
});

test('Free Only auto selects a direct model and never sends paid/unknown inference requests', async (t) => {
  const { workspace } = await fixture(t);
  const requested = [];
  const baseUrl = await mock(t, async (req, res) => {
    if (req.method === 'GET') return json(res, { data: [{ id: 'paid', pricing: { input: 1, output: 1 } }, { id: 'unknown' }, { id: 'direct-zero', pricing: { input: 0, output: 0 }, capabilities: { tool_calling: true } }] });
    const data = await body(req); requested.push(data.model); answer(res, 'Free answer.');
  });
  const routing = { freeOnly: true, primary: { baseUrl, model: 'auto' }, fallbacks: [] };
  const result = await runAgent({ prompt: 'Hi', routing }, workspace, () => {});
  assert.equal(result.model, 'direct-zero');
  assert.deepEqual(requested, ['direct-zero']);
  for (const model of ['paid', 'unknown']) await assert.rejects(() => runAgent({ prompt: 'Hi', routing: { ...routing, primary: { baseUrl, model } } }, workspace, () => {}), /Free Only blocked/);
  assert.deepEqual(requested, ['direct-zero']);
});

test('Free Only skips paid fallback before inference and continues to a verified free route', async (t) => {
  const { workspace } = await fixture(t);
  let paidRequests = 0, freeRequests = 0;
  const primary = await mock(t, (req, res) => {
    if (req.method === 'GET') return json(res, { data: [{ id: 'primary:free' }] });
    res.writeHead(503); res.end();
  });
  const paid = await mock(t, (req, res) => {
    if (req.method === 'GET') return json(res, { data: [{ id: 'paid', pricing: { input: 1, output: 1 } }] });
    paidRequests++; answer(res, 'Should never execute.');
  });
  const free = await mock(t, (req, res) => {
    if (req.method === 'GET') return json(res, { data: [{ id: 'fallback:free' }] });
    freeRequests++; answer(res, 'Verified fallback.');
  });
  const events = [];
  const result = await runAgent({ prompt: 'Hi', routing: { freeOnly: true, primary: { baseUrl: primary, model: 'primary:free' }, fallbacks: [{ baseUrl: paid, model: 'paid' }, { baseUrl: free, model: 'fallback:free' }] } }, workspace, (event) => events.push(event));
  assert.equal(paidRequests, 0);
  assert.equal(freeRequests, 1);
  assert.equal(result.text, 'Verified fallback.');
  assert.equal(events.filter((event) => event.type === 'fallback').length, 2);
  assert.match(events.find((event) => event.type === 'fallback' && event.from === paid).reason, /Free Only blocked/);
});

test('existing OmniRoute runs after live verification and blocks again if its safeguard changes', async (t) => {
  const { workspace } = await fixture(t);
  let requests = 0, enabled = true;
  const gateway = await mock(t, (req, res) => {
    if (req.url === '/api/settings/feature-flags') return json(res, { flags: [{ key: 'OMNIROUTE_EMERGENCY_FALLBACK', type: 'boolean', requiresRestart: false, effectiveValue: enabled ? 'true' : 'false' }] });
    if (req.method === 'GET') return json(res, { data: [{ id: 'direct:free' }] });
    requests++; answer(res, 'Verified free route.');
  });
  const fetchImpl = (url, options) => fetch(new URL(url).href.replace('http://127.0.0.1:20128', new URL(gateway).origin), options);
  const route = { baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' };
  const discovery = await discoverModels(route, { refresh: true, fetchImpl });
  assert.equal(discovery.models[0].free, true);
  assert.equal(discovery.safeguards.verified, false);
  await assert.rejects(() => runAgent({ prompt: 'Hi', routing: { freeOnly: true, primary: route, fallbacks: [] } }, workspace, () => {}, { fetchImpl }), /emergency fallback.*cannot be verified/);
  assert.equal(requests, 0);
  enabled = false;
  const result = await runAgent({ prompt: 'Hi', routing: { freeOnly: true, primary: route, fallbacks: [] } }, workspace, () => {}, { fetchImpl });
  assert.equal(requests, 1);
  assert.equal(result.model, 'direct:free');
  const safe = await discoverModels(route, { fetchImpl });
  assert.equal(safe.safeguards.verified, true);
  enabled = true;
  await assert.rejects(() => runAgent({ prompt: 'Hi', routing: { freeOnly: true, primary: route, fallbacks: [] } }, workspace, () => {}, { fetchImpl }), /emergency fallback is enabled/);
  assert.equal(requests, 1);
});

test('failed catalog verification blocks inference and downloaded local Ollama excludes cloud models', async (t) => {
  const { workspace } = await fixture(t);
  let inference = 0;
  const failed = await mock(t, (req, res) => { if (req.method === 'POST') inference++; res.writeHead(503); res.end(); });
  await assert.rejects(() => runAgent({ prompt: 'Hi', routing: { freeOnly: true, primary: { baseUrl: failed, model: 'auto' }, fallbacks: [] } }, workspace, () => {}), /catalog could not be verified/);
  assert.equal(inference, 0);
  const localMock = await mock(t, (req, res) => {
    if (req.url === '/api/tags') return json(res, { models: [{ name: 'qwen2.5-coder:7b', model: 'qwen2.5-coder:7b', size: 4_000_000_000 }, { name: 'large:cloud', size: 10, remote_host: 'https://ollama.com' }] });
    json(res, { data: [{ id: 'qwen2.5-coder:7b' }, { id: 'large:cloud' }, { id: 'uninstalled' }] });
  });
  const fetchImpl = (url, options) => fetch(new URL(url).href.replace('http://127.0.0.1:11434', new URL(localMock).origin), options);
  const local = await discoverModels({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' }, { refresh: true, fetchImpl });
  assert.deepEqual(local.models.filter((model) => model.free).map((model) => model.id), ['qwen2.5-coder:7b']);
  assert.equal(local.selected, 'qwen2.5-coder:7b');
  await assert.rejects(() => enforceFreeRoute({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'large:cloud' }, { fetchImpl }), /not verified/);
});

test('protected model discovery endpoint returns a safe catalog and fails closed on HTTP errors', async (t) => {
  const { root } = await fixture(t);
  const route = await mock(t, (_req, res) => json(res, { data: [{ id: 'coder:free' }] }));
  const companion = await createCompanion({ workspace: root, stateDir: path.join(root, 'state'), token: 'catalog-token' });
  await new Promise((resolve) => companion.server.listen(0, '127.0.0.1', resolve));
  t.after(() => companion.close());
  const url = `http://127.0.0.1:${companion.server.address().port}/api/models`;
  const body = JSON.stringify({ route: { baseUrl: route, model: 'auto', apiKey: 'dont-return' } });
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer catalog-token' }, body });
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.selected, 'coder:free');
  assert.equal(JSON.stringify(catalog).includes('dont-return'), false);
});
