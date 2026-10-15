import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { OwnedStdioTransport } from './mcp-stdio.mjs';
import { resolveNpmCli, trustedNodeExecutable } from './commands.mjs';

const safeId = (id) => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
function stringMap(value = {}) {
  if (!record(value) || Object.keys(value).length > 64) throw new Error('Environment and headers must be objects with at most 64 entries.');
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key) || typeof item !== 'string' || item.includes('\0') || item.length > 8000) throw new Error('Invalid environment variable or HTTP header.');
  }
  return { ...value };
}
export function validateMcpServer(input) {
  if (!record(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('MCP server needs a name of 1–100 characters.');
  const common = { name: input.name.trim(), transport: input.transport || (input.command ? 'stdio' : 'http'), enabled: input.enabled !== false };
  if (common.transport === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.includes('\0') || input.command.length > 4096) throw new Error('Enter an MCP executable command.');
    if (/^(?:cmd|powershell|pwsh|bash|sh|zsh)(?:\.exe)?$/i.test(path.basename(input.command))) throw new Error('Use the MCP executable directly, without a shell.');
    const args = input.args || [];
    if (!Array.isArray(args) || args.length > 64 || args.some((item) => typeof item !== 'string' || item.length > 8000 || item.includes('\0')) || args.join('').length > 32000) throw new Error('MCP args must be an array of up to 64 strings.');
    return { ...common, command: input.command, args, env: stringMap(input.env) };
  }
  if (common.transport !== 'http') throw new Error('Supported MCP transports are stdio and http (Streamable HTTP).');
  const url = new URL(input.url);
  if (url.username || url.password || url.hash || url.search || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('MCP HTTP needs HTTPS, or HTTP on localhost, without URL credentials, queries or fragments.');
  const headers = stringMap(input.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (/^(?:host|cookie|connection|content-length|mcp-session-id|mcp-protocol-version)$/i.test(key) || /[\r\n]/.test(value)) throw new Error('Unsupported MCP HTTP header.');
  }
  return { ...common, url: url.href, headers };
}

export class McpManager {
  constructor(stateDir, getWorkspace) {
    this.file = path.join(stateDir, 'mcp.json');
    this.getWorkspace = getWorkspace;
    this.configs = new Map(); this.connections = new Map(); this.connecting = new Map();
    this.errors = new Map(); this.closed = false; this.persistence = Promise.resolve();
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const server of (Array.isArray(saved.servers) ? saved.servers : []).slice(0, 10)) {
        if (safeId(server.id)) this.configs.set(server.id, { ...validateMcpServer(server), id: server.id });
      }
    } catch (error) { if (error.code !== 'ENOENT') this.errors.set('configuration', 'Saved MCP configuration is invalid. Re-add the affected server.'); }
  }
  persist() {
    const snapshot = JSON.stringify({ servers: [...this.configs.values()] }, null, 2);
    this.persistence = this.persistence.catch(() => {}).then(async () => {
      await fs.writeFile(`${this.file}.tmp`, snapshot, { mode: 0o600 });
      await fs.rename(`${this.file}.tmp`, this.file);
    });
    return this.persistence;
  }
  list() {
    return [...this.configs.values()].map(({ env, headers, ...server }) => ({
      ...server, envKeys: Object.keys(env || {}), headerNames: Object.keys(headers || {}),
      status: this.connecting.has(server.id) ? 'connecting' : this.connections.has(server.id) ? 'connected' : 'disconnected',
      tools: (this.connections.get(server.id)?.tools || []).map((tool) => ({ name: tool.name, description: String(tool.description || '').slice(0, 500) })),
      ...(this.errors.has(server.id) ? { error: this.errors.get(server.id) } : {}),
    }));
  }
  async add(input) {
    if (this.closed) throw new Error('MCP manager is shutting down.');
    if (this.configs.size >= 10) throw new Error('At most ten MCP servers can be configured.');
    const server = { ...validateMcpServer(input), id: randomBytes(8).toString('hex') };
    this.configs.set(server.id, server);
    try { await this.persist(); } catch (error) { this.configs.delete(server.id); throw error; }
    return this.list().find((item) => item.id === server.id);
  }
  async remove(id) {
    if (!this.configs.has(id)) throw new Error('MCP server not found.');
    await this.disconnect(id); this.configs.delete(id); this.errors.delete(id); await this.persist();
  }
  async setEnabled(id, enabled) {
    const server = this.configs.get(id);
    if (!server || typeof enabled !== 'boolean') throw new Error('Select a server and boolean enabled value.');
    if (!enabled) await this.disconnect(id);
    server.enabled = enabled; await this.persist();
  }
  connect(id) {
    if (this.connecting.has(id)) return this.connecting.get(id);
    if (this.connections.has(id)) return Promise.resolve();
    const task = this.open(id).finally(() => this.connecting.delete(id));
    this.connecting.set(id, task); return task;
  }
  async open(id) {
    const server = this.configs.get(id);
    if (this.closed || !server || !server.enabled) throw new Error('MCP server is unavailable or disabled.');
    const client = new Client({ name: 'ClosedCode', version: '0.4.1' }, { capabilities: {} });
    let transport;
    try {
      if (server.transport === 'stdio') {
        let command = server.command, args = server.args;
        if (command === 'node') command = trustedNodeExecutable();
        if (command === 'npm' || command === 'npx') { args = [await resolveNpmCli(command), ...args]; command = trustedNodeExecutable(); }
        // Do not pass the pairing token, provider keys or Electron runtime flags.
        const env = { ...getDefaultEnvironment(), ...server.env };
        env.PATH = `${path.dirname(trustedNodeExecutable())}${path.delimiter}${env.PATH || env.Path || ''}`;
        transport = new OwnedStdioTransport({ command, args, env, cwd: this.getWorkspace() });
      } else {
        transport = new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: server.headers, redirect: 'error' },
          reconnectionOptions: { maxRetries: 2 }, onInsufficientScope: 'throw',
        });
      }
      await client.connect(transport, { timeout: 15000 });
      const tools = []; let cursor;
      for (let page = 0; page < 4; page++) {
        const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 10000 });
        for (const tool of result.tools || []) {
          if (tools.length >= 80) break;
          if (typeof tool.name === 'string' && tool.name.length <= 200 && record(tool.inputSchema) && tool.inputSchema.type === 'object' && JSON.stringify(tool.inputSchema).length <= 32000 && !tools.some((item) => item.name === tool.name)) tools.push(tool);
        }
        cursor = result.nextCursor;
        if (!cursor || tools.length >= 80) break;
      }
      if (this.closed || !this.configs.get(id)?.enabled) throw new Error('MCP connection was cancelled.');
      const connection = { client, transport, tools };
      this.connections.set(id, connection); this.errors.delete(id);
      client.onclose = () => { if (this.connections.get(id) === connection) { this.connections.delete(id); this.errors.set(id, 'Connection closed. Reconnect the server in Plugins.'); } };
      client.onerror = () => {}; // protocol diagnostics are surfaced as safe call errors
    } catch {
      await client.close().catch(() => {}); await transport?.close().catch(() => {});
      const message = 'MCP connection failed. Check the executable or URL, credentials and protocol compatibility, then reconnect.';
      this.errors.set(id, message); throw new Error(message);
    }
  }
  async disconnect(id) {
    await this.connecting.get(id)?.catch(() => {});
    const connection = this.connections.get(id); this.connections.delete(id);
    await connection?.client.close().catch(() => {});
  }
  bindings() {
    const result = new Map();
    for (const [id, connection] of this.connections) {
      const server = this.configs.get(id);
      if (!server?.enabled) continue;
      for (const tool of connection.tools) {
        if (result.size >= 80) return result;
        const name = `mcp_${id}_${createHash('sha256').update(tool.name).digest('hex').slice(0, 16)}`;
        result.set(name, { serverId: id, serverName: server.name, toolName: tool.name,
          definition: { type: 'function', function: { name, description: `MCP ${server.name}: ${tool.name}. ${String(tool.description || '').slice(0, 1500)} External tool; requires your approval.`, parameters: tool.inputSchema } } });
      }
    }
    return result;
  }
  async call(binding, args, { signal, requestApproval }) {
    const connection = this.connections.get(binding.serverId);
    if (!connection || !this.configs.get(binding.serverId)?.enabled) throw new Error('MCP server disconnected or disabled. Reconnect in Plugins.');
    if (!requestApproval) throw new Error('MCP tools require approval in this session.');
    if (signal?.aborted) throw new Error('Run cancelled.');
    const approved = await requestApproval({ kind: 'mcp', server: binding.serverName, tool: binding.toolName, args, workspace: this.getWorkspace() });
    if (!approved) throw new Error('MCP tool declined. No external tool was called.');
    if (signal?.aborted) throw new Error('Run cancelled.');
    if (this.connections.get(binding.serverId) !== connection) throw new Error('MCP connection changed while awaiting approval. Request the tool again.');
    try {
      // Never automatically replay an external tool: a lost reply may follow a
      // successful mutation. HTTP stream reconnects do not resubmit this call.
      const output = await connection.client.callTool({ name: binding.toolName, arguments: args }, { signal, timeout: 60000 });
      const content = (output.content || []).filter((item) => item.type === 'text').map((item) => ({ type: 'text', text: String(item.text).slice(0, 64000) })).slice(0, 8);
      const structured = output.structuredContent ? JSON.stringify(output.structuredContent) : '';
      return { isError: output.isError === true, content, ...(structured && structured.length <= 256000 ? { structuredContent: output.structuredContent } : structured ? { truncated: true } : {}) };
    } catch {
      if (signal?.aborted) throw new Error('Run cancelled.');
      throw new Error('MCP tool failed or its reply was lost. It was not retried; inspect the external service before trying again.');
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.connecting.values()]);
    await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id)));
    await this.persistence.catch(() => {});
  }
}
