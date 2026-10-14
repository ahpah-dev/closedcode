import { spawn } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/client';
import { stopOwnedProcessTree } from './processes.mjs';

// SDK-compatible transport with an owned process group. Closing must also stop
// helpers spawned by npm/npx instead of leaving a server running in the background.
export class OwnedStdioTransport {
  constructor(parameters) { this.parameters = parameters; this.buffer = new ReadBuffer({ maxBufferSize: 2 * 1024 * 1024 }); }
  get pid() { return this.child?.pid || null; }
  async start() {
    if (this.child) throw new Error('MCP process already started.');
    const { command, args, env, cwd } = this.parameters;
    const child = this.child = spawn(command, args, { env, cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      try {
        this.buffer.append(chunk); let message;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch { this.onerror?.(new Error('Invalid or oversized MCP message.')); void this.close(); }
    });
    child.stdin.on('error', () => this.onerror?.(new Error('MCP input disconnected.')));
    child.stdout.on('error', () => this.onerror?.(new Error('MCP output disconnected.')));
    child.once('close', () => { this.buffer.clear(); this.onclose?.(); });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  }
  async send(message) {
    if (!this.child?.stdin.writable) throw new Error('MCP server is disconnected.');
    await new Promise((resolve, reject) => this.child.stdin.write(serializeMessage(message), (error) => error ? reject(error) : resolve()));
  }
  close() {
    if (!this.closing) this.closing = (async () => {
      const child = this.child;
      await stopOwnedProcessTree(child);
      child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy();
      this.buffer.clear();
    })();
    return this.closing;
  }
}
