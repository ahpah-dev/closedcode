import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

export const NODE_VERSION = '24.21.0';
const root = fileURLToPath(new URL('../', import.meta.url));
const resources = path.join(root, 'desktop', 'resources');
const allowedPlatforms = new Set(['win32', 'darwin']);
const allowedArchitectures = new Set(['x64', 'arm64']);

function contained(target) {
  const relative = path.relative(resources, path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Generated resource path is outside desktop/resources.');
}
function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, shell: false, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${program} exited with code ${code}.`)));
  });
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function prepareDesktopResources({ platform = process.platform, arch = process.arch } = {}) {
  if (!allowedPlatforms.has(platform) || !allowedArchitectures.has(arch)) throw new Error('Desktop bundles support win32/darwin and x64/arm64.');
  const runtime = path.join(resources, 'runtime');
  const marker = path.join(runtime, 'closedcode-runtime.json');
  try {
    const existing = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (existing.version === NODE_VERSION && existing.platform === platform && existing.arch === arch) {
      await fs.access(path.join(runtime, platform === 'win32' ? 'node.exe' : 'bin/node'));
      console.log(`Bundled Node ${NODE_VERSION} (${platform}/${arch}) is ready.`);
      return runtime;
    }
  } catch {}
  await fs.mkdir(resources, { recursive: true });
  const cache = path.join(resources, 'cache');
  await fs.mkdir(cache, { recursive: true });
  const nodePlatform = platform === 'win32' ? 'win' : 'darwin';
  const archiveName = `node-v${NODE_VERSION}-${nodePlatform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const base = `https://nodejs.org/dist/v${NODE_VERSION}/`;
  const sumsResponse = await fetch(`${base}SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
  if (!sumsResponse.ok) throw new Error('Official Node checksum manifest could not be downloaded.');
  const sums = await sumsResponse.text();
  const sumLine = sums.split('\n').find((line) => line.trim().split(/\s+/).at(-1) === archiveName);
  const expected = sumLine?.trim().split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Official Node archive checksum is missing.');
  const archive = path.join(cache, archiveName);
  let cached = false;
  try { cached = await sha256(archive) === expected; } catch {}
  if (!cached) {
    console.log(`Downloading official Node ${NODE_VERSION} (${platform}/${arch})…`);
    const response = await fetch(`${base}${archiveName}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error('Official Node archive download failed.');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    if (await sha256(archive) !== expected) throw new Error('Node archive checksum mismatch. The runtime was not packaged.');
  }
  const temporary = await fs.mkdtemp(path.join(resources, 'extract-'));
  contained(temporary); contained(runtime);
  try {
    if (platform === 'win32' && process.platform === 'win32') {
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(temporary)} -Force`]);
    } else if (platform === 'win32') {
      await run('unzip', ['-q', archive, '-d', temporary]);
    } else if (process.platform === 'win32') {
      // Windows cannot always create Unix symlinks without elevation. Keep
      // their original metadata for the macOS ZIP writer instead of replacing
      // links with ordinary files or losing executable permissions.
      const tar = await import('tar');
      const entries = [];
      await tar.list({ file: archive, onReadEntry(entry) {
        entries.push({ path: entry.path.split('/').slice(1).join('/'), type: entry.type, mode: entry.mode, linkpath: entry.linkpath });
        entry.resume();
      } });
      await tar.extract({ file: archive, cwd: temporary, filter: (_name, entry) => entry.type !== 'SymbolicLink' && entry.type !== 'Link' });
      const extracted = path.join(temporary, `node-v${NODE_VERSION}-${nodePlatform}-${arch}`);
      await fs.writeFile(path.join(extracted, 'closedcode-archive-metadata.json'), JSON.stringify(entries));
    } else {
      await run('tar', ['-xzf', archive, '-C', temporary]);
    }
    const extracted = path.join(temporary, `node-v${NODE_VERSION}-${nodePlatform}-${arch}`);
    contained(extracted);
    await fs.access(path.join(extracted, platform === 'win32' ? 'node.exe' : 'bin/node'));
    await fs.access(path.join(extracted, platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js'));
    await fs.rm(runtime, { recursive: true, force: true });
    await fs.rename(extracted, runtime);
    if (platform !== 'win32') await fs.chmod(path.join(runtime, 'bin', 'node'), 0o755);
    await fs.writeFile(marker, JSON.stringify({ version: NODE_VERSION, platform, arch, archive: archiveName, sha256: expected, source: base }, null, 2));
    console.log(`Verified Node ${NODE_VERSION} and bundled npm/npx are ready.`);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return runtime;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
  await prepareDesktopResources({ platform: value('--platform', process.platform), arch: value('--arch', process.arch) });
}
