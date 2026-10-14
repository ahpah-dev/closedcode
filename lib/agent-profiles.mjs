export const MAX_CUSTOM_AGENTS = 24;
export const AGENT_COLORS = ['sage', 'violet', 'amber', 'blue'];
const reserved = new Set(['atlas', 'nova', 'sage', 'echo', 'orbit', 'forge']);
function field(value, name, maximum, required = true) {
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum || result.includes('\0')) throw new Error(`${name} must contain ${required ? '1–' : 'at most '}${maximum} characters.`);
  return result;
}
export function validateAgentProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a custom agent profile.');
  if (typeof input.id !== 'string' || !/^custom_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.id)) throw new Error('Custom agent identifier is invalid.');
  const name = field(input.name, 'Name', 60);
  if (reserved.has(name.toLowerCase())) throw new Error('Choose a name different from the built-in agents.');
  if (!AGENT_COLORS.includes(input.color)) throw new Error('Choose an available agent color.');
  const updatedAt = input.updatedAt || new Date().toISOString();
  if (typeof updatedAt !== 'string' || updatedAt.length > 40 || !Number.isFinite(Date.parse(updatedAt))) throw new Error('Agent timestamp is invalid.');
  return { id: input.id, name, role: field(input.role || 'Custom coding partner', 'Role', 100), color: input.color,
    personality: field(input.personality || '', 'Personality', 1000, false), description: field(input.description || '', 'Description', 500, false),
    guidance: field(input.guidance, 'Instructions', 8000), updatedAt: new Date(updatedAt).toISOString() };
}
export function normalizeAgentProfiles(input) {
  if (!Array.isArray(input)) return [];
  const profiles = [], ids = new Set(), names = new Set();
  for (const item of input.slice(0, MAX_CUSTOM_AGENTS)) {
    try {
      const profile = validateAgentProfile(item);
      if (ids.has(profile.id) || names.has(profile.name.toLowerCase())) continue;
      profiles.push(profile); ids.add(profile.id); names.add(profile.name.toLowerCase());
    } catch {}
  }
  return profiles;
}
