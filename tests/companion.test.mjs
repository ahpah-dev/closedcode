import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Workspace } from '../companion/workspace.mjs';
import { createCompanion, originAllowed } from '../companion/server.mjs';
import { executeTool, runAgent } from '../companion/agent.mjs';
const execFileAsync = promisify(execFile);

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-test-'));
  const root = path.join(directory, 'workspace');
  await fs.mkdir(root);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = new Workspace(root);
  await workspace.select(root);
  return { directory, root, workspace };
}

async function mockServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

async function readJson(req) {
  let input = '';
  for await (const chunk of req) input += chunk;
  return JSON.parse(input);
}

const answer = (res, message) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message }] }));
};

test('workspace rejects traversal, absolute paths, secrets and escaping symlinks', async (t) => {
  const { directory, root, workspace } = await fixture(t);
  await fs.writeFile(path.join(root, 'readme.md'), 'hello');
  await fs.writeFile(path.join(root, '.env'), 'API_KEY=secret');
  await fs.mkdir(path.join(directory, 'outside'));
  await fs.writeFile(path.join(directory, 'outside', 'private.txt'), 'outside');
  assert.equal(await workspace.read('readme.md'), 'hello');
  for (const input of ['../outside/private.txt', '..\\outside\\private.txt', '/etc/passwd', 'C:\\Windows\\system.ini', '.env', '.env ', '.env:$DATA', 'readme.md:stream', 'CON', '.GIT/config', 'node_modules/file.js']) {
    await assert.rejects(() => workspace.read(input));
    await assert.rejects(() => workspace.write(input, 'blocked'));
  }
  await fs.symlink(path.join(directory, 'outside'), path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => workspace.read('escape/private.txt'), /links/);
  await assert.rejects(() => workspace.write('escape/new.txt', 'blocked'), /links/);
  const { files } = await workspace.list();
  assert.deepEqual(files.map((file) => file.path), ['readme.md']);
  assert.equal(await fs.readFile(path.join(directory, 'outside', 'private.txt'), 'utf8'), 'outside');
});

test('Plan mode blocks writes; Build mode writes only inside the workspace', async (t) => {
  const { root, workspace } = await fixture(t);
  await assert.rejects(() => executeTool('write_file', { path: 'src/index.js', content: 'allowed' }, { workspace, mode: 'plan' }), /read-only/);
  const result = await executeTool('write_file', { path: 'src/index.js', content: 'allowed' }, { workspace, mode: 'build' });
  assert.equal(result.written, true);
  assert.equal(await fs.readFile(path.join(root, 'src', 'index.js'), 'utf8'), 'allowed');
});

test('git_diff reads real edits and excludes root and nested credential files', async (t) => {
  const { root, workspace } = await fixture(t);
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'visible.js'), 'before');
  await fs.writeFile(path.join(root, '.env'), 'before');
  await fs.writeFile(path.join(root, 'nested', '.env.local'), 'before');
  await execFileAsync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['add', '--', 'visible.js', '.env', 'nested/.env.local'], { cwd: root, windowsHide: true });
  await fs.writeFile(path.join(root, 'visible.js'), 'after-visible');
  await fs.writeFile(path.join(root, '.env'), 'after-secret-root');
  await fs.writeFile(path.join(root, 'nested', '.env.local'), 'after-secret-nested');
  const diff = await workspace.diff();
  assert.match(diff, /after-visible/);
  assert.equal(diff.includes('after-secret'), false);
});

