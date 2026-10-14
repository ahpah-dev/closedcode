import { randomUUID } from 'node:crypto';

export const MAX_SESSION_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_LOCAL_SESSIONS = 200;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function boundedString(value, name, limit, allowEmpty = false) {
  if (typeof value !== 'string') throw error(`${name} must be a string.`);
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > limit) throw error(`${name} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${limit} characters.`);
  return trimmed;
}

function messages(value) {
  if (!Array.isArray(value) || value.length > 500) throw error('messages must be an array with at most 500 entries.');
  const ids = new Set();
  return value.map((message, index) => {
    if (!isObject(message)) throw error(`messages[${index}] must be an object.`);
    if (Object.keys(message).some((key) => !['id', 'role', 'content', 'createdAt'].includes(key))) throw error(`messages[${index}] contains an unsupported field.`);
    const id = boundedString(message.id, `messages[${index}].id`, 128);
    if (ids.has(id)) throw error('Message IDs must be unique within a session.');
    ids.add(id);
    if (!['user', 'assistant'].includes(message.role)) throw error(`messages[${index}].role must be user or assistant.`);
    if (typeof message.content !== 'string' || message.content.length > 131_072) throw error(`messages[${index}].content must be a string of at most 131072 characters.`);
    if (typeof message.createdAt !== 'string' || message.createdAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(message.createdAt) || !Number.isFinite(Date.parse(message.createdAt))) throw error(`messages[${index}].createdAt must be an ISO timestamp.`);
    return { id, role: message.role, content: message.content, createdAt: new Date(message.createdAt).toISOString() };
  });
}

// Mirrors lib/cloud-contract.mts without a TypeScript loader or third-party
// dependencies, so packaged desktop companions run on bundled Node alone.
export function parseLocalSessionPayload(value, mode) {
  if (!isObject(value)) throw error('The request body must be a JSON object.');
  const allowed = mode === 'create' ? ['title', 'agent', 'project', 'messages'] : ['title', 'agent', 'project', 'messages', 'status'];
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) throw error('The request body contains an unsupported field.');
  if (mode === 'patch' && !keys.length) throw error('Provide at least one session field to update.');
  const result = {};
  if (mode === 'create' || 'title' in value) result.title = boundedString(value.title, 'title', 160);
  if (mode === 'create' || 'agent' in value) result.agent = boundedString(value.agent, 'agent', 64);
  if (mode === 'create' || 'project' in value) result.project = boundedString(value.project, 'project', 512, true);
  if ('messages' in value) result.messages = messages(value.messages);
  else if (mode === 'create') result.messages = [];
  if ('status' in value) {
    if (!['idle', 'running', 'complete'].includes(value.status)) throw error('status must be idle, running, or complete.');
    result.status = value.status;
  }
  return result;
}

export function validateLocalSessionId(id) {
  if (typeof id !== 'string' || !id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) throw error('Session not found.', 404);
  return id;
}

export function createLocalSession(payload) {
  const timestamp = new Date().toISOString();
  return { id: randomUUID(), ...payload, status: 'idle', createdAt: timestamp, updatedAt: timestamp };
}

export function normalizeSavedSession(value, project = '') {
  if (!isObject(value) || typeof value.id !== 'string') return null;
  try {
    validateLocalSessionId(value.id);
    const fallbackTime = Number.isFinite(Date.parse(value.updatedAt)) ? new Date(value.updatedAt).toISOString() : new Date().toISOString();
    const payload = parseLocalSessionPayload({
      title: String(value.title || 'New session').slice(0, 160),
      agent: String(value.agent || 'Atlas').slice(0, 64),
      project: typeof value.project === 'string' ? value.project : project,
      messages: Array.isArray(value.messages) ? value.messages.slice(-500).filter((item) => isObject(item) && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
        role: item.role,
        content: item.content.slice(0, 131_072),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : fallbackTime,
      })) : [],
    }, 'create');
    return {
      id: value.id, ...payload,
      status: ['idle', 'running', 'complete'].includes(value.status) ? value.status : 'idle',
      createdAt: Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : fallbackTime,
      updatedAt: fallbackTime,
    };
  } catch { return null; }
}

export function listLocalSessions(sessions) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
