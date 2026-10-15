import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 24;
const MAX_RUN_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_RUNS = 20;
const idPattern = /^[a-f0-9]{32}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 409, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const bytes = (value) => value === null ? 0 : Buffer.byteLength(value);
const runBytes = (run) => run.files.reduce((sum, file) => sum + bytes(file.before) + bytes(file.after), 0);
const stamp = (stat) => ({ dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs) });
const sameStamp = (a, b, moved = false) => a && b && ['dev', 'ino', 'size', 'mtime', ...(moved ? [] : ['ctime'])].every((key) => a[key] === b[key]);
const sameFile = (snapshot, file, moved = false) => snapshot && snapshot.digest === hash(file.after) && sameStamp(snapshot.identity, file.afterIdentity, moved);

async function snapshot(target) {
  let handle;
  try {
    const entry = await fs.lstat(target, { bigint: true });
    if (entry.isSymbolicLink() || !entry.isFile()) throw fail('Only regular files can be reviewed; symbolic links are blocked.', 400);
    handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat({ bigint: true });
    if (!sameStamp(stamp(entry), stamp(stat))) throw fail('File changed before ClosedCode could read it. Try again.');
    if (!stat.isFile() || stat.size > BigInt(MAX_FILE_BYTES)) throw fail('Only regular text files under 512 KB can be reviewed.', 400);
    const buffer = await handle.readFile();
    if (buffer.length > MAX_FILE_BYTES) throw fail('File exceeds the 512 KB review limit.', 400);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
    catch { throw fail('Binary or invalid UTF-8 files cannot be changed through review.', 400); }
    if (content.includes('\0')) throw fail('Binary files cannot be changed through review.', 400);
    const after = await handle.stat({ bigint: true });
    if (!sameStamp(stamp(stat), stamp(after))) throw fail('File changed while ClosedCode was reading it. Try again.');
    return { content, digest: hash(buffer), identity: stamp(after), mode: Number(stat.mode & 0o777n) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

function summary(run) {
  return { id: run.id, runId: run.id, workspace: run.workspace, status: run.status, outcome: run.outcome, createdAt: run.createdAt, updatedAt: run.updatedAt, changeCount: run.files.length };
}

function publicRun(run) {
  return { ...summary(run), files: run.files.map((file) => ({ path: file.path, kind: file.before === null ? 'created' : 'modified', before: file.before, after: file.after, beforeBytes: bytes(file.before), afterBytes: bytes(file.after), ...(file.undone ? { undone: true } : {}) })) };
}

// Only this store creates run IDs and records paths. HTTP callers cannot supply
// snapshots or paths to Undo, and old workspaces never become Undo targets.
export class ChangeTracker {
  constructor(stateDir) {
    this.statePath = path.join(stateDir, 'changes.json');
    this.runs = [];
    this.pending = Promise.resolve();
  }

  enqueue(action) {
    const result = this.pending.catch(() => {}).then(action);
    this.pending = result.catch(() => {});
    return result;
  }

  async load() {
    let data;
    try {
      if ((await fs.stat(this.statePath)).size > MAX_HISTORY_BYTES) return;
      data = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') console.warn('ClosedCode change history could not be loaded.'); return; }
    if (!Array.isArray(data?.runs)) return;
    let total = 0;
    const ids = new Set();
    for (const source of data.runs.slice(-MAX_RUNS)) {
      if (!source || !idPattern.test(source.id) || ids.has(source.id) || typeof source.workspace !== 'string' || !path.isAbsolute(source.workspace) || source.workspace.length > 2048 || !['running', 'pending', 'kept', 'undone'].includes(source.status) || !Array.isArray(source.files) || source.files.length > MAX_FILES) continue;
      if (![source.createdAt, source.updatedAt].every((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))) continue;
      const paths = new Set();
      const valid = source.files.every((file) => {
        if (!file || typeof file.path !== 'string' || file.path.length > 1024 || paths.has(file.path) || !(file.before === null || typeof file.before === 'string') || typeof file.after !== 'string' || bytes(file.before) > MAX_FILE_BYTES || bytes(file.after) > MAX_FILE_BYTES || file.before?.includes('\0') || file.after.includes('\0')) return false;
        if (file.afterIdentity !== null && (!file.afterIdentity || !['dev', 'ino', 'size', 'mtime', 'ctime'].every((key) => typeof file.afterIdentity[key] === 'string' && /^\d+$/.test(file.afterIdentity[key])))) return false;
        if (!Number.isInteger(file.beforeMode) || file.beforeMode < 0 || file.beforeMode > 0o777) return false;
        paths.add(file.path); return true;
      });
      if (!valid || runBytes(source) > MAX_RUN_BYTES || total + runBytes(source) > MAX_HISTORY_BYTES) continue;
      total += runBytes(source); ids.add(source.id);
      this.runs.push({ ...source, ...(source.status === 'running' ? { status: source.files.length ? 'pending' : 'kept', outcome: 'interrupted' } : {}) });
    }
  }

  async persist() {
    const storedBytes = (run) => Buffer.byteLength(JSON.stringify(run));
    const retained = this.runs.slice();
    let total = retained.reduce((sum, run) => sum + storedBytes(run), 256);
    while (retained.length > MAX_RUNS || total > MAX_HISTORY_BYTES) {
      const oldest = retained.findIndex((run) => run.status !== 'running');
      if (oldest < 0) throw fail('Change history is full. Finish the current run before continuing.');
      total -= storedBytes(retained[oldest]); retained.splice(oldest, 1);
    }
    const temporary = `${this.statePath}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, runs: retained }), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, this.statePath);
      this.runs = retained;
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  require(id, workspace) {
    if (!idPattern.test(id)) throw fail('Change review was not found in this workspace.', 404);
    const run = this.runs.find((item) => item.id === id && item.workspace === workspace.root);
    if (!run) throw fail('Change review was not found in this workspace.', 404);
    return run;
  }

  list(workspace) { return this.runs.filter((run) => run.workspace === workspace.root).slice().reverse().map(summary); }
  get(id, workspace) { return publicRun(this.require(id, workspace)); }

  begin(workspace, onChange = () => {}) {
    return this.enqueue(async () => {
      const date = new Date().toISOString();
      const run = { id: randomBytes(16).toString('hex'), workspace: workspace.root, status: 'running', outcome: null, createdAt: date, updatedAt: date, files: [] };
      this.runs.push(run);
      try { await this.persist(); }
      catch (error) { this.runs = this.runs.filter((item) => item.id !== run.id); throw error; }
      return {
        id: run.id,
        summary: () => summary(run),
        write: (input, content) => this.write(run.id, workspace, input, content, onChange),
        finish: (outcome = 'completed') => this.enqueue(async () => {
          run.status = run.files.length ? 'pending' : 'kept'; run.outcome = outcome; run.updatedAt = new Date().toISOString();
          await this.persist(); onChange(summary(run)); return publicRun(run);
        }),
      };
    });
  }

  write(id, workspace, input, content, onChange) {
    return this.enqueue(async () => {
      const run = this.require(id, workspace);
      if (run.status !== 'running') throw fail('This run has already finished.');
      if (typeof content !== 'string' || content.includes('\0') || bytes(content) > MAX_FILE_BYTES) throw fail('Write content must be UTF-8 text under 512 KB.', 400);
      const target = await workspace.checked(input, { createParents: true });
      const relative = path.relative(workspace.root, target).replaceAll(path.sep, '/');
      const current = await snapshot(target);
      const previous = run.files.find((file) => file.path === relative);
      if (previous && !sameFile(current, previous)) throw fail(`Cannot replace ${relative}: it changed outside this run. Review those edits first.`);
      if (current?.content === content) return { path: relative, bytes: bytes(content), written: false, unchanged: true };
      if (!previous && run.files.length >= MAX_FILES) throw fail(`A run can review at most ${MAX_FILES} files. Start a focused follow-up run.`);
      const file = { path: relative, before: previous ? previous.before : current?.content ?? null, after: content, beforeMode: previous?.beforeMode ?? current?.mode ?? 0o600, afterIdentity: null };
      const projected = runBytes(run) - (previous ? bytes(previous.before) + bytes(previous.after) : 0) + bytes(file.before) + bytes(file.after);
      if (projected > MAX_RUN_BYTES) throw fail('This run reached its change snapshot limit. Start a focused follow-up run.');
      // Persist the intended before/after pair first. A power loss never turns
      // a partially recorded edit into an unchecked Undo after restart.
      if (previous) run.files[run.files.indexOf(previous)] = file; else run.files.push(file);
      run.updatedAt = new Date().toISOString();
      let applied = false;
      try {
        await this.persist();
        const result = await workspace.write(relative, content);
        applied = true;
        const after = await snapshot(await workspace.checked(relative));
        if (after?.digest === hash(content)) file.afterIdentity = after.identity;
        if (file.before === file.after) run.files.splice(run.files.indexOf(file), 1);
        run.updatedAt = new Date().toISOString(); await this.persist(); onChange(summary(run));
        return result;
      } catch (error) {
        // A rejected write is not a change. Retain earlier successful writes to
        // this same file, rather than exposing the failed intent as an edit.
        if (!applied) {
          const index = run.files.indexOf(file);
          if (previous) run.files[index] = previous; else run.files.splice(index, 1);
        }
        await this.persist(); onChange(summary(run)); throw error;
      }
    });
  }

  keep(id, workspace) {
    return this.enqueue(async () => {
      const run = this.require(id, workspace);
      if (run.status === 'running') throw fail('Wait for the active run before reviewing changes.');
      if (run.status === 'undone') throw fail('These changes were already undone.');
      const previous = { status: run.status, updatedAt: run.updatedAt };
      run.status = 'kept'; run.updatedAt = new Date().toISOString();
      try { await this.persist(); }
      catch (error) { Object.assign(run, previous); throw error; }
      return publicRun(run);
    });
  }

  undo(id, workspace) {
    return this.enqueue(async () => {
      const run = this.require(id, workspace);
      if (run.status === 'running') throw fail('Wait for the active run before undoing changes.');
      if (run.status === 'undone') return publicRun(run);
      const files = run.files.filter((file) => !file.undone);
      const conflicts = [];
      // Preflight the entire run: a conflict in one file does not silently undo
      // unrelated files in that same run.
      for (const file of files) {
        try {
          const target = await workspace.checked(file.path);
          if (!sameFile(await snapshot(target), file)) conflicts.push(file.path);
        } catch { conflicts.push(file.path); }
      }
      if (conflicts.length) throw fail(`Undo stopped because ${conflicts.join(', ')} changed after this run. Your current files were preserved.`, 409, { conflicts });
      // Verify that the private ledger is writable before touching any file.
      await this.persist();
      for (const file of files) {
        const target = await workspace.checked(file.path);
        if (!sameFile(await snapshot(target), file)) throw fail(`Undo stopped: ${file.path} changed after this run. Your current file was preserved.`, 409, { conflicts: [file.path] });
        const quarantine = path.join(path.dirname(target), `.closedcode-write-undo-${randomBytes(16).toString('hex')}`);
        const restored = path.join(path.dirname(target), `.closedcode-write-restore-${randomBytes(16).toString('hex')}`);
        let claimed = false;
        try {
          if (file.before !== null) await fs.writeFile(restored, file.before, { flag: 'wx', mode: file.beforeMode });
          // Claim the exact current inode, then recheck it. Restoration uses an
          // exclusive hard link, so a newly created external file is never
          // overwritten between the check and the replacement.
          await fs.rename(target, quarantine); claimed = true;
          if (!sameFile(await snapshot(quarantine), file, true)) throw fail(`Undo stopped: ${file.path} changed during review.`, 409, { conflicts: [file.path] });
          await workspace.checked(file.path);
          if (file.before !== null) await fs.link(restored, target);
          else {
            try { await fs.lstat(target); throw fail(`Undo stopped: ${file.path} was recreated during review.`, 409, { conflicts: [file.path] }); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          file.undone = true;
          await fs.rm(quarantine); claimed = false;
          run.updatedAt = new Date().toISOString(); await this.persist();
        } catch (error) {
          if (claimed) {
            // link() fails rather than replacing a file another process added.
            // If recovery cannot reclaim the name, keep the old file beside it.
            try { await fs.link(quarantine, target); await fs.rm(quarantine); }
            catch { error.message += ` A preserved copy remains at ${path.basename(quarantine)}.`; }
          }
          if (error.code === 'EEXIST') throw fail(`Undo stopped: ${file.path} changed during review. Current files were preserved.`, 409, { conflicts: [file.path] });
          throw error;
        } finally { await fs.rm(restored, { force: true }).catch(() => {}); }
      }
      const previous = { status: run.status, updatedAt: run.updatedAt };
      run.status = 'undone'; run.updatedAt = new Date().toISOString();
      try { await this.persist(); }
      catch (error) { Object.assign(run, previous); throw error; }
      return publicRun(run);
    });
  }
}
