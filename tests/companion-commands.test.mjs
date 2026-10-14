import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Workspace } from '../companion/workspace.mjs';
import { createCompanion } from '../companion/server.mjs';
import { runApprovedCommand, validateCommand, resolveNpmCli } from '../companion/commands.mjs';
import { executeTool } from '../companion/agent.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-command-'));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const workspace = new Workspace(directory);
  await workspace.select(directory);
  return { directory, workspace };
}

test('command validation blocks shells, executable paths and destructive git operations', async () => {
  for (const program of ['cmd', 'powershell', 'bash', '/usr/bin/node', 'node.exe']) assert.throws(() => validateCommand({ program, args: [] }));
  for (const args of [['push'], ['reset', '--hard'], ['clean', '-fd'], ['-c', 'alias.x=!whoami', 'status'], ['diff', '--output=../outside.txt']]) assert.throws(() => validateCommand({ program: 'git', args }));
  assert.throws(() => validateCommand({ program: 'node', args: 'not-an-array' }));
  assert.deepEqual(validateCommand({ program: 'npm', args: ['run', 'build'] }), { program: 'npm', args: ['run', 'build'] });
  assert.match(await resolveNpmCli('npm'), /npm-cli\.js$/);
  assert.match(await resolveNpmCli('npx'), /npx-cli\.js$/);
});

test('commands are Build-only and rejected approvals start no process', async (t) => {
  const { workspace } = await fixture(t);
  const args = { program: 'node', args: ['-e', 'require("node:fs").writeFileSync("should-not-exist.txt", "bad")'] };
  await assert.rejects(() => executeTool('run_command', args, { workspace, mode: 'plan', requestApproval: async () => true }), /Plan mode/);
  let asked = 0;
  await assert.rejects(() => runApprovedCommand(args, { workspace, requestApproval: async (command) => { asked++; assert.equal(command.workspace, workspace.root); return false; } }), /declined/);
  assert.equal(asked, 1);
  await assert.rejects(() => workspace.read('should-not-exist.txt'), /ENOENT/);
});

test('approved Node subprocess uses the selected cwd, captures output and enforces timeout', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.write('fixture.txt', 'fixture-context');
  const result = await runApprovedCommand({ program: 'node', args: ['-e', 'console.log(require("node:fs").readFileSync("fixture.txt", "utf8")); console.error("diagnostic")'] }, { workspace, requestApproval: async () => true });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /fixture-context/);
  assert.match(result.stderr, /diagnostic/);
  const timed = await runApprovedCommand({ program: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] }, { workspace, requestApproval: async () => true, timeoutMs: 100 });
  assert.equal(timed.timedOut, true);
  const capped = await runApprovedCommand({ program: 'node', args: ['-e', 'process.stdout.write("x".repeat(100000))'] }, { workspace, requestApproval: async () => true });
  assert.equal(Buffer.byteLength(capped.stdout) <= 65536, true);
  assert.equal(capped.truncated, true);
});

test('server approval endpoint pauses an actual command, requires token and rejects duplicate decisions', async (t) => {
  const { directory, workspace } = await fixture(t);
  await workspace.write('fixture.txt', 'approved-context');
  let providerCalls = 0;
  const provider = http.createServer(async (req, res) => {
    let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    providerCalls++;
    const message = !body.messages.some((item) => item.role === 'tool') ? { role: 'assistant', content: '', tool_calls: [{ id: 'command', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ program: 'node', args: ['-e', 'console.log(require("node:fs").readFileSync("fixture.txt", "utf8"))'] }) } }] } : { role: 'assistant', content: JSON.parse(body.messages.at(-1).content).stdout };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { provider.closeAllConnections(); provider.close(resolve); }));
  const companion = await createCompanion({ workspace: directory, stateDir: path.join(directory, 'state'), token: 'approval-token' });
  await new Promise((resolve) => companion.server.listen(0, '127.0.0.1', resolve));
  t.after(() => companion.close());
  const base = `http://127.0.0.1:${companion.server.address().port}`;
  const headers = { Authorization: 'Bearer approval-token', 'Content-Type': 'application/json' };
  const response = await fetch(`${base}/api/run`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'Read the fixture with node', mode: 'build', plugins: ['file-context'], routing: { primary: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'mock' }, fallbacks: [] } }) });
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = '', approval, text = '';
  while (!approval) {
    const chunk = await reader.read(); assert.equal(chunk.done, false);
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split('\n\n'); buffer = blocks.pop() || '';
    for (const block of blocks) if (block.includes('\ndata: ')) { const event = JSON.parse(block.split('\ndata: ')[1]); if (event.type === 'approval') approval = event; }
  }
  assert.equal(providerCalls, 1);
  assert.equal(approval.program, 'node');
  assert.equal(approval.workspace, workspace.root);
  assert.equal((await fetch(`${base}/api/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: approval.id, approved: true }) })).status, 401);
  assert.equal((await fetch(`${base}/api/approval`, { method: 'POST', headers, body: JSON.stringify({ id: approval.id, approved: true }) })).status, 200);
  assert.equal((await fetch(`${base}/api/approval`, { method: 'POST', headers, body: JSON.stringify({ id: approval.id, approved: true }) })).status, 404);
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); }
  assert.match(text, /approved-context/);
  assert.match(text, /"type":"done"/);
  assert.equal(providerCalls, 2);
  const cancellation = new AbortController();
  const cancelled = await fetch(`${base}/api/run`, { method: 'POST', headers, signal: cancellation.signal, body: JSON.stringify({ prompt: 'Ask again', mode: 'build', routing: { primary: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'mock' }, fallbacks: [] } }) });
  const cancelledReader = cancelled.body.getReader();
  let pending = '', cancelledApproval;
  while (!cancelledApproval) {
    const chunk = await cancelledReader.read(); pending += decoder.decode(chunk.value, { stream: true });
    const blocks = pending.split('\n\n'); pending = blocks.pop() || '';
    for (const block of blocks) if (block.includes('\ndata: ')) { const event = JSON.parse(block.split('\ndata: ')[1]); if (event.type === 'approval') cancelledApproval = event; }
  }
  cancellation.abort();
  await cancelledReader.cancel().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await fetch(`${base}/api/approval`, { method: 'POST', headers, body: JSON.stringify({ id: cancelledApproval.id, approved: true }) })).status, 404);
  assert.equal(providerCalls, 3);
});
