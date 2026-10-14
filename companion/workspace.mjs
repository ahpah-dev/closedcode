import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const EXCLUDED = new Set(['.git', '.closedcode', 'node_modules', '.next', 'dist', 'build', '.wrangler', '.sites-runtime', '.openai']);
const MAX_FILE_BYTES = 512 * 1024;
const secret = (name) => /^\.env(?:\.|$)/i.test(name) || /^(?:id_rsa|id_ed25519|credentials|secrets)(?:\.|$)/i.test(name) || /\.(?:pem|p12|pfx|key)$/i.test(name);
const forbidden = (name) => EXCLUDED.has(name.toLowerCase()) || secret(name) || name.includes(':') || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

export class Workspace {
  constructor(root) { this.root = path.resolve(root); }

  async select(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Choose an absolute workspace folder path.');
    const resolved = await fs.realpath(root);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('Workspace must be a folder.');
    this.root = resolved;
    return resolved;
  }

  relative(input) {
    if (typeof input !== 'string' || !input || input.includes('\0') || input.length > 1024) throw new Error('A relative file path is required.');
    const normalized = input.replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || segments.some((part) => part === '..' || part === '' || (part !== '.' && forbidden(part)))) {
      throw new Error('Path is outside the allowed workspace files.');
    }
    const target = path.resolve(this.root, ...segments);
    if (!this.contains(target)) throw new Error('Path escapes the workspace.');
    return target;
  }

  contains(target) {
    const relative = path.relative(this.root, target);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  async checked(input, { createParents = false } = {}) {
    const target = this.relative(input);
    const segments = path.relative(this.root, target).split(path.sep);
    let current = this.root;
    // Reject links at every segment, including junctions on Windows. This prevents
    // the agent from reading or writing a linked folder outside its selected root.
    for (let index = 0; index < segments.length; index++) {
      current = path.join(current, segments[index]);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (createParents && index < segments.length - 1) {
          await fs.mkdir(current);
          stat = await fs.lstat(current);
        } else if (index < segments.length - 1) throw new Error('Parent folder does not exist.');
        else return target;
      }
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed.');
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error('Parent path is not a folder.');
      const actual = await fs.realpath(current);
      if (!this.contains(actual)) throw new Error('Path escapes the workspace.');
    }
    return target;
  }

  async read(input) {
    const target = await this.checked(input);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('Path must be a regular file.');
    if (stat.size > MAX_FILE_BYTES) throw new Error('File exceeds the 512 KB reading limit.');
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const content = await handle.readFile('utf8');
      if (content.includes('\0')) throw new Error('Binary files cannot be read by the agent.');
      return content;
    } finally { await handle.close(); }
  }

  async write(input, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('Text content must be under 512 KB.');
    const target = await this.checked(input, { createParents: true });
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Write target must be a regular file.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(path.dirname(target), `.closedcode-write-${randomBytes(8).toString('hex')}`);
    try {
      await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      // Check once again immediately before the atomic replacement.
      await this.checked(input);
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return { path: input, bytes: Buffer.byteLength(content), written: true };
  }

  async list(prefix = '.') {
    const start = prefix === '.' ? this.root : await this.checked(prefix);
    if (!(await fs.stat(start)).isDirectory()) throw new Error('Listing path must be a folder.');
    const files = [];
    let truncated = false;
    const walk = async (folder, depth) => {
      if (depth > 8) { truncated = true; return; }
      const entries = await fs.readdir(folder, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (forbidden(entry.name) || entry.name.startsWith('.closedcode-write-') || entry.isSymbolicLink()) continue;
        if (files.length >= 2000) { truncated = true; return; }
        const target = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(target, depth + 1);
        else if (entry.isFile()) {
          const stat = await fs.lstat(target);
          files.push({ path: path.relative(this.root, target).replaceAll(path.sep, '/'), size: stat.size });
        }
      }
    };
    await walk(start, 0);
    return { files, truncated };
  }

  async diff() {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-c', 'core.pager=cat', '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--', '.', ':(glob,exclude)**/.env*', ':(glob,exclude)**/*.pem', ':(glob,exclude)**/*.key', ':(glob,exclude)**/*.p12', ':(glob,exclude)**/*.pfx', ':(glob,exclude)**/id_rsa*', ':(glob,exclude)**/id_ed25519*', ':(glob,exclude)**/credentials*', ':(glob,exclude)**/secrets*', ':(exclude).closedcode'], { cwd: this.root, shell: false, windowsHide: true });
      let output = '', errorOutput = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Git diff timed out.')); }, 10_000);
      child.stdout.on('data', (data) => { output += data; if (output.length > 512 * 1024) child.kill(); });
      child.stderr.on('data', (data) => { errorOutput += data; });
      child.on('error', (error) => { clearTimeout(timeout); reject(new Error(`Git unavailable: ${error.message}`)); });
      child.on('close', (code) => { clearTimeout(timeout); code === 0 ? resolve(output.slice(0, 512 * 1024)) : reject(new Error(errorOutput.trim() || 'Git diff failed.')); });
    });
  }
}
