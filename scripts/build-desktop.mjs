import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareDesktopResources } from './build-desktop-resources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const platform = argv.includes('--mac') ? 'darwin' : argv.includes('--win') ? 'win32' : process.platform;
const arch = argv.includes('--arm64') ? 'arm64' : argv.includes('--x64') ? 'x64' : process.arch;
const run = (program, args, { timeoutMs, ...options } = {}) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd: root, shell: false, windowsHide: true, stdio: 'inherit', ...options });
  let expired = false;
  const timer = timeoutMs ? setTimeout(() => {
    expired = true;
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => child.kill());
    } else child.kill('SIGTERM');
  }, timeoutMs) : undefined;
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code) => {
    clearTimeout(timer);
    code === 0 && !expired ? resolve() : reject(new Error(expired ? 'Packaged desktop smoke check timed out.' : `${path.basename(program)} exited with code ${code}.`));
  });
});
if (!['win32', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Choose --win or --mac, and --x64 or --arm64.');

if (!argv.includes('--skip-build')) {
  await run(process.execPath, [path.join(root, 'scripts', 'build-desktop-ui.mjs')]);
  await run(process.execPath, [path.join(root, 'scripts', 'build-desktop-engine.mjs')]);
  await run(process.execPath, [path.join(root, 'scripts', 'generate-license-notices.mjs')]);
  await prepareDesktopResources({ platform, arch });
}
if (argv.includes('--run')) {
  const electron = platform === 'win32' ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe') : path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  await run(electron, [root]);
} else if (argv.includes('--smoke')) {
  if (platform !== process.platform) throw new Error('Desktop smoke checks must run on the target operating system.');
  const executable = platform === 'win32' ? path.join(root, 'release', 'win-unpacked', 'ClosedCode.exe') : path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'ClosedCode.app', 'Contents', 'MacOS', 'ClosedCode');
  await fs.access(executable);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'closedcode-desktop-smoke-'));
  const report = path.join(temporary, 'report.json');
  const screenshot = path.join(root, 'desktop', 'resources', 'smoke', `latest-${platform}-${arch}.png`);
  await fs.mkdir(path.dirname(screenshot), { recursive: true });
  try {
    await run(executable, ['--desktop-smoke', `--desktop-smoke-arch=${arch}`, `--desktop-smoke-state=${path.join(temporary, 'state')}`, `--desktop-smoke-output=${report}`, `--desktop-smoke-screenshot=${screenshot}`], { timeoutMs: 90_000 });
    const result = JSON.parse(await fs.readFile(report, 'utf8'));
    if (!result.ok || !result.packaged || result.rendererNodeAvailable) throw new Error('Packaged desktop smoke checks failed.');
    console.log(JSON.stringify(result));
    console.log(`Desktop preview: ${screenshot}`);
  } finally {
    const relative = path.relative(os.tmpdir(), temporary);
    if (relative.startsWith('closedcode-desktop-smoke-') && !relative.includes(path.sep) && !path.isAbsolute(relative)) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
} else {
  const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const args = [builder, '--config', 'electron-builder.yml', platform === 'win32' ? '--win' : '--mac', `--${arch}`, '--publish', 'never'];
  if (argv.includes('--dir')) args.push('--dir');
  else if (platform === 'darwin' && process.platform !== 'darwin') {
    // ZIP can be cross-packaged; DMG and native verification need a Mac runner.
    args.splice(args.indexOf('--mac') + 1, 0, 'zip');
    console.log('Building unsigned macOS ZIP only. Verify it on a macOS runner before distribution.');
  }
  await run(process.execPath, args, { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
}