test('real HTTP routing falls back immediately on 503 and persists provider choice across tool rounds', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.write('hello.txt', 'Hello ClosedCode');
  let primaryCalls = 0, fallbackCalls = 0;
  const primary = await mockServer(t, (_req, res) => { primaryCalls++; res.writeHead(503); res.end('unavailable'); });
  const fallback = await mockServer(t, async (req, res) => {
    const body = await readJson(req);
    fallbackCalls++;
    assert.equal(req.url, '/v1/chat/completions');
    if (fallbackCalls === 1) answer(res, { role: 'assistant', content: '', tool_calls: [{ id: 'call_read', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'hello.txt' }) } }] });
    else {
      const tool = body.messages.find((message) => message.role === 'tool');
      assert.equal(JSON.parse(tool.content).content, 'Hello ClosedCode');
      answer(res, { role: 'assistant', content: 'I read hello.txt: Hello ClosedCode.' });
    }
  });
  const events = [];
  const result = await runAgent({ prompt: 'Read hello.txt', mode: 'plan', routing: { primary: { baseUrl: primary, model: 'primary' }, fallbacks: [{ baseUrl: fallback, model: 'fallback' }] } }, workspace, (event) => events.push(event));
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
  assert.equal(result.model, 'fallback');
  assert.equal(events.filter((event) => event.type === 'fallback').length, 1);
  assert.equal(events.find((event) => event.type === 'tool' && event.state === 'complete').name, 'read_file');
  assert.match(result.text, /Hello ClosedCode/);
});

test('429, network and authentication failures use configured fallback; authentication is not retried', async (t) => {
  const { workspace } = await fixture(t);
  let fallbackCalls = 0;
  const fallback = await mockServer(t, (_req, res) => { fallbackCalls++; answer(res, { role: 'assistant', content: 'Fallback ready.' }); });
  const throttle = await mockServer(t, (_req, res) => { res.writeHead(429); res.end(); });
  await runAgent({ prompt: 'hi', routing: { primary: { baseUrl: throttle, model: 'x' }, fallbacks: [{ baseUrl: fallback, model: 'y' }] } }, workspace, () => {});
  await runAgent({ prompt: 'hi', routing: { primary: { baseUrl: 'http://127.0.0.1:1/v1', model: 'x' }, fallbacks: [{ baseUrl: fallback, model: 'y' }] } }, workspace, () => {});
  assert.equal(fallbackCalls, 2);
  let deniedCalls = 0;
  const denied = await mockServer(t, (_req, res) => { deniedCalls++; res.writeHead(401); res.end(); });
  await runAgent({ prompt: 'hi', routing: { primary: { baseUrl: denied, model: 'x' }, fallbacks: [{ baseUrl: fallback, model: 'y' }] } }, workspace, () => {});
  assert.equal(fallbackCalls, 3); assert.equal(deniedCalls, 1);
  await assert.rejects(() => runAgent({ prompt: 'hi', routing: { primary: { baseUrl: denied, model: 'x' }, fallbacks: [] } }, workspace, () => {}), /401.*API key/);
  assert.equal(deniedCalls, 2);
});

test('provider SSE chunks stream to clients and tool arguments survive split chunks', async (t) => {
  const { workspace } = await fixture(t);
  let calls = 0;
  const provider = await mockServer(t, async (req, res) => {
    await readJson(req);
    calls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
    if (calls === 1) {
      res.write(chunk({ tool_calls: [{ index: 0, id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"demo.' } }] }));
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: 'txt","content":"done"}' } }] }, 'tool_calls'));
    } else {
      const value = chunk({ content: 'Saved ' }) + chunk({ content: 'demo.txt.' }, 'stop');
      res.write(value.slice(0, 19));
      res.write(value.slice(19));
    }
    res.end('data: [DONE]\n\n');
  });
  const events = [];
  const result = await runAgent({ prompt: 'write demo', mode: 'build', routing: { primary: { baseUrl: provider, model: 'local' }, fallbacks: [] } }, workspace, (event) => events.push(event));
  assert.equal(await workspace.read('demo.txt'), 'done');
  assert.equal(result.text, 'Saved demo.txt.');
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['Saved ', 'demo.txt.']);
});

