import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewDiff, projectPadKey, summarizeRun } from '../lib/studio.mjs';

test('run summary pairs tool results within the correct subagent and does not equate completed calls with successful commands', () => {
  const summary = summarizeRun([
    { type: 'tool', name: 'read_file', args: { path: 'src/app.tsx' }, state: 'running' },
    { type: 'tool', name: 'read_file', subagent: 'Echo', args: { path: 'src/test.ts' }, state: 'running' },
    { type: 'tool', name: 'read_file', subagent: 'Echo', state: 'complete', result: { bytes: 12 } },
    { type: 'tool', name: 'read_file', state: 'complete', result: { bytes: 40 } },
    { type: 'tool', name: 'run_command', state: 'running', args: { program: 'npm', args: ['test'] } },
    { type: 'tool', name: 'run_command', state: 'complete', result: { exitCode: 1, stdout: '1 failed' } },
    { type: 'done' },
  ], false);
  assert.equal(summary.state, 'complete');
  assert.equal(summary.tools.length, 3);
  assert.equal(summary.tools[0].args.path, 'src/app.tsx');
  assert.equal(summary.tools[1].args.path, 'src/test.ts');
  assert.equal(summary.reads, 2);
  assert.equal(summary.commands, 1);
  assert.equal(summary.successfulCommands, 0);
  assert.equal(summarizeRun([], true, true).state, 'waiting');
  assert.equal(summarizeRun([{ type: 'error', error: 'Stopped by you.' }], false).state, 'stopped');
  const waiting = summarizeRun([{ type: 'tool', name: 'run_command', state: 'running' }], true, true);
  assert.equal(waiting.tools[0].state, 'waiting');
  const stopped = summarizeRun([{ type: 'tool', name: 'run_command', state: 'running' }, { type: 'error', error: 'Stopped by you.' }], false);
  assert.equal(stopped.tools[0].state, 'stopped');
  const writes = summarizeRun([
    { type: 'tool', name: 'write_file', state: 'complete', result: { written: false, unchanged: true } },
    { type: 'tool', name: 'write_file', state: 'complete', result: { written: true } },
  ], false);
  assert.equal(writes.writes, 1);
});

test('project pads have separate versioned workspace keys', () => {
  assert.notEqual(projectPadKey('C:\\first'), projectPadKey('C:\\second'));
  assert.equal(projectPadKey(''), 'closedcode.project-pad.v1:unpaired');
});

test('change diff preserves common context and bounds displayed output', () => {
  const diff = createReviewDiff('first\nold\nlast', 'first\nnew\nlast');
  assert.equal(diff.additions, 1); assert.equal(diff.deletions, 1);
  assert.match(diff.diff, /^@@ -1,3 \+1,3 @@/);
  assert.match(diff.diff, / first\n-old\n\+new\n last$/);
  assert.equal(createReviewDiff('same', 'same').diff, '');
  const large = createReviewDiff(null, Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n'));
  assert.equal(large.additions, 900); assert.equal(large.truncated, true);
  assert.ok(large.diff.split('\n').length <= 501);
  const longContext = createReviewDiff(`${'a'.repeat(80_000)}\nold`, `${'a'.repeat(80_000)}\nnew`);
  assert.equal(longContext.truncated, true); assert.ok(longContext.diff.length < 60_200);
});
