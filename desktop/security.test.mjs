import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { externalUrlAllowed, trustedFrame, contentPolicy } from './security.mjs';
import { serveDesktop, listenLocal } from './static-server.mjs';

test('desktop bridge accepts only its own main frame, and external links use a strict origin allowlist', () => {
  const frame = { url: 'http://127.0.0.1:5481/' };
  const webContents = { mainFrame: frame };
  assert.equal(trustedFrame({ sender: webContents, senderFrame: frame }, webContents, 'http://127.0.0.1:5481'), true);
  assert.equal(trustedFrame({ sender: {}, senderFrame: frame }, webContents, 'http://127.0.0.1:5481'), false);
  assert.equal(trustedFrame({ sender: webContents, senderFrame: { url: frame.url } }, webContents, 'http://127.0.0.1:5481'), false);
  frame.url = 'https://evil.example';
  assert.equal(trustedFrame({ sender: webContents, senderFrame: frame }, webContents, 'http://127.0.0.1:5481'), false);
  for (const url of ['file:///C:/Windows/system.ini', 'javascript:alert(1)', 'https://github.com.evil.example', 'https://user:secret@github.com', 'http://127.0.0.1:1234']) assert.equal(externalUrlAllowed(url), false);
  assert.equal(externalUrlAllowed('https://github.com/ahpah-dev/closedcode'), true);
  assert.equal(externalUrlAllowed('http://127.0.0.1:20128/dashboard'), true);
  const scriptPolicy = contentPolicy('http://127.0.0.1:47821').split(';').find((item) => item.includes('script-src'));
  assert.equal(scriptPolicy.includes('unsafe-inline') || scriptPolicy.includes('unsafe-eval'), false);
});

test('bundled static UI serves only allowed files and rejects wrong origins, traversal and escaping links', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-ui-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'ui'); const outside = path.join(directory, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'index.html'), '<title>ClosedCode</title>');
  await fs.writeFile(path.join(root, 'app.js'), 'export const ok=true');
  await fs.writeFile(path.join(root, 'secret.env'), 'not served');
  await fs.writeFile(path.join(outside, 'outside.js'), 'not served');
  await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const ui = await serveDesktop(root, 5485); ui.setCompanionOrigin('http://127.0.0.1:47821');
  t.after(() => ui.close());
  const response = await fetch(ui.origin);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /ClosedCode/);
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self' http:\/\/127\.0\.0\.1:47821/);
  assert.equal((await fetch(`${ui.origin}/app.js`)).status, 200);
  assert.equal((await fetch(`${ui.origin}/secret.env`)).status, 404);
  assert.equal((await fetch(`${ui.origin}/escape/outside.js`)).status, 403);
  assert.equal((await fetch(`${ui.origin}/app.js`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${ui.origin}/app.js`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${ui.origin}/%5c..%5coutside.js`)).status, 403);
  const rebinding = await new Promise((resolve, reject) => {
    const request = http.get(ui.origin, { headers: { Host: 'evil.example' } }, (reply) => { reply.resume(); resolve(reply.statusCode); });
    request.on('error', reject);
  });
  assert.equal(rebinding, 403);
});

test('desktop companion port selection safely chooses a loopback-only fallback when occupied', async (t) => {
  const occupied = http.createServer((_req, res) => res.end('occupied'));
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const companion = http.createServer((_req, res) => res.end('companion'));
  const port = await listenLocal(companion, occupied.address().port);
  t.after(() => new Promise((resolve) => { companion.closeAllConnections(); companion.close(resolve); }));
  assert.notEqual(port, occupied.address().port);
  assert.equal(companion.address().address, '127.0.0.1');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'companion');
});
