import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareRouting } from '../companion/routing.mjs';
import { runAgent } from '../companion/agent.mjs';
import { Workspace } from '../companion/workspace.mjs';

test('automatic setup repairs missing local models, prefers tool support and excludes cloud models', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(url);
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'old-no-tools' }, { id: 'installed-current-coder' }, { id: 'remote-cloud' }] });
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'old-no-tools', size: 12 }, { name: 'installed-current-coder', size: 25 }, { name: 'remote-cloud', size: 10, remote_host: 'cloud.example' }] });
    const { model } = JSON.parse(options.body);
    return Response.json({ capabilities: model === 'installed-current-coder' ? ['tools', 'completion'] : ['completion'] });
  };
  const result = await prepareRouting({ primary: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' }, fallbacks: [], freeOnly: true }, { fetchImpl });
  assert.equal(result.ready, true); assert.equal(result.routing.primary.model, 'installed-current-coder');
  assert.equal(requests.some((url) => url.includes('chat/completions')), false);
});
test('automatic setup diagnoses gateway auth and selects only independently verified free fallbacks', async () => {
  const result = await prepareRouting({ primary: { baseUrl: 'https://gateway.example/v1', model: 'auto', apiKey: 'private' }, fallbacks: [{ baseUrl: 'https://free.example/v1', model: 'auto' }, { baseUrl: 'https://paid.example/v1', model: 'auto' }], freeOnly: true }, {
    fetchImpl: async (url) => url.includes('gateway.example') ? new Response(null, { status: 401 }) : Response.json({ data: [{ id: 'coder', pricing: { input: url.includes('paid.example') ? 2 : 0, output: 0 } }] }),
  });
  assert.equal(result.ready, true); assert.equal(result.routes.length, 1); assert.equal(result.routes[0].baseUrl, 'https://free.example/v1');
  assert.match(result.diagnostics[0].message, /API key.*Cline/); assert.equal(JSON.stringify(result.diagnostics).includes('private'), false);
});
test('temporary failure is retried once, preserves completed writes and suppresses identical repeated mutations', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-recovery-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root); await workspace.select(root);
  let requests = 0, writes = 0;
  const actualWrite = workspace.write.bind(workspace); workspace.write = async (...args) => { writes++; return actualWrite(...args); };
  const call = { id: 'save', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'demo.txt', content: 'saved' }) } };
  const events = [];
  await runAgent({ prompt: 'Save file', mode: 'build', routing: { primary: { baseUrl: 'https://fixture.example/v1', model: 'coder' }, fallbacks: [] } }, workspace, (event) => events.push(event), {
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests++;
      if (requests === 2) return new Response(null, { status: 503 });
      if (requests === 3) assert.equal(body.messages.some((item) => item.role === 'tool' && item.content.includes('demo.txt')), true);
      return Response.json({ choices: [{ message: requests < 4 ? { role: 'assistant', content: '', tool_calls: [call] } : { role: 'assistant', content: 'Saved once.' } }] });
    },
  });
  assert.equal(requests, 4); assert.equal(writes, 1); assert.equal(await fs.readFile(path.join(root, 'demo.txt'), 'utf8'), 'saved');
  assert.equal(events.some((event) => event.text?.includes('Retrying')), true);
  let failures = 0;
  await assert.rejects(() => runAgent({ prompt: 'Hi', routing: { primary: { baseUrl: 'https://fixture.example/v1', model: 'coder' }, fallbacks: [] } }, workspace, () => {}, { fetchImpl: async () => { failures++; return new Response(null, { status: 503 }); } }), /503/);
  assert.equal(failures, 2, 'bounded retry, no infinite loop');
});
