import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ChangeTracker } from '../companion/change-tracker.mjs';
import { Workspace } from '../companion/workspace.mjs';
import { createCompanion } from '../companion/server.mjs';
import { executeTool } from '../companion/agent.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-changes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'workspace'), state = path.join(directory, 'state');
  await fs.mkdir(root); await fs.mkdir(state);
  const workspace = new Workspace(root); await workspace.select(root);
  const tracker = new ChangeTracker(state); await tracker.load();
  return { directory, root, state, workspace, tracker };
}

async function write(run, workspace, file, content) {
  return executeTool('write_file', { path: file, content }, { workspace, mode: 'build', changes: run });
}

test('review captures only actual run writes, first before and latest after, and persists across restarts', async (t) => {
  const { root, state, workspace, tracker } = await fixture(t);
  await fs.writeFile(path.join(root, 'existing.txt'), '\uFEFFUser edits before this run\r\n');
  await fs.writeFile(path.join(root, 'read-only.txt'), 'Keep this unrelated file');
  const events = [], run = await tracker.begin(workspace, (event) => events.push(event));
  await executeTool('read_file', { path: 'read-only.txt' }, { workspace, mode: 'build', changes: run });
  await write(run, workspace, 'existing.txt', 'First agent version');
  await write(run, workspace, 'existing.txt', 'Final agent version');
  await write(run, workspace, 'src/new.txt', 'Created by the agent');
  assert.equal((await write(run, workspace, 'src/new.txt', 'Created by the agent')).unchanged, true);
  await run.finish();
  const review = tracker.get(run.id, workspace);
  assert.equal(review.status, 'pending'); assert.equal(review.changeCount, 2);
  assert.deepEqual(review.files.map((file) => [file.path, file.kind, file.before, file.after]), [
    ['existing.txt', 'modified', '\uFEFFUser edits before this run\r\n', 'Final agent version'],
    ['src/new.txt', 'created', null, 'Created by the agent'],
  ]);
  assert.equal(events.at(-1).status, 'pending'); assert.equal(events.at(-1).runId, run.id);
  assert.ok(review.createdAt); assert.ok(review.updatedAt);
  const restored = new ChangeTracker(state); await restored.load();
  assert.deepEqual(restored.get(run.id, workspace), review);
  await restored.undo(run.id, workspace);
  assert.equal(await workspace.read('existing.txt'), '\uFEFFUser edits before this run\r\n');
  await assert.rejects(() => fs.access(path.join(root, 'src/new.txt')), { code: 'ENOENT' });
  assert.equal(await workspace.read('read-only.txt'), 'Keep this unrelated file');
  assert.equal(restored.get(run.id, workspace).status, 'undone');
  assert.equal((await restored.undo(run.id, workspace)).status, 'undone');
});

test('Undo preflights every file and preserves external edits, deletions and later run writes', async (t) => {
  const { root, workspace, tracker } = await fixture(t);
  await fs.writeFile(path.join(root, 'original.txt'), 'Before');
  const run = await tracker.begin(workspace);
  await write(run, workspace, 'original.txt', 'Agent edit'); await write(run, workspace, 'new.txt', 'Agent created'); await run.finish();
  await fs.writeFile(path.join(root, 'new.txt'), 'External editor change');
  await assert.rejects(() => tracker.undo(run.id, workspace), (error) => error.status === 409 && error.conflicts.includes('new.txt'));
  assert.equal(await workspace.read('original.txt'), 'Agent edit'); assert.equal(await workspace.read('new.txt'), 'External editor change');
  await fs.rm(path.join(root, 'new.txt'));
  await assert.rejects(() => tracker.undo(run.id, workspace), /changed after/);
  const next = await tracker.begin(workspace); await write(next, workspace, 'original.txt', 'Newer run'); await next.finish();
  await assert.rejects(() => tracker.undo(run.id, workspace), (error) => error.conflicts.includes('original.txt'));
  assert.equal(await workspace.read('original.txt'), 'Newer run');
  assert.equal((await tracker.keep(next.id, workspace)).status, 'kept');
  assert.equal((await tracker.undo(next.id, workspace)).status, 'undone');
  assert.equal(await workspace.read('original.txt'), 'Agent edit');
});