test('delegation performs a bounded, read-only independent provider call', async (t) => {
  const { workspace } = await fixture(t);
  let calls = 0;
  const provider = await mockServer(t, async (req, res) => {
    const body = await readJson(req);
    calls++;
    if (calls === 1) answer(res, { role: 'assistant', content: '', tool_calls: [{ id: 'delegate', type: 'function', function: { name: 'delegate', arguments: '{"task":"Review the structure","agent":"Sage"}' } }] });
    else if (calls === 2) {
      assert.equal(body.tools.some((item) => ['delegate', 'write_file', 'run_command'].includes(item.function.name)), false);
      assert.match(body.messages[0].content, /Plan mode/);
      answer(res, { role: 'assistant', content: 'Independent review complete.' });
    } else {
      assert.match(body.messages.at(-1).content, /Independent review complete/);
      answer(res, { role: 'assistant', content: 'The subagent reviewed the workspace.' });
    }
  });
  const result = await runAgent({ prompt: 'Delegate a review', mode: 'build', routing: { primary: { baseUrl: provider, model: 'local' }, fallbacks: [] } }, workspace, () => {});
  assert.equal(calls, 3);
  assert.match(result.text, /subagent reviewed/);
});

test('enabled plugin IDs control actual provider tools and disabled tools cannot execute', async (t) => {
  const { workspace } = await fixture(t);
  const sets = [];
  const provider = await mockServer(t, async (req, res) => {
    const body = await readJson(req);
    sets.push((body.tools || []).map((tool) => tool.function.name));
    answer(res, { role: 'assistant', content: 'Ready.' });
  });
  const route = { primary: { baseUrl: provider, model: 'local' }, fallbacks: [] };
  await runAgent({ prompt: 'hi', mode: 'build', plugins: ['file-context'], routing: route }, workspace, () => {});
  await runAgent({ prompt: 'hi', mode: 'build', plugins: ['code-review', 'subagents'], routing: route }, workspace, () => {});
  await runAgent({ prompt: 'hi', mode: 'build', plugins: [], routing: route }, workspace, () => {});
  await runAgent({ prompt: 'hi', mode: 'build', plugins: [{ id: 'git-context', enabled: false }, { id: 'agent-swarm', enabled: false }], routing: route }, workspace, () => {});
  assert.deepEqual(sets[0], ['list_files', 'read_file', 'write_file', 'run_command']);
  assert.deepEqual(sets[1], ['git_diff', 'delegate']);
  assert.deepEqual(sets[2], []);
  assert.deepEqual(sets[3], ['list_files', 'read_file', 'write_file', 'run_command']);
  let calls = 0;
  const malicious = await mockServer(t, async (req, res) => {
    const body = await readJson(req);
    if (++calls === 1) answer(res, { role: 'assistant', content: '', tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"blocked.txt","content":"blocked"}' } }] });
    else {
      assert.match(body.messages.at(-1).content, /disabled/);
      answer(res, { role: 'assistant', content: 'Tool disabled.' });
    }
  });
  await runAgent({ prompt: 'do it', mode: 'build', plugins: [], routing: { primary: { baseUrl: malicious, model: 'local' }, fallbacks: [] } }, workspace, () => {});
  await assert.rejects(() => workspace.read('blocked.txt'), /ENOENT/);
});

test('partial provider output is reset to completed rounds before fallback replacement', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.write('read.txt', 'Context');
  let calls = 0;
  const primary = await mockServer(t, async (req, res) => {
    await readJson(req);
    if (++calls === 1) answer(res, { role: 'assistant', content: 'Completed thought. ', tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"read.txt"}' } }] });
    else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Incomplete partial.' } }] })}\n\n`);
      setTimeout(() => res.destroy(), 20);
    }
  });
  const fallback = await mockServer(t, (_req, res) => answer(res, { role: 'assistant', content: 'Recovered answer.' }));
  const events = [];
  let displayed = '';
  const result = await runAgent({ prompt: 'read', routing: { primary: { baseUrl: primary, model: 'a' }, fallbacks: [{ baseUrl: fallback, model: 'b' }] } }, workspace, (event) => {
    events.push(event);
    if (event.type === 'delta') displayed += event.text;
    if (event.type === 'reset') displayed = event.text;
  });
  const reset = events.find((event) => event.type === 'reset');
  assert.equal(reset.text, 'Completed thought. ');
  assert.equal(events[events.indexOf(reset) + 1].type, 'fallback');
  assert.equal(displayed, 'Completed thought. \n\nRecovered answer.');
  assert.equal(result.text, displayed);
});

