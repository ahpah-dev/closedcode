import { spawn } from 'node:child_process';

// Accept only an actual ChildProcess retained by our launcher. Never discover
// or terminate a gateway by port, executable name, or a renderer-supplied PID.
export async function stopOwnedProcessTree(child, { timeoutMs = 4000 } = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0 || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      let killer, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        killer?.kill();
        child.kill();
        finish();
      }, timeoutMs);
      try {
        killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { child.kill(); finish(); });
        killer.once('close', (code) => { if (code !== 0) child.kill(); finish(); });
      } catch { child.kill(); finish(); }
    });
    return;
  }
  // The launcher creates a new POSIX process group. Killing only npm's wrapper
  // would leave its provider child listening after the desktop app exits.
  const signalGroup = (signal) => {
    try { process.kill(-pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
  };
  signalGroup('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, Math.min(1000, timeoutMs)));
  signalGroup('SIGKILL');
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, timeoutMs - 1000));
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}