test('writes detect external edits between tool calls and failed writes do not become changes', async (t) => {
  const { root, workspace, tracker } = await fixture(t);
  const run = await tracker.begin(workspace); await write(run, workspace, 'app.txt', 'First');
  await fs.writeFile(path.join(root, 'app.txt'), 'External change');
  await assert.rejects(() => write(run, workspace, 'app.txt', 'Second'), /outside this run/);
  assert.equal(await workspace.read('app.txt'), 'External change');
  const originalWrite = workspace.write;
  workspace.write = async () => { throw new Error('Fixture disk failure'); };
  await assert.rejects(() => write(run, workspace, 'failed.txt', 'Never written'), /disk failure/);
  workspace.write = originalWrite;
  await run.finish('error');
  assert.deepEqual(tracker.get(run.id, workspace).files.map((file) => file.path), ['app.txt']);
  assert.equal(tracker.get(run.id, workspace).outcome, 'error');
});

test('review preserves workspace traversal, credentials, binary and symlink guards and bounded snapshots', async (t) => {
  const { directory, root, workspace, tracker } = await fixture(t);
  const run = await tracker.begin(workspace);
  for (const file of ['../outside.txt', '.env', 'nested/credentials.json', '.closedcode/local.json', 'file.txt:stream']) await assert.rejects(() => write(run, workspace, file, 'Blocked'));
  await assert.rejects(() => write(run, workspace, 'huge.txt', 'x'.repeat(512 * 1024 + 1)), /512 KB/);
  await assert.rejects(() => write(run, workspace, 'binary.txt', 'x\0y'), /UTF-8/);
  await fs.writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
  await assert.rejects(() => write(run, workspace, 'invalid.txt', 'Replacement'), /invalid UTF-8/);
  const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => write(run, workspace, 'link/file.txt', 'Blocked'), /links/);
  assert.equal(tracker.get(run.id, workspace).changeCount, 0);
  await run.finish();
});

test('review is bound to its original workspace and same-content external replacements still conflict', async (t) => {
  const { directory, root, workspace, tracker } = await fixture(t);
  const run = await tracker.begin(workspace); await write(run, workspace, 'same.txt', 'Agent version'); await run.finish();
  const otherRoot = path.join(directory, 'other'); await fs.mkdir(otherRoot);
  const other = new Workspace(otherRoot); await other.select(otherRoot);
  assert.equal(tracker.list(other).length, 0);
  assert.throws(() => tracker.get(run.id, other), (error) => error.status === 404);
  await assert.rejects(() => tracker.undo(run.id, other), (error) => error.status === 404);
  await fs.writeFile(path.join(root, 'replacement.txt'), 'Agent version');
  await fs.rename(path.join(root, 'replacement.txt'), path.join(root, 'same.txt'));
  await assert.rejects(() => tracker.undo(run.id, workspace), /changed after/);
  assert.equal(await workspace.read('same.txt'), 'Agent version');
});

test('Undo rejects externally substituted symlinks before modifying any file in the run', async (t) => {
  const { directory, root, workspace, tracker } = await fixture(t);
  const run = await tracker.begin(workspace);
  await write(run, workspace, 'untouched.txt', 'Keep this agent change');
  await write(run, workspace, 'replaced.txt', 'Original agent file'); await run.finish();
  const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'external.txt'), 'External data must remain untouched');
  await fs.rm(path.join(root, 'replaced.txt'));
  // Directory junctions are supported without elevated privileges on Windows.
  await fs.symlink(outside, path.join(root, 'replaced.txt'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => tracker.undo(run.id, workspace), (error) => error.status === 409 && error.conflicts.includes('replaced.txt'));
  assert.equal(await workspace.read('untouched.txt'), 'Keep this agent change');
  assert.equal(await fs.readFile(path.join(outside, 'external.txt'), 'utf8'), 'External data must remain untouched');
});

test('returning a file to its original contents leaves no pending changes, and run file counts stay bounded', async (t) => {
  const { root, workspace, tracker } = await fixture(t);
  await fs.writeFile(path.join(root, 'reverted.txt'), 'Original text');
  const reverted = await tracker.begin(workspace);
  await write(reverted, workspace, 'reverted.txt', 'Temporary edit');
  await write(reverted, workspace, 'reverted.txt', 'Original text'); await reverted.finish();
  assert.equal(tracker.get(reverted.id, workspace).changeCount, 0);
  assert.equal(tracker.get(reverted.id, workspace).status, 'kept');
  const bounded = await tracker.begin(workspace);
  for (let index = 0; index < 24; index++) await write(bounded, workspace, `file-${index}.txt`, 'Tracked');
  await assert.rejects(() => write(bounded, workspace, 'file-25.txt', 'Blocked'), /at most 24 files/);
  await assert.rejects(() => fs.access(path.join(root, 'file-25.txt')), { code: 'ENOENT' });
  assert.equal(tracker.get(bounded.id, workspace).changeCount, 24); await bounded.finish();
});

