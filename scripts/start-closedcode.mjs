import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readExecutionProfile } from './execution-profile.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(scriptPath));
process.chdir(root);

// Child wrappers translate IPC shutdown into Node's graceful SIGTERM handling.
// This also works on Windows, where ChildProcess.kill cannot deliver SIGTERM.
if (process.argv[2] === '--child') {
  const service = process.argv[3];
  if (!['companion', 'web'].includes(service)) throw new Error('Unknown launcher service.');
  let ready = false, stopRequested = false;
  const shutdown = () => {
    stopRequested = true;
    if (!ready) return;
    if (!process.emit('SIGTERM')) process.exit(0);
  };
  process.on('message', (message) => { if (message?.type === 'shutdown') shutdown(); });
  process.on('disconnect', shutdown);
  const entry = new URL(service === 'companion' ? '../companion/server.mjs' : './run-framework.mjs', import.meta.url);
  process.argv = [process.execPath, fileURLToPath(entry), ...(service === 'web' ? ['dev', '--port', String(process.env.CLOSED_CODE_WEB_PORT || 5173), '--host', '127.0.0.1'] : [])];
  await import(entry.href);
  ready = true;
  process.send?.({ type: 'ready', service });
  if (stopRequested) shutdown();
} else {
  const [major, minor, patchVersion] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && (minor < 22 || (minor === 22 && patchVersion < 2)))) {
    console.error('ClosedCode needs Node.js 22.22.2 or newer. Install a current Node.js release, then launch again.');
    process.exitCode = 1;
  } else {
    const children = [];
    let stopping = false;
    const stopChild = async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve) => {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          if (process.platform === 'win32' && child.pid) {
            // Only the PID of a child created by this launcher is targeted.
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
            killer.on('error', () => { child.kill(); finish(); });
            killer.on('close', finish);
          } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
            finish();
          }
        }, 5000);
        child.once('exit', finish);
        if (child.connected) child.send({ type: 'shutdown' }, (error) => { if (error) child.kill(); });
        else child.kill();
      });
    };
    const shutdown = async (code = 0) => {
      if (stopping) return;
      stopping = true;
      console.log('\nStopping ClosedCode…');
      await Promise.allSettled(children.map(stopChild));
      process.exitCode = code;
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());

    const portAvailable = (port, label) => new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', (error) => reject(new Error(`${label} port ${port} is unavailable (${error.code}). Stop the existing service or choose a different port.`)));
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });

    try {
      const companionPort = Number(process.env.CLOSED_CODE_PORT || 47821);
      const webPort = Number(process.env.CLOSED_CODE_WEB_PORT || 5173);
      if (!Number.isInteger(companionPort) || companionPort < 1024 || companionPort > 65535) throw new Error('CLOSED_CODE_PORT must be between 1024 and 65535.');
      if (!Number.isInteger(webPort) || webPort < 3000 || webPort > 6000) throw new Error('CLOSED_CODE_WEB_PORT must be between 3000 and 6000.');
      const managedLinux = readExecutionProfile() === 'managed-linux';
      const required = [managedLinux ? 'node_modules/vite/bin/vite.js' : 'node_modules/vinext/dist/cli.js', 'node_modules/react/package.json', 'node_modules/wrangler/bin/wrangler.js'];
      try { await Promise.all(required.map((file) => fs.access(path.join(root, file)))); }
      catch { throw new Error('Project dependencies are missing. Open a terminal in this folder, run npm install, then launch ClosedCode again.'); }
      await Promise.all([portAvailable(companionPort, 'Companion'), portAvailable(webPort, 'Web workspace')]);
      const migrationConfig = path.join(root, '.sites-runtime', 'closedcode-local-migrations.json');
      await fs.mkdir(path.dirname(migrationConfig), { recursive: true });
      const migrationDirectory = path.join(root, '.sites-runtime', 'local-migrations');
      await fs.mkdir(migrationDirectory, { recursive: true });
      const migrations = (await fs.readdir(path.join(root, 'drizzle'))).filter((name) => name.endsWith('.sql')).sort();
      for (const [index, name] of migrations.entries()) {
        let sql = await fs.readFile(path.join(root, 'drizzle', name), 'utf8');
        // Earlier local previews can have the initial schema created directly,
        // without D1's migration ledger. Baseline it idempotently in an ignored
        // LOCAL copy; tracked/applied migration files remain immutable.
        if (index === 0) sql = sql.replace(/CREATE TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE (UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi, (_match, unique = '') => `CREATE ${unique}INDEX IF NOT EXISTS `);
        await fs.writeFile(path.join(migrationDirectory, name), sql);
      }
      await fs.writeFile(migrationConfig, JSON.stringify({
        name: 'closedcode-local-migrations', compatibility_date: '2026-05-15',
        d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000', migrations_dir: './local-migrations' }],
      }, null, 2));
      console.log('Preparing local session storage…');
      await new Promise((resolve, reject) => {
        const migration = spawn(process.execPath, [path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'migrations', 'apply', 'site-creator-d1', '--local', '--config', migrationConfig, '--persist-to', path.join(root, '.wrangler', 'state')], {
          cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
        });
        children.push(migration);
        migration.once('error', reject);
        migration.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Local session storage could not be prepared. See the migration error above.')));
      });
      if (stopping) process.exit(0);
      console.log(`\nClosedCode\nWorkspace UI: http://127.0.0.1:${webPort}\nCompanion: http://127.0.0.1:${companionPort}\n\nOpen the workspace URL when the preview reports ready.\nCopy the companion pairing token below into Connect project.\nKeep this terminal open. Press Ctrl+C to stop both services.\n`);
      for (const service of ['companion', 'web']) {
        const child = spawn(process.execPath, [scriptPath, '--child', service], {
          cwd: root, shell: false, windowsHide: true, detached: process.platform !== 'win32',
          env: { ...process.env, CLOSED_CODE_PORT: String(companionPort), CLOSED_CODE_WEB_PORT: String(webPort) },
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
        children.push(child);
        child.once('error', (error) => { console.error(`${service} could not start: ${error.message}`); void shutdown(1); });
        child.once('exit', (code, signal) => {
          if (!stopping) { console.error(`${service} stopped (${signal || code || 0}).`); void shutdown(code || 1); }
        });
      }
    } catch (error) {
      console.error(`\n${error.message}\n`);
      await shutdown(1);
    }
  }
}
