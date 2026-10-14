import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { stopOwnedProcessTree } from '../companion/processes.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('shutdown terminates an owned wrapper and its provider descendant', async (t) => {
  const program = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore', windowsHide: true });
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `;
  const owned = spawn(process.execPath, ['-e', program], { detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => stopOwnedProcessTree(owned));
  const descendant = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned process did not become ready.')), 5000);
    owned.once('error', (error) => { clearTimeout(timer); reject(error); });
    owned.stdout.once('data', (chunk) => { clearTimeout(timer); resolve(Number(chunk.toString().trim())); });
  });
  assert.ok(Number.isInteger(descendant) && descendant > 0);
  assert.equal(alive(owned.pid), true);
  assert.equal(alive(descendant), true);
  const started = Date.now();
  await stopOwnedProcessTree(owned, { timeoutMs: 3000 });
  for (let attempt = 0; attempt < 30 && (alive(owned.pid) || alive(descendant)); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(alive(owned.pid), false);
  assert.equal(alive(descendant), false);
  assert.ok(Date.now() - started < 4500);
});

test('empty and already-exited process handles never start a kill command', async () => {
  await stopOwnedProcessTree(null);
  await stopOwnedProcessTree({ pid: 'not-a-process', exitCode: null, signalCode: null });
  await stopOwnedProcessTree({ pid: process.pid, exitCode: 0, signalCode: null });
  assert.equal(alive(process.pid), true);
});