test('companion enforces token, CORS, localhost host and provides durable sanitized sessions', async (t) => {
  const { directory, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'readme.md'), 'hello');
  const companion = await createCompanion({ workspace: root, stateDir: path.join(directory, 'state'), token: 'test-token' });
  await new Promise((resolve) => companion.server.listen(0, '127.0.0.1', resolve));
  t.after(() => companion.close());
  const base = `http://127.0.0.1:${companion.server.address().port}`;
  assert.equal((await fetch(`${base}/api/files`)).status, 401);
  assert.equal((await fetch(`${base}/api/files`, { headers: { Authorization: 'Bearer test-token', Origin: 'https://evil.example' } })).status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${base}/api/files`, { headers: { Authorization: 'Bearer test-token', Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
  const pair = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ token: 'test-token' }) });
  assert.equal(pair.status, 200);
  assert.equal(pair.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const files = await (await fetch(`${base}/api/files`, { headers })).json();
  assert.equal(files.files[0].path, 'readme.md');
  const traversal = await fetch(`${base}/api/file?path=..%2Foutside`, { headers });
  assert.equal(traversal.status, 400);
  await fetch(`${base}/api/session`, { method: 'POST', headers, body: JSON.stringify({ session: { id: '1', title: 'Session', apiKey: 'never-store', messages: [{ role: 'user', content: 'Hello' }] } }) });
  const durable = JSON.parse(await fs.readFile(companion.statePath, 'utf8'));
  assert.equal(durable.sessions[0].messages[0].content, 'Hello');
  assert.equal(JSON.stringify(durable).includes('never-store'), false);
  assert.equal(originAllowed('http://localhost:3000'), true);
  assert.equal(originAllowed('http://localhost:7000'), false);
  assert.equal(originAllowed('https://closedcode-agent-workspace.vtbyx49kb2.chatgpt.site'), true);
});

test('protected /api/run delivers browser-consumable SSE through actual file tools and fallback', async (t) => {
  const { directory, root } = await fixture(t);
  const companion = await createCompanion({ workspace: root, stateDir: path.join(directory, 'state'), token: 'run-token' });
  await new Promise((resolve) => companion.server.listen(0, '127.0.0.1', resolve));
  t.after(() => companion.close());
  let calls = 0;
  const provider = await mockServer(t, async (req, res) => {
    const body = await readJson(req);
    calls++;
    if (calls === 1) answer(res, { role: 'assistant', content: '', tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"created.txt","content":"real file"}' } }] });
    else {
      assert.equal(JSON.parse(body.messages.at(-1).content).written, true);
      answer(res, { role: 'assistant', content: 'Created created.txt.' });
    }
  });
  const url = `http://127.0.0.1:${companion.server.address().port}/api/run`;
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer run-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Create a file', mode: 'build', routing: { primary: { baseUrl: 'http://127.0.0.1:1/v1', model: 'primary' }, fallbacks: [{ baseUrl: provider, model: 'local' }] } }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  const events = (await response.text()).split('\n\n').filter((block) => block.startsWith('event: message')).map((block) => JSON.parse(block.split('\ndata: ')[1]));
  assert.equal(events.some((event) => event.type === 'fallback'), true);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).text, 'Created created.txt.');
  assert.equal(await fs.readFile(path.join(root, 'created.txt'), 'utf8'), 'real file');
});
