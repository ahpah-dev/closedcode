import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCompanion, originAllowed } from '../companion/server.mjs';
import { parseLocalSessionPayload } from '../companion/sessions.mjs';
import { trustedNodeExecutable } from '../companion/commands.mjs';

const token = 'desktop-session-test-token';
const uiOrigin = 'http://127.0.0.1:3981';
const headers = { Authorization: `Bearer ${token}`, Origin: uiOrigin, 'Content-Type': 'application/json' };
const payload = { title: 'Parser repair', agent: 'Atlas', project: '/my-project', messages: [] };
const body = (method, data, suppliedHeaders = headers) => ({ method, headers: suppliedHeaders, body: JSON.stringify(data) });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-sessions-'));
  const stateDir = path.join(directory, 'state');
  const root = path.join(directory, 'project');
  await fs.mkdir(root);
  const live = new Set();
  t.after(async () => { for (const companion of live) await companion.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const start = async () => {
    const companion = await createCompanion({ workspace: root, stateDir, token, origin: uiOrigin, strictOrigin: true });
    await new Promise((resolve) => companion.server.listen(0, '127.0.0.1', resolve));
    live.add(companion);
    const request = (route, options = {}) => fetch(`http://127.0.0.1:${companion.server.address().port}${route}`, { headers, ...options });
    return { companion, request, stop: async () => { await companion.close(); live.delete(companion); } };
  };
  return { directory, stateDir, root, start };
}

test('full desktop sessions survive companion restart and match the cloud contract', async (t) => {
  const { start } = await fixture(t);
  let runtime = await start();
  const createdResponse = await runtime.request('/api/sessions', body('POST', payload));
  assert.equal(createdResponse.status, 201);
  const { session } = await createdResponse.json();
  assert.deepEqual(Object.keys(session).sort(), ['id', 'title', 'agent', 'project', 'status', 'messages', 'createdAt', 'updatedAt'].sort());
  assert.match(session.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(session.status, 'idle');
  const messages = [{ id: 'message-one', role: 'assistant', content: '  preserved code\n', createdAt: new Date().toISOString() }];
  const patched = await runtime.request(`/api/sessions/${session.id}`, body('PATCH', { messages, status: 'complete', title: 'Parser fixed' }));
  assert.equal(patched.status, 200);
  const final = (await patched.json()).session;
  assert.equal(final.createdAt, session.createdAt);
  assert.deepEqual(final.messages, messages);
  await runtime.stop();
  runtime = await start();
  assert.deepEqual((await (await runtime.request(`/api/sessions/${session.id}`)).json()).session, final);
  assert.deepEqual((await (await runtime.request('/api/sessions')).json()).sessions, [final]);
  const deleted = await runtime.request(`/api/sessions/${session.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true });
  assert.equal((await runtime.request(`/api/sessions/${session.id}`)).status, 404);
});

test('desktop origin, token, and localhost checks precede all session operations', async (t) => {
  const { start } = await fixture(t);
  const { companion, request } = await start();
  for (const [route, method] of [['/api/sessions', 'GET'], ['/api/sessions', 'POST'], ['/api/sessions/not-owned', 'GET'], ['/api/sessions/not-owned', 'PATCH'], ['/api/sessions/not-owned', 'DELETE']]) {
    assert.equal((await request(route, { method, headers: { Origin: uiOrigin } })).status, 401);
    assert.equal((await request(route, { method, headers: { ...headers, Authorization: 'Bearer wrong-token' } })).status, 401);
    assert.equal((await request(route, { method, headers: { ...headers, Origin: 'http://localhost:3000' } })).status, 403);
  }
  assert.equal((await request('/api/health', { headers: { Origin: uiOrigin } })).status, 401);
  const rejectedHost = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${companion.server.address().port}/api/sessions`, { headers: { ...headers, Host: 'untrusted.test' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(rejectedHost, 403);
  const preflight = await request('/api/sessions', { method: 'OPTIONS', headers: { Origin: uiOrigin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH, DELETE/);
  assert.equal(originAllowed(uiOrigin, uiOrigin, true), true);
  assert.equal(originAllowed('https://closedcode-agent-workspace.vtbyx49kb2.chatgpt.site', uiOrigin, true), false);
});

test('session validation rejects invalid and oversized requests without persisting them', async (t) => {
  const { start } = await fixture(t);
  const { request } = await start();
  for (const invalid of [{ ...payload, ownerId: 'foreign' }, { ...payload, id: 'client-picked' }, { ...payload, title: '' }, { ...payload, messages: [{ role: 'tool', id: 'm', content: '', createdAt: new Date().toISOString() }] }]) {
    assert.equal((await request('/api/sessions', body('POST', invalid))).status, 400);
  }
  assert.equal((await request('/api/sessions', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await request('/api/sessions', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  const oversized = await request('/api/sessions', { method: 'POST', headers, body: JSON.stringify({ data: '€'.repeat(750_000) }) });
  assert.equal(oversized.status, 413);
  assert.deepEqual((await (await request('/api/sessions')).json()).sessions, []);
  assert.throws(() => parseLocalSessionPayload({ status: 'unknown' }, 'patch'));
  assert.throws(() => parseLocalSessionPayload({}, 'patch'));
});

test('legacy endpoint stays compatible while upgrading old records to full sessions', async (t) => {
  const { start, stateDir, root } = await fixture(t);
  await fs.mkdir(stateDir);
  await fs.writeFile(path.join(stateDir, 'local.json'), JSON.stringify({ token, workspace: root, sessions: [{ id: 'legacy-one', title: 'Older session', agent: 'Sage', mode: 'build', messages: [{ role: 'user', content: 'Original history' }], updatedAt: '2026-10-14T10:00:00.000Z' }] }));
  const { request } = await start();
  const migrated = (await (await request('/api/sessions')).json()).sessions[0];
  assert.equal(migrated.id, 'legacy-one');
  assert.equal(migrated.project, root);
  assert.equal(typeof migrated.messages[0].id, 'string');
  assert.equal(migrated.messages[0].createdAt, '2026-10-14T10:00:00.000Z');
  assert.equal((await (await request('/api/session')).json()).sessions[0].mode, 'build');
  const result = await request('/api/session', body('POST', { session: { id: 'legacy-two', mode: 'build', apiKey: 'never-store-this', messages: [{ role: 'user', content: 'Legacy write' }] } }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).session.mode, 'build');
  assert.equal((await fs.readFile(path.join(stateDir, 'local.json'), 'utf8')).includes('never-store-this'), false);
});

test('trusted desktop Node executable comes only from launch environment', () => {
  const original = process.env.CLOSED_CODE_NODE_EXECUTABLE;
  try {
    process.env.CLOSED_CODE_NODE_EXECUTABLE = '/trusted/resource/node';
    assert.equal(trustedNodeExecutable(), '/trusted/resource/node');
    delete process.env.CLOSED_CODE_NODE_EXECUTABLE;
    assert.equal(trustedNodeExecutable(), process.execPath);
  } finally {
    if (original === undefined) delete process.env.CLOSED_CODE_NODE_EXECUTABLE;
    else process.env.CLOSED_CODE_NODE_EXECUTABLE = original;
  }
});
