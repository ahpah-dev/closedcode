import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateAgentProfile, normalizeAgentProfiles, MAX_CUSTOM_AGENTS } from '../lib/agent-profiles.mjs';

export class AgentStore {
  constructor(stateDir) { this.file = path.join(stateDir, 'agents.json'); this.profiles = []; this.pending = Promise.resolve(); }
  async load() {
    try { this.profiles = normalizeAgentProfiles(JSON.parse(await fs.readFile(this.file, 'utf8')).agents); }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Custom agent configuration could not be loaded.'); }
  }
  list() { return this.profiles.map((profile) => ({ ...profile })); }
  change(transform) {
    const operation = this.pending.catch(() => {}).then(async () => {
      const next = transform(this.profiles);
      await fs.writeFile(`${this.file}.tmp`, JSON.stringify({ agents: next }, null, 2), { mode: 0o600 });
      await fs.rename(`${this.file}.tmp`, this.file); this.profiles = next;
      return this.list();
    });
    this.pending = operation; return operation;
  }
  save(input, update = false) {
    const profile = validateAgentProfile(input);
    return this.change((profiles) => {
      const exists = profiles.some((item) => item.id === profile.id);
      if (exists !== update) throw new Error(update ? 'Custom agent not found.' : 'This custom agent already exists.');
      if (!update && profiles.length >= MAX_CUSTOM_AGENTS) throw new Error(`You can save up to ${MAX_CUSTOM_AGENTS} custom agents.`);
      if (profiles.some((item) => item.id !== profile.id && item.name.toLowerCase() === profile.name.toLowerCase())) throw new Error('Another custom agent already uses this name.');
      return [...profiles.filter((item) => item.id !== profile.id), profile];
    });
  }
  remove(id) {
    return this.change((profiles) => {
      if (!profiles.some((profile) => profile.id === id)) throw new Error('Custom agent not found.');
      return profiles.filter((profile) => profile.id !== id);
    });
  }
}
