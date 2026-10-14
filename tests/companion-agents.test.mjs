import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentStore } from '../companion/agents.mjs';
import { validateAgentProfile } from '../lib/agent-profiles.mjs';
import { createCompanion } from '../companion/server.mjs';
import { runAgent } from '../companion/agent.mjs';
import { Workspace } from '../companion/workspace.mjs';

const profile = (changes = {}) => ({ id: `custom_${randomUUID()}`, name: 'Lyra', role: 'Test engineer', color: 'violet', personality: 'Patient, methodical and encouraging.', description: 'Find the tests that matter.', guidance: 'Identify edge cases and verify actual behavior. Explain results clearly.', updatedAt: new Date().toISOString(), ...changes });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-agents-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('custom profiles validate bounds, identifiers and reserved built-in names', () => {
  assert.equal(validateAgentProfile(profile({ name: ' Lyra ' })).name, 'Lyra');
  for (const changes of [{ id: 'atlas' }, { name: 'Nova' }, { name: '' }, { guidance: '' }, { guidance: 'x'.repeat(8001) }, { color: 'injected' }]) assert.throws(() => validateAgentProfile(profile(changes)));
});
test('custom profiles survive restart, update atomically, reject collisions and delete without changing sessions', async (t) => {
  const root = await fixture(t), store = new AgentStore(root); await store.load(); const original = profile();
  await store.save(original); const restored = new AgentStore(root); await restored.load(); assert.deepEqual(restored.list(), [original]);
  await restored.save({ ...original, guidance: 'New saved instructions' }, true);
  assert.equal(restored.list()[0].guidance, 'New saved instructions');
  await assert.rejects(() => restored.save(profile({ name: 'lyra' })), /name/);
  await assert.rejects(() => restored.save(original), /already exists/);
  await fs.writeFile(path.join(root, 'sessions.json'), 'preserved');
  await restored.remove(original.id); assert.equal(restored.list().length, 0); assert.equal(await fs.readFile(path.join(root, 'sessions.json'), 'utf8'), 'preserved');
});
test('custom profile API enforces token, origin, JSON and immutable IDs', async (t) => {
  const root = await fixture(t), engine = await createCompanion({ workspace: root, stateDir: path.join(root, 'state'), token: 'fixture-token', origin: 'http://127.0.0.1:5484', strictOrigin: true });
  await new Promise((resolve) => engine.server.listen(0, '127.0.0.1', resolve)); t.after(() => engine.close());
  const url = `http://127.0.0.1:${engine.server.address().port}/api/agents`, headers = { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
  const saved = profile();
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer fixture-token' }, body: JSON.stringify(saved) })).status, 415);
  const created = await fetch(url, { method: 'POST', headers, body: JSON.stringify(saved) }); assert.equal(created.status, 201); assert.equal((await created.json()).agents[0].name, 'Lyra');
  assert.equal((await fetch(url + '/' + saved.id, { method: 'PATCH', headers, body: JSON.stringify({ ...saved, id: `custom_${randomUUID()}` }) })).status, 400);
  const updated = await fetch(url + '/' + saved.id, { method: 'PATCH', headers, body: JSON.stringify({ ...saved, name: 'Lyra revised' }) }); assert.equal(updated.status, 200);
  assert.equal((await (await fetch(url, { headers })).json()).agents[0].name, 'Lyra revised');
  assert.equal((await fetch(url + '/' + saved.id, { method: 'DELETE', headers })).status, 200);
});
test('saved custom personality and instructions reach provider requests while Plan mode prevents mutations', async (t) => {
  const root = await fixture(t), workspace = new Workspace(root); await workspace.select(root); const saved = profile(); let calls = 0;
  await runAgent({ prompt: 'Review this project', agent: saved.id, mode: 'plan', routing: { primary: { baseUrl: 'https://fixture.example/v1', model: 'fixture' }, fallbacks: [] } }, workspace, () => {}, {
    agentProfiles: [saved], fetchImpl: async (_url, options) => {
      calls++; const body = JSON.parse(options.body); const system = body.messages[0].content;
      assert.match(system, /You are Lyra/); assert.ok(system.includes(saved.personality)); assert.ok(system.includes(saved.guidance)); assert.match(system, /Plan mode/);
      assert.equal(body.tools.some((tool) => ['write_file', 'run_command'].includes(tool.function.name)), false);
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'Review complete.' } }] });
    },
  }); assert.equal(calls, 1);
  await assert.rejects(() => runAgent({ prompt: 'Hi', agent: saved.id }, workspace, () => {}, { agentProfiles: [] }), /unavailable/);
});
