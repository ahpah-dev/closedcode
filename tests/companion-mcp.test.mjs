import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { McpManager, validateMcpServer } from '../companion/mcp.mjs';
import { createCompanion } from '../companion/server.mjs';
import { runAgent } from '../companion/agent.mjs';
import { Workspace } from '../companion/workspace.mjs';

const fixture = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
async function manager(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-mcp-'));
  const mcp = new McpManager(root, () => root); await mcp.load();
  t.after(async () => { await mcp.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, mcp };
}
test('MCP validation rejects shells, insecure remote HTTP, URL credentials and header injection', () => {
  for (const command of ['cmd.exe', 'powershell', 'bash']) assert.throws(() => validateMcpServer({ name: 'x', command }), /shell/);
  for (const url of ['http://remote.example/mcp', 'https://user:password@remote.example/mcp']) assert.throws(() => validateMcpServer({ name: 'x', url }), /HTTPS/);
  assert.throws(() => validateMcpServer({ name: 'x', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x\r\nx: y' } }), /header/);
});
test('stdio connects, discovers tools, gates calls on exact approval, hides credentials and disconnects', async (t) => {
  const { root, mcp } = await manager(t);
  const previous = process.env.CLOSED_CODE_TOKEN; process.env.CLOSED_CODE_TOKEN = 'parent-secret';
  t.after(() => { if (previous === undefined) delete process.env.CLOSED_CODE_TOKEN; else process.env.CLOSED_CODE_TOKEN = previous; });
  const server = await mcp.add({ name: 'Fixture', command: 'node', args: [fixture], env: { FIXTURE_SECRET: 'private-secret' } });
  assert.equal(mcp.connections.size, 0, 'saving must not start a process');
  assert.equal(JSON.stringify(mcp.list()).includes('private-secret'), false);
  await mcp.connect(server.id); assert.equal(mcp.list()[0].tools[0].name, 'inspect');
  const binding = [...mcp.bindings().values()][0];
  await assert.rejects(() => mcp.call(binding, { text: 'no' }, { requestApproval: async () => false }), /declined/);
  let approval;
  const result = await mcp.call(binding, { text: 'approved' }, { requestApproval: async (value) => { approval = value; return true; } });
  assert.deepEqual(approval.args, { text: 'approved' }); assert.equal(approval.kind, 'mcp');
  assert.deepEqual(JSON.parse(result.content[0].text), { text: 'approved', calls: 1, parentSecretInherited: false });
  const pid = mcp.connections.get(server.id).transport.pid;
  await mcp.disconnect(server.id); assert.equal(mcp.bindings().size, 0);
  assert.throws(() => process.kill(pid, 0));
  const restored = new McpManager(root, () => root); await restored.load(); assert.equal(restored.list().length, 1); assert.equal(restored.connections.size, 0); await restored.close();
});
test('Streamable HTTP handshake and tool calls use configured auth, without replaying calls', async (t) => {
  const { mcp } = await manager(t); let calls = 0;
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer http-private');
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (input.id === undefined) { res.writeHead(202); return res.end(); }
    const result = input.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } }
      : input.method === 'tools/list' ? { tools: [{ name: 'check', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: String(++calls) }] };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const config = await mcp.add({ name: 'HTTP', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: 'Bearer http-private' } });
  await mcp.connect(config.id);
  const result = await mcp.call([...mcp.bindings().values()][0], {}, { requestApproval: async () => true });
  assert.equal(result.content[0].text, '1'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(mcp.list()).includes('http-private'), false);
  await mcp.setEnabled(config.id, false); assert.equal(mcp.bindings().size, 0);
});
test('MCP management requires pairing; agent tools require Build mode and enabled plugin', async (t) => {
  const { root, mcp } = await manager(t);
  const engine = await createCompanion({ workspace: root, stateDir: path.join(root, 'engine'), token: 'test-token' });
  await new Promise((resolve) => engine.server.listen(0, '127.0.0.1', resolve)); t.after(() => engine.close());
  const base = `http://127.0.0.1:${engine.server.address().port}`;
  assert.equal((await fetch(`${base}/api/mcp/servers`)).status, 401);
  assert.equal((await fetch(`${base}/api/mcp/servers`, { headers: { Authorization: 'Bearer test-token' } })).status, 200);
  const config = await mcp.add({ name: 'Fixture', command: 'node', args: [fixture] }); await mcp.connect(config.id);
  const workspace = new Workspace(root); await workspace.select(root);
  for (const [mode, plugins, expected] of [['plan', ['mcp'], false], ['build', [], false], ['build', ['mcp'], true]]) {
    await runAgent({ prompt: 'Hello', mode, plugins, routing: { primary: { baseUrl: 'https://fixture.example/v1', model: 'fixture' }, fallbacks: [] } }, workspace, () => {}, {
      mcp, fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body); assert.equal((body.tools || []).some((tool) => tool.function.name.startsWith('mcp_')), expected);
        return Response.json({ choices: [{ message: { role: 'assistant', content: 'Done' } }] });
      },
    });
  }
});
