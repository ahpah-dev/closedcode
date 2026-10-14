import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROGRAMS = new Set(['node', 'npm', 'npx', 'python', 'python3', 'git', 'cargo', 'go', 'bun']);
const OUTPUT_LIMIT = 64 * 1024;

// Set only by the desktop main process or the user's trusted launch environment.
// Model/tool requests cannot supply executable paths through this setting.
export const trustedNodeExecutable = () => process.env.CLOSED_CODE_NODE_EXECUTABLE || process.execPath;

export function validateCommand({ program, args = [] }) {
  if (typeof program !== 'string' || !PROGRAMS.has(program)) throw new Error('Program must be one of node, npm, npx, python, python3, git, cargo, go or bun. Shells and executable paths are prohibited.');
  if (!Array.isArray(args) || args.length > 64 || args.some((item) => typeof item !== 'string' || item.includes('\0') || item.length > 8000) || args.join('').length > 32_000) throw new Error('Command args must be an array of at most 64 strings (32,000 characters total).');
  if (program === 'git') {
    if (!['status', 'diff', 'show', 'log'].includes(args[0])) throw new Error('Only read-only git status, diff, show and log commands are allowed.');
    if (args.some((item) => /^(?:-c$|-C$|--(?:git-dir|work-tree|exec-path|output|ext-diff|textconv)(?:=|$))/.test(item))) throw new Error('Git configuration overrides, external helpers and output paths are prohibited.');
  }
  if (program === 'npm' && !['test', 'run', 'build', 'install', 'ci'].includes(args[0])) throw new Error('Approved npm commands are test, run, build, install and ci.');
  return { program, args };
}

export async function resolveNpmCli(name = 'npm') {
  const filename = name === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
  const directories = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  const candidates = [
    ...(process.env.npm_execpath ? [path.join(path.dirname(process.env.npm_execpath), filename)] : []),
    path.join(path.dirname(trustedNodeExecutable()), 'node_modules', 'npm', 'bin', filename),
    path.join(path.dirname(trustedNodeExecutable()), '..', 'lib', 'node_modules', 'npm', 'bin', filename),
    ...directories.map((directory) => path.join(directory, 'node_modules', 'npm', 'bin', filename)),
  ];
  if (process.platform !== 'win32') {
    for (const directory of directories) {
      try { const resolved = await fs.realpath(path.join(directory, name)); if (resolved.endsWith('.js')) candidates.push(resolved); } catch {}
    }
  }
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch {}
  }
  throw new Error(`${name} CLI could not be resolved. Install npm with Node.js and restart the companion.`);
}

export async function runApprovedCommand(input, { workspace, signal, requestApproval, timeoutMs = 60_000 }) {
  const { program, args } = validateCommand(input);
  if (signal?.aborted) throw new Error('Run cancelled.');
  if (typeof requestApproval !== 'function') throw new Error('Command approval is unavailable in this session.');
  const approved = await requestApproval({ program, args, workspace: workspace.root });
  if (!approved) throw new Error('Command declined by you. No process was started.');
  if (signal?.aborted) throw new Error('Run cancelled.');
  let executable = program === 'node' ? trustedNodeExecutable() : program;
  let argv = args;
  if (program === 'npm' || program === 'npx') { executable = trustedNodeExecutable(); argv = [await resolveNpmCli(program), ...args]; }
  if (program === 'git') {
    argv = ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', args[0], ...(['diff', 'show', 'log'].includes(args[0]) ? ['--no-ext-diff', '--no-textconv'] : []), ...args.slice(1)];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { cwd: workspace.root, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' } });
    let stdout = '', stderr = '', outputBytes = 0, truncated = false, timedOut = false, cancelled = false, settled = false, forceTimer;
    const stop = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
        forceTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1000);
      }
    };
    const append = (chunk, kind) => {
      const remaining = OUTPUT_LIMIT - outputBytes;
      const accepted = chunk.subarray(0, Math.max(remaining, 0));
      if (kind === 'stdout') stdout += accepted.toString('utf8'); else stderr += accepted.toString('utf8');
      outputBytes += accepted.length;
      if (chunk.length > remaining) { truncated = true; stop(); }
    };
    const abort = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(chunk, 'stderr'));
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort); };
    child.on('error', (error) => { if (settled) return; settled = true; cleanup(); reject(new Error(`Could not start ${program}: ${error.message}`)); });
    child.on('close', (exitCode, exitSignal) => {
      if (settled) return; settled = true; cleanup();
      if (cancelled) return reject(new Error('Run cancelled.'));
      resolve({ program, args, exitCode, signal: exitSignal, stdout, stderr, timedOut, truncated });
    });
    if (signal?.aborted) abort();
  });
}