test('history recovers interrupted runs safely and is bounded to 20 records', async (t) => {
  const { state, workspace, tracker } = await fixture(t);
  const interrupted = await tracker.begin(workspace); await write(interrupted, workspace, 'interrupted.txt', 'Applied before restart');
  const restored = new ChangeTracker(state); await restored.load();
  assert.equal(restored.get(interrupted.id, workspace).status, 'pending');
  assert.equal(restored.get(interrupted.id, workspace).outcome, 'interrupted');
  await restored.undo(interrupted.id, workspace);
  for (let index = 0; index < 22; index++) { const run = await restored.begin(workspace); await run.finish(); }
  assert.equal(restored.list(workspace).length, 20);
  assert.throws(() => restored.get(interrupted.id, workspace), (error) => error.status === 404);
});

test('failed review commits preserve truthful status and Undo can finish safely on retry', async (t) => {
  const { root, state, workspace, tracker } = await fixture(t);
  await fs.writeFile(path.join(root, 'app.txt'), 'Before this run');
  const run = await tracker.begin(workspace); await write(run, workspace, 'app.txt', 'Agent edit'); await run.finish();
  const persist = tracker.persist.bind(tracker);
  tracker.persist = async () => { throw new Error('Fixture history disk failure'); };
  await assert.rejects(() => tracker.keep(run.id, workspace), /disk failure/);
  assert.equal(tracker.get(run.id, workspace).status, 'pending');
  await assert.rejects(() => tracker.undo(run.id, workspace), /disk failure/);
  assert.equal(await workspace.read('app.txt'), 'Agent edit');
  assert.equal(tracker.get(run.id, workspace).status, 'pending');
  let commits = 0;
  tracker.persist = async () => { if (++commits === 3) throw new Error('Fixture final commit failure'); return persist(); };
  await assert.rejects(() => tracker.undo(run.id, workspace), /final commit failure/);
  assert.equal(await workspace.read('app.txt'), 'Before this run');
  assert.equal(tracker.get(run.id, workspace).status, 'pending');
  assert.equal(tracker.get(run.id, workspace).files[0].undone, true);
  tracker.persist = persist;
  assert.equal((await tracker.undo(run.id, workspace)).status, 'undone');
  const restored = new ChangeTracker(state); await restored.load();
  assert.equal(restored.get(run.id, workspace).status, 'undone');
  tracker.persist = async () => { throw new Error('Fixture begin failure'); };
  const previousCount = tracker.list(workspace).length;
  await assert.rejects(() => tracker.begin(workspace), /begin failure/);
  assert.equal(tracker.list(workspace).length, previousCount);
});

async function startEngine(t, setup, providerHandler) {
  const provider = http.createServer(providerHandler);
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { provider.closeAllConnections(); provider.close(resolve); }));
  const engine = await createCompanion({ workspace: setup.root, stateDir: setup.state, token: 'review-fixture-token', strictOrigin: true, origin: 'http://127.0.0.1:5484', providerTimeoutMs: 3000 });
  await new Promise((resolve) => engine.server.listen(0, '127.0.0.1', resolve)); t.after(() => engine.close());
  return { engine, base: `http://127.0.0.1:${engine.server.address().port}`, model: `http://127.0.0.1:${provider.address().port}/v1` };
}
const headers = { Authorization: 'Bearer review-fixture-token', 'Content-Type': 'application/json' };
const reply = (res, message) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }] })); };
const writeCall = { role: 'assistant', content: '', tool_calls: [{ id: 'write-fixture', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'app.txt', content: 'Actual run output' }) } }] };
const eventsFrom = (text) => text.split('\n\n').flatMap((frame) => frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6))));

