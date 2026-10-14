import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
let calls = 0;
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'inspect', description: 'Inspect fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify({ text: request.params.arguments.text, calls: ++calls, parentSecretInherited: !!process.env.CLOSED_CODE_TOKEN }) }] };
  else if (request.method === 'ping') result = {};
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
lines.on('close', () => process.exit(0));