test('real run API emits a review ID, protects active mutations, and Keep/Undo restore actual files', async (t) => {
  const setup = await fixture(t); await fs.writeFile(path.join(setup.root, 'app.txt'), 'Existing user changes');
  let release, secondRequest; const waiting = new Promise((resolve) => { release = resolve; }); const reached = new Promise((resolve) => { secondRequest = resolve; });
  let calls = 0;
  const { base, model } = await startEngine(t, setup, async (_req, res) => {
    if (++calls === 1) reply(res, writeCall);
    else { secondRequest(); await waiting; reply(res, { role: 'assistant', content: 'Saved app.txt.' }); }
  });
  const response = await fetch(base + '/api/run', { method: 'POST', headers, body: JSON.stringify({ prompt: 'Update app', mode: 'build', plugins: ['file-context'], routing: { primary: { baseUrl: model, model: 'fixture' }, fallbacks: [] } }) });
  const stream = response.text(); await reached;
  const running = (await (await fetch(base + '/api/changes', { headers })).json()).runs[0];
  assert.equal(running.changeCount, 1); assert.equal(running.status, 'running');
  assert.equal((await fetch(base + `/api/changes/${running.id}/undo`, { method: 'POST', headers, body: '{}' })).status, 409);
  release(); const events = eventsFrom(await stream), final = events.find((event) => event.type === 'done');
  assert.equal(final.runId, running.id); assert.equal(final.changeCount, 1);
  assert.ok(events.find((event) => event.type === 'run' && event.runId === running.id));
  assert.equal(events.at(-2).type, 'changes'); assert.equal(events.at(-2).status, 'pending');
  const endpoint = base + `/api/changes/${running.id}`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(endpoint + '/undo', { method: 'POST', headers: { Authorization: headers.Authorization }, body: '{}' })).status, 415);
  assert.equal((await fetch(endpoint + '/undo', { method: 'POST', headers, body: JSON.stringify({ path: '../outside.txt' }) })).status, 400);
  const detail = (await (await fetch(endpoint, { headers })).json()).run;
  assert.equal(detail.files[0].before, 'Existing user changes'); assert.equal(detail.files[0].after, 'Actual run output');
  assert.equal((await (await fetch(endpoint + '/keep', { method: 'POST', headers, body: '{}' })).json()).run.status, 'kept');
  assert.equal((await (await fetch(endpoint + '/undo', { method: 'POST', headers, body: '{}' })).json()).run.status, 'undone');
  assert.equal(await setup.workspace.read('app.txt'), 'Existing user changes');
  const otherRoot = path.join(setup.directory, 'other'); await fs.mkdir(otherRoot);
  assert.equal((await fetch(base + '/api/workspace', { method: 'POST', headers, body: JSON.stringify({ path: otherRoot }) })).status, 200);
  assert.equal((await fetch(endpoint, { headers })).status, 404);
  assert.equal((await fetch(endpoint + '/undo', { method: 'POST', headers, body: '{}' })).status, 404);
});

test('failed runs still publish their pending review before error and Undo preserves later external edits', async (t) => {
  const setup = await fixture(t); let calls = 0;
  const { base, model } = await startEngine(t, setup, (_req, res) => {
    if (++calls === 1) reply(res, writeCall); else { res.writeHead(401); res.end(); }
  });
  const response = await fetch(base + '/api/run', { method: 'POST', headers, body: JSON.stringify({ prompt: 'Update app', mode: 'build', plugins: ['file-context'], routing: { primary: { baseUrl: model, model: 'fixture' }, fallbacks: [] } }) });
  const events = eventsFrom(await response.text()), error = events.at(-1);
  assert.equal(error.type, 'error'); assert.equal(error.changeCount, 1); assert.equal(events.at(-2).type, 'changes');
  assert.equal(events.at(-2).status, 'pending'); assert.equal(events.at(-2).outcome, 'error');
  await fs.writeFile(path.join(setup.root, 'app.txt'), 'Edited after the run');
  const undo = await fetch(base + `/api/changes/${error.runId}/undo`, { method: 'POST', headers, body: '{}' });
  assert.equal(undo.status, 409); assert.deepEqual((await undo.json()).conflicts, ['app.txt']);
  assert.equal(await setup.workspace.read('app.txt'), 'Edited after the run');
});

test('disconnecting after a real write persists cancelled review before companion shutdown resolves', async (t) => {
  const setup = await fixture(t); let calls = 0, secondRequest;
  const reached = new Promise((resolve) => { secondRequest = resolve; });
  const { engine, base, model } = await startEngine(t, setup, (_req, res) => {
    if (++calls === 1) reply(res, writeCall);
    else secondRequest(); // Leave inference open until the client disconnects.
  });
  const controller = new AbortController();
  const response = await fetch(base + '/api/run', { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ prompt: 'Update app', mode: 'build', plugins: ['file-context'], routing: { primary: { baseUrl: model, model: 'fixture' }, fallbacks: [] } }) });
  const stream = response.text(); await reached;
  const running = (await (await fetch(base + '/api/changes', { headers })).json()).runs[0];
  assert.equal(running.changeCount, 1);
  controller.abort(); await assert.rejects(() => stream, /abort/i);
  await engine.close();
  const restored = new ChangeTracker(setup.state); await restored.load();
  const review = restored.get(running.id, setup.workspace);
  assert.equal(review.status, 'pending'); assert.equal(review.outcome, 'cancelled'); assert.equal(review.changeCount, 1);
  assert.equal(review.files[0].after, 'Actual run output');
  await restored.undo(running.id, setup.workspace);
  await assert.rejects(() => fs.access(path.join(setup.root, 'app.txt')), { code: 'ENOENT' });
});
